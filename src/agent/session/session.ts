/**
 * src/agent/session.ts — conversation history, owned by the agent core
 * (ADR 0007). Keyed by sessionId; used only by orchestrator.ts. A channel's
 * only job is to generate/hold a sessionId and pass it into
 * handleMessage(input, sessionId) — it never stores history itself.
 *
 * In-memory for this build (process-lifetime only, per ADR 0007's stated
 * consequence); a persistent store is a swap-in implementation behind this
 * same interface, not a redesign.
 */

/** `content` is deliberately `unknown` here: the shape of an LLM turn
 * (text blocks, tool_use/tool_result blocks) is an orchestrator.ts/LlmClient
 * concern, not something session.ts should know about. */
export interface Turn {
  role: "user" | "assistant";
  content: unknown;
}

export interface SessionStore {
  getHistory(sessionId: string): Turn[];
  appendTurn(sessionId: string, turn: Turn): void;
  clear(sessionId: string): void;
}

/** Cap on retained turns per session so a long-running CLI process can't
 * grow every subsequent request's history unboundedly. */
export const MAX_HISTORY_TURNS = 20;

export function createSessionStore(maxTurns: number = MAX_HISTORY_TURNS): SessionStore {
  const historyBySession = new Map<string, Turn[]>();

  return {
    getHistory(sessionId) {
      // A copy: callers must go through appendTurn to mutate history, never
      // push directly onto what this returns.
      return [...(historyBySession.get(sessionId) ?? [])];
    },

    appendTurn(sessionId, turn) {
      const existing = historyBySession.get(sessionId) ?? [];
      const updated = [...existing, turn];
      const trimmed = updated.length > maxTurns ? updated.slice(updated.length - maxTurns) : updated;
      historyBySession.set(sessionId, trimmed);
    },

    clear(sessionId) {
      historyBySession.delete(sessionId);
    },
  };
}
