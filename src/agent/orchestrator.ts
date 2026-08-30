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
import { dispatch, type ToolHandlers } from "./toolHandlers.js";
import { buildSystemPrompt } from "./systemPrompt.js";
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

function extractNumbers(text: string): number[] {
  const matches = text.match(/-?\d+(\.\d+)?/g) ?? [];
  return matches.map(Number).filter((n) => !looksLikeYear(n));
}

function extractNumbersFromResults(results: readonly unknown[]): number[] {
  const nums: number[] = [];
  const visit = (value: unknown): void => {
    if (typeof value === "number" && Number.isFinite(value)) {
      nums.push(value);
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
 * number appearing in this turn's tool results within AUDIT_TOLERANCE.
 * With no tool results to check against (a purely conversational turn, or
 * a refusal with no numeric content), there is nothing to audit — passes
 * trivially rather than flagging incidental numbers as mismatches.
 */
export function auditNarration(text: string, toolResults: readonly unknown[]): AuditResult {
  if (toolResults.length === 0) return { ok: true, mismatches: [] };

  const truth = extractNumbersFromResults(toolResults);
  if (truth.length === 0) return { ok: true, mismatches: [] };

  const claimed = extractNumbers(text);
  const mismatches = claimed.filter(
    (c) => !truth.some((t) => Math.abs(t - c) <= AUDIT_TOLERANCE)
  );
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

      const resultBlocks: LlmToolResultBlock[] = [];
      for (const block of response.content) {
        if (block.type !== "tool_use") continue;
        const result = dispatch(deps.handlers, block.name, block.input);
        toolResultsThisTurn.push(result);
        deps.trace.record({ tool: block.name, args: block.input, result });
        resultBlocks.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: JSON.stringify(result),
        });
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
