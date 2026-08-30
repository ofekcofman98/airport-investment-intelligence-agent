/**
 * src/interface/composition.ts — the composition root (ADR 0009). The only
 * file in the app that imports across every layer: src/data, src/agent,
 * src/obs, and this layer's own anthropicClient.ts. Keeps
 * interface/CLAUDE.md's "a channel calls agent.handleMessage(input,
 * sessionId) and nothing else" literally true — cli.ts (and any future
 * channel) receives fully-wired deps and never constructs a data source,
 * tool handlers, or an LLM client itself.
 */

import { createSnapshotDataSource } from "../data/snapshotDataSource.js";
import { createToolHandlers } from "../agent/toolHandlers/toolHandlers.js";
import { createSessionStore } from "../agent/session/session.js";
import { createTrace } from "../obs/trace.js";
import { createAgent, type Agent } from "../agent/orchestrator/orchestrator.js";
import { createAnthropicClient } from "./anthropicClient.js";
import type { ChannelDeps } from "./channel.js";

export interface Composition extends ChannelDeps {
  agent: Agent;
}

/**
 * Assembles one fully-wired agent. Throws a readable error (not a raw
 * stack trace) if the snapshot hasn't been built yet or the API key is
 * missing — both are startup-time failures, not per-turn ones.
 */
export function compose(): Composition {
  let dataSource;
  try {
    dataSource = createSnapshotDataSource();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Failed to load the airport data snapshot: ${message}\n` +
        `Run \`npm run build:data\` first, then retry.`
    );
  }

  const handlers = createToolHandlers(dataSource);
  const sessions = createSessionStore();
  const trace = createTrace();
  const llm = createAnthropicClient();

  const manifest = dataSource.getManifest();
  const airportCount = dataSource.listAirports().length;
  const analysisYear = manifest.analysisYear;

  const agent = createAgent({
    llm,
    handlers,
    sessions,
    trace,
    airportCount,
    analysisYear,
  });

  return { agent, trace, sessions, airportCount, analysisYear };
}
