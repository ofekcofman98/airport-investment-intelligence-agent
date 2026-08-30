/**
 * src/interface/channel.ts — the abstract Channel interface (ADR 0006,
 * interface/CLAUDE.md). A channel calls `agent.handleMessage(input,
 * sessionId)` and nothing else — no imports from src/scoring/ or
 * src/data/. It may read `trace` for display purposes only (ADR 0008: the
 * trace is never a source of truth for an answer).
 *
 * cli.ts is the required, primary implementation. A web chat or voice
 * channel is a new file implementing this same interface, wired through
 * composition.ts exactly like cli.ts is — never a fork of the agent core.
 */

import type { Agent } from "../agent/orchestrator.js";
import type { Trace } from "../obs/trace.js";
import type { SessionStore } from "../agent/session.js";

export interface ChannelDeps {
  agent: Agent;
  trace: Trace;
  sessions: SessionStore;
  airportCount: number;
  analysisYear: number;
}

export interface Channel {
  /** Runs the channel until the user ends the session (e.g. `/exit` on the
   * CLI, a closed socket for a future web/voice channel). Resolves when the
   * channel is done. */
  start(): Promise<void>;
}
