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
 * The LLM wire shapes live in llmClient.ts (zero SDK dependency, so this
 * loop is testable with a scripted fake and zero network — a thin adapter
 * wrapping the real SDK is wired by src/interface/cli.ts, not built here)
 * and the output-consistency check lives in narrationAudit.ts; this file
 * only orchestrates calling them.
 */

import { anthropicTools, type ToolRefusal } from "../tools/tools.js";
import { dispatch, type ToolHandlers, type MethodologyPayload } from "../toolHandlers/toolHandlers.js";
import { buildSystemPrompt } from "../systemPrompt/systemPrompt.js";
import { formatMethodology } from "../methodologyText/methodologyText.js";
import type { SessionStore, Turn } from "../session/session.js";
import type { Trace, TraceEvent } from "../../obs/trace.js";
import {
  hasToolUse,
  extractText,
  type LlmMessage,
  type LlmMessageContent,
  type LlmResponse,
  type LlmToolUseBlock,
  type LlmToolResultBlock,
  type LlmClient,
} from "../llmClient/llmClient.js";
import { auditNarration, templatedAnswer } from "../narrationAudit/narrationAudit.js";

// ---------------------------------------------------------------------------
// Tool-call round limit (src/agent/CLAUDE.md "Required follow-ups")
// ---------------------------------------------------------------------------

export const MAX_TOOL_ROUNDS = 5;

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
