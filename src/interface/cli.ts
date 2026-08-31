#!/usr/bin/env node
/**
 * src/interface/cli.ts — the primary Channel implementation (ADR 0006):
 * readline in, text out, calling agent.handleMessage(input, sessionId) and
 * nothing else. One sessionId per process run.
 *
 * Slash commands (`/why`, `/trace`, `/reset`, `/help`, `/exit`) and trace
 * formatting are pure/testable functions exported below; only `start()`
 * touches readline/stdin/stdout.
 */

import { createInterface } from "node:readline/promises";
import { randomUUID } from "node:crypto";
import type { Channel, ChannelDeps } from "./channel.js";
import type { TraceEvent } from "../obs/trace.js";
import { LlmClientError } from "../agent/llmClient/llmClient.js";

// ---------------------------------------------------------------------------
// Pure command parsing + formatting (unit-tested in cli.test.ts)
// ---------------------------------------------------------------------------

export type CliCommand =
  | { type: "why" }
  | { type: "trace" }
  | { type: "reset" }
  | { type: "help" }
  | { type: "exit" }
  | { type: "message"; text: string };

export function parseCommand(line: string): CliCommand {
  const trimmed = line.trim();
  switch (trimmed) {
    case "/why":
      return { type: "why" };
    case "/trace":
      return { type: "trace" };
    case "/reset":
      return { type: "reset" };
    case "/help":
      return { type: "help" };
    case "/exit":
    case "/quit":
      return { type: "exit" };
    default:
      return { type: "message", text: line };
  }
}

const HELP_TEXT = `Commands:
  /why    Show which tool calls produced the last answer's numbers
  /trace  Show the full tool call/result trace for the last answer
  /reset  Clear this session's conversation history
  /help   Show this message
  /exit   Quit`;

function summarizeResult(result: unknown): string {
  const json = JSON.stringify(result);
  return json.length > 160 ? json.slice(0, 160) + "…" : json;
}

/** Compact one-line-per-call view: which tool ran, with what args, and a
 * truncated result — "which deterministic call produced any number" per
 * ADR 0008, without dumping full payloads. */
export function formatWhy(events: TraceEvent[]): string {
  if (events.length === 0) return "No tool calls were made for the last answer.";
  return events
    .map(
      (e, i) =>
        `${i + 1}. ${e.tool}(${JSON.stringify(e.args)}) -> ${summarizeResult(e.result)}`
    )
    .join("\n");
}

/** Full JSON trace, for `--trace` mode and `/trace`. */
export function formatTrace(events: TraceEvent[]): string {
  if (events.length === 0) return "No tool calls were made for the last answer.";
  return JSON.stringify(events, null, 2);
}

// ---------------------------------------------------------------------------
// Channel implementation
// ---------------------------------------------------------------------------

export interface CliOptions {
  /** Print the full trace after every turn, not just on /trace (ADR 0008's
   * named `--trace` flag). */
  traceEveryTurn?: boolean;
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
}

export function createCli(deps: ChannelDeps, opts: CliOptions = {}): Channel {
  const sessionId = randomUUID();
  const output = opts.output ?? process.stdout;
  const rl = createInterface({
    input: opts.input ?? process.stdin,
    output,
  });
  const write = (s: string) => output.write(s + "\n");

  async function start(): Promise<void> {
    write(
      `Airport Investment Intelligence Agent — ${deps.airportCount} airports, ` +
        `analysis year ${deps.analysisYear}. Type /help for commands, /exit to quit.`
    );

    for (;;) {
      let line: string;
      try {
        line = await rl.question("\n> ");
      } catch {
        // Input stream closed (e.g. piped stdin ended, or Ctrl+D) — end the
        // session cleanly rather than throwing out of the REPL loop.
        break;
      }
      const command = parseCommand(line);

      if (command.type === "exit") break;

      if (command.type === "help") {
        write(HELP_TEXT);
        continue;
      }

      if (command.type === "reset") {
        deps.sessions.clear(sessionId);
        write("Session history cleared.");
        continue;
      }

      if (command.type === "why") {
        write(formatWhy(deps.trace.events()));
        continue;
      }

      if (command.type === "trace") {
        write(formatTrace(deps.trace.events()));
        continue;
      }

      if (command.text.trim().length === 0) continue;

      // Cleared before each turn so /why and /trace mean "the last answer"
      // rather than accumulating across the whole process (independent
      // decision D2 — the trace recorder itself is process-lifetime,
      // per-turn clearing is this channel's own choice, ADR 0009).
      deps.trace.clear();

      const thinking = setInterval(() => output.write("."), 400);
      output.write("Thinking.");

      try {
        const reply = await deps.agent.handleMessage(command.text, sessionId);
        clearInterval(thinking);
        write("\n" + reply.text);
        if (reply.audited !== "passed") {
          write(
            `[note: this answer was ${reply.audited} by the output-consistency ` +
              `check before being shown]`
          );
        }
        if (opts.traceEveryTurn) {
          write(formatTrace(deps.trace.events()));
        }
      } catch (err) {
        clearInterval(thinking);
        if (err instanceof LlmClientError) {
          const hint = err.transient
            ? "[retry hint: this is usually transient — wait a moment and try again]"
            : "[config-check hint: verify ANTHROPIC_API_KEY and account status]";
          write(`\nError: ${err.message}\n${hint}`);
        } else {
          const message = err instanceof Error ? err.message : String(err);
          write(`\nError: ${message}`);
        }
      }
    }

    rl.close();
  }

  return { start };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const { compose } = await import("./composition.js");
  let deps;
  try {
    deps = compose();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(message);
    process.exitCode = 1;
    return;
  }

  const traceEveryTurn = process.argv.includes("--trace");
  const cli = createCli(deps, { traceEveryTurn });
  await cli.start();
}

const entry = process.argv[1] ?? "";
const isMainModule = entry.endsWith("cli.ts") || entry.endsWith("cli.js");
if (isMainModule) {
  main();
}
