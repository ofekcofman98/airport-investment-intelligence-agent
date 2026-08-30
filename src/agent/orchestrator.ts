/**
 * src/agent/orchestrator.ts — the LLM tool-calling loop (SPEC §6,
 * src/agent/CLAUDE.md, ADR 0002/0007/0008).
 *
 * The LLM interprets the question, selects tools/arguments, and narrates
 * results. It never computes a score, invents a number, or picks a weight
 * — every number in a response must be traceable to a src/scoring/
 * function call recorded via src/obs/trace.ts. This file is the only place
 * that writes to the trace (ADR 0008) and the only caller of
 * src/agent/toolHandlers.ts's dispatch().
 *
 * Depends on a narrow, locally-defined LlmClient interface rather than
 * importing @anthropic-ai/sdk directly, so the entire loop — tool rounds,
 * the audit layer, refusal paths — is testable with a scripted fake and
 * zero network. A thin adapter wrapping the real SDK is wired by
 * src/interface/cli.ts, not built here.
 */

import { anthropicTools, type ToolRefusal } from "./tools.js";
import { dispatch, type ToolHandlers, type MethodologyPayload } from "./toolHandlers.js";
import { buildSystemPrompt } from "./systemPrompt.js";
import { formatMethodology } from "./methodologyText.js";
import type { SessionStore, Turn } from "./session.js";
import type { Trace, TraceEvent } from "../obs/trace.js";

// ---------------------------------------------------------------------------
// LLM wire types — a minimal subset of Anthropic's Messages API shape,
// defined locally so this file has zero SDK dependency.
// ---------------------------------------------------------------------------

export interface LlmTextBlock {
  type: "text";
  text: string;
}

export interface LlmToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: unknown;
}

export type LlmAssistantBlock = LlmTextBlock | LlmToolUseBlock;

export interface LlmToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  content: string;
}

export type LlmMessageContent = string | LlmAssistantBlock[] | LlmToolResultBlock[];

export interface LlmMessage {
  role: "user" | "assistant";
  content: LlmMessageContent;
}

export interface LlmRequest {
  system: string;
  messages: LlmMessage[];
  tools?: ReturnType<typeof anthropicTools>;
}

export interface LlmResponse {
  content: LlmAssistantBlock[];
}

export interface LlmClient {
  createMessage(request: LlmRequest): Promise<LlmResponse>;
}

// ---------------------------------------------------------------------------
// Tool-call round limit (src/agent/CLAUDE.md "Required follow-ups")
// ---------------------------------------------------------------------------

export const MAX_TOOL_ROUNDS = 5;

function hasToolUse(response: LlmResponse): boolean {
  return response.content.some((b) => b.type === "tool_use");
}

function extractText(response: LlmResponse): string {
  return response.content
    .filter((b): b is LlmTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");
}

// ---------------------------------------------------------------------------
// KPI audit layer (src/agent/CLAUDE.md "Required follow-ups") — defense in
// depth on top of ADR 0002: catches the LLM misquoting/mis-rounding a
// number a tool already returned correctly, distinct from the LLM
// computing a number itself (already prevented structurally).
// ---------------------------------------------------------------------------

const AUDIT_TOLERANCE = 0.5;

/** A bare 4-digit integer in this range is treated as a stated year
 * (e.g. "2025", "2024"), not a claimed metric — narrations legitimately
 * restate the analysis year with no tool number to match it against. */
function looksLikeYear(n: number): boolean {
  return Number.isInteger(n) && n >= 1900 && n <= 2100;
}

// Shared between claim-side and truth-side extraction so the two can never
// drift apart (e.g. one normalizing thousands separators and the other not).
const NUMBER_PATTERN = /-?\d+(?:\.\d+)?/g;

/** A claim as stated in the narration: the numeric value plus whether it was
 * written with a trailing `%` (matters for the fraction<->percent check
 * below — `"5.3%"` and `"0.053"` are the same claim, `"5.3"` alone is not). */
interface Claim {
  value: number;
  isPercent: boolean;
}

function extractNumbers(text: string): Claim[] {
  // Strip thousands separators ("686,314" -> "686314") before matching, so
  // a large count isn't misread as two smaller numbers.
  const normalized = text.replace(/(\d),(?=\d{3}\b)/g, "$1");
  const matches = normalized.matchAll(NUMBER_PATTERN);
  const claims: Claim[] = [];
  for (const m of matches) {
    const value = Number(m[0]);
    if (looksLikeYear(value)) continue;
    const isPercent = normalized[m.index + m[0].length] === "%";
    claims.push({ value, isPercent });
  }
  return claims;
}

/** Large-magnitude truth values (e.g. passenger counts) tolerate a relative
 * match — ±0.5 absolute is right for a 0-100 score but unusably tight for a
 * count in the hundreds of thousands, where an honest narration rounds
 * ("roughly 690,000" for 686,314). Kept out of AUDIT_TOLERANCE's range so
 * scores stay governed by the strict absolute check. */
const RELATIVE_TOLERANCE_MIN_MAGNITUDE = 10_000;
const RELATIVE_TOLERANCE = 0.01;

function matchesTruth(claim: number, truth: number): boolean {
  if (Math.abs(truth - claim) <= AUDIT_TOLERANCE) return true;
  if (Math.abs(truth) >= RELATIVE_TOLERANCE_MIN_MAGNITUDE) {
    return Math.abs(truth - claim) <= Math.abs(truth) * RELATIVE_TOLERANCE;
  }
  return false;
}

function extractNumbersFromResults(results: readonly unknown[]): number[] {
  const nums: number[] = [];
  const visit = (value: unknown): void => {
    if (typeof value === "number" && Number.isFinite(value)) {
      nums.push(value);
    } else if (typeof value === "string") {
      // Required narration content (SPEC §4a caveat, disclosed confounders)
      // is delivered to the LLM as strings embedded in tool results — those
      // numbers are just as much "truth" as a bare numeric field.
      for (const m of value.matchAll(NUMBER_PATTERN)) {
        const n = Number(m[0]);
        if (!looksLikeYear(n)) nums.push(n);
      }
    } else if (Array.isArray(value)) {
      value.forEach(visit);
    } else if (value !== null && typeof value === "object") {
      Object.values(value).forEach(visit);
    }
  };
  results.forEach(visit);
  return nums;
}

export interface AuditResult {
  ok: boolean;
  mismatches: number[];
}

/**
 * Extracts every number claimed in `text` and requires each to match some
 * number appearing in this turn's tool results within AUDIT_TOLERANCE (or,
 * for large magnitudes, RELATIVE_TOLERANCE — see matchesTruth). A claim
 * written as "N%" also passes if N/100 matches a truth value, since a tool
 * result's fraction (0.053) is routinely narrated as a percentage (5.3%).
 * With no tool results to check against (a purely conversational turn, or
 * a refusal with no numeric content), there is nothing to audit — passes
 * trivially rather than flagging incidental numbers as mismatches.
 */
export function auditNarration(text: string, toolResults: readonly unknown[]): AuditResult {
  if (toolResults.length === 0) return { ok: true, mismatches: [] };

  const truth = extractNumbersFromResults(toolResults);
  if (truth.length === 0) return { ok: true, mismatches: [] };

  const claimed = extractNumbers(text);
  const mismatches = claimed
    .filter((c) => {
      if (truth.some((t) => matchesTruth(c.value, t))) return false;
      if (c.isPercent && truth.some((t) => matchesTruth(c.value / 100, t))) return false;
      return true;
    })
    .map((c) => c.value);
  return { ok: mismatches.length === 0, mismatches };
}

/** Correct-by-construction fallback when the LLM can't produce narration
 * that survives the audit even after one retry — built directly from the
 * tool's exact values, deliberately blunt rather than wrong. */
export function templatedAnswer(toolResults: readonly unknown[]): string {
  if (toolResults.length === 0) {
    return "I was unable to produce a verified answer for this question.";
  }
  return (
    "I couldn't verify my narration against the exact tool results, so " +
    "here are those results directly:\n\n" +
    toolResults.map((r) => JSON.stringify(r, null, 2)).join("\n\n")
  );
}

// ---------------------------------------------------------------------------
// Agent
// ---------------------------------------------------------------------------

export interface AgentReply {
  text: string;
  trace: TraceEvent[];
  audited: "passed" | "regenerated" | "templated";
}

export interface AgentDeps {
  llm: LlmClient;
  handlers: ToolHandlers;
  sessions: SessionStore;
  trace: Trace;
  airportCount: number;
  analysisYear: number;
}

export interface Agent {
  handleMessage(input: string, sessionId: string): Promise<AgentReply>;
}

function toLlmMessages(turns: readonly Turn[]): LlmMessage[] {
  return turns.map((t) => ({ role: t.role, content: t.content as LlmMessageContent }));
}

export function createAgent(deps: AgentDeps): Agent {
  const systemPrompt = buildSystemPrompt(deps.airportCount, deps.analysisYear);
  const tools = anthropicTools();

  async function callLlm(sessionId: string, withTools: boolean): Promise<LlmResponse> {
    return deps.llm.createMessage({
      system: systemPrompt,
      messages: toLlmMessages(deps.sessions.getHistory(sessionId)),
      ...(withTools ? { tools } : {}),
    });
  }

  async function handleMessage(input: string, sessionId: string): Promise<AgentReply> {
    deps.sessions.appendTurn(sessionId, { role: "user", content: input });

    const toolResultsThisTurn: (unknown | ToolRefusal)[] = [];
    let response = await callLlm(sessionId, true);
    let round = 0;

    while (hasToolUse(response) && round < MAX_TOOL_ROUNDS) {
      round++;
      deps.sessions.appendTurn(sessionId, { role: "assistant", content: response.content });

      const toolUseBlocks = response.content.filter(
        (b): b is LlmToolUseBlock => b.type === "tool_use"
      );

      const resultBlocks: LlmToolResultBlock[] = [];
      for (const block of toolUseBlocks) {
        const result = dispatch(deps.handlers, block.name, block.input);
        toolResultsThisTurn.push(result);
        deps.trace.record({ tool: block.name, args: block.input, result });
        resultBlocks.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: JSON.stringify(result),
        });
      }

      // Cost-awareness bypass (architecture.md "LLM bypass for
      // describe_methodology"): when the model's only request this round is
      // describe_methodology and it didn't refuse, the payload is static
      // text already fully determined by weights.ts — skip the further LLM
      // round-trip and return the formatted payload directly.
      if (toolUseBlocks.length === 1 && toolUseBlocks[0]?.name === "describe_methodology") {
        const only = toolResultsThisTurn[toolResultsThisTurn.length - 1];
        if (only !== undefined && !("status" in (only as object))) {
          const text = formatMethodology(only as MethodologyPayload);
          deps.sessions.appendTurn(sessionId, { role: "user", content: resultBlocks });
          deps.sessions.appendTurn(sessionId, { role: "assistant", content: text });
          return { text, trace: deps.trace.events(), audited: "passed" };
        }
      }

      deps.sessions.appendTurn(sessionId, { role: "user", content: resultBlocks });
      response = await callLlm(sessionId, true);
    }

    if (hasToolUse(response)) {
      // MAX_TOOL_ROUNDS reached with the model still requesting tools: do
      // not execute or append this unexecuted request (it would leave a
      // dangling tool_use with no paired tool_result). Force one final
      // call with tools disabled so the model must synthesize an answer
      // from whatever has already been gathered this turn.
      response = await callLlm(sessionId, false);
    }

    const firstText = extractText(response);
    const firstAudit = auditNarration(firstText, toolResultsThisTurn);
    if (process.env.DEBUG_AUDIT) console.error("FIRST", JSON.stringify(firstAudit), firstText);
    if (firstAudit.ok) {
      deps.sessions.appendTurn(sessionId, { role: "assistant", content: firstText });
      return { text: firstText, trace: deps.trace.events(), audited: "passed" };
    }

    // One regeneration, naming the offending values, before falling back
    // to a templated answer (src/agent/CLAUDE.md "Required follow-ups").
    deps.sessions.appendTurn(sessionId, { role: "assistant", content: firstText });
    deps.sessions.appendTurn(sessionId, {
      role: "user",
      content:
        `Your previous answer stated figure(s) that do not match this turn's ` +
        `tool results: ${firstAudit.mismatches.join(", ")}. Answer again using ` +
        `only the exact values from the tool results already returned.`,
    });
    const retryResponse = await callLlm(sessionId, false);
    const retryText = extractText(retryResponse);
    const retryAudit = auditNarration(retryText, toolResultsThisTurn);
    if (process.env.DEBUG_AUDIT) console.error("RETRY", JSON.stringify(retryAudit), retryText);

    if (retryAudit.ok) {
      deps.sessions.appendTurn(sessionId, { role: "assistant", content: retryText });
      return { text: retryText, trace: deps.trace.events(), audited: "regenerated" };
    }

    const templated = templatedAnswer(toolResultsThisTurn);
    deps.sessions.appendTurn(sessionId, { role: "assistant", content: templated });
    return { text: templated, trace: deps.trace.events(), audited: "templated" };
  }

  return { handleMessage };
}
