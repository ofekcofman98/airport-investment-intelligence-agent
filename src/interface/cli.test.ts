import { describe, it, expect } from "vitest";
import { parseCommand, formatWhy, formatTrace } from "./cli.js";
import type { TraceEvent } from "../obs/trace.js";

describe("parseCommand", () => {
  it("parses each slash command", () => {
    expect(parseCommand("/why")).toEqual({ type: "why" });
    expect(parseCommand("/trace")).toEqual({ type: "trace" });
    expect(parseCommand("/reset")).toEqual({ type: "reset" });
    expect(parseCommand("/help")).toEqual({ type: "help" });
    expect(parseCommand("/exit")).toEqual({ type: "exit" });
    expect(parseCommand("/quit")).toEqual({ type: "exit" });
  });

  it("trims whitespace before matching a command", () => {
    expect(parseCommand("  /why  ")).toEqual({ type: "why" });
  });

  it("treats anything else as a message, preserving the original text", () => {
    expect(parseCommand("What is congestion at SFO?")).toEqual({
      type: "message",
      text: "What is congestion at SFO?",
    });
  });

  it("does not treat a mid-sentence slash as a command", () => {
    expect(parseCommand("What about /why does it matter?")).toEqual({
      type: "message",
      text: "What about /why does it matter?",
    });
  });
});

const EVENTS: TraceEvent[] = [
  {
    tool: "get_airport_metrics",
    args: { code: "SFO" },
    result: { ref: { code: "SFO" }, metrics: { passengers: 40_000_000 } },
    timestamp: "2026-01-01T00:00:00Z",
  },
];

describe("formatWhy", () => {
  it("reports no calls when the trace is empty", () => {
    expect(formatWhy([])).toMatch(/no tool calls/i);
  });

  it("lists each tool call with its args and a result summary", () => {
    const text = formatWhy(EVENTS);
    expect(text).toContain("get_airport_metrics");
    expect(text).toContain("SFO");
  });

  it("truncates a very long result rather than dumping it in full", () => {
    const longResult = { data: "x".repeat(500) };
    const text = formatWhy([{ ...EVENTS[0]!, result: longResult }]);
    expect(text.length).toBeLessThan(500);
    expect(text).toContain("…");
  });
});

describe("formatTrace", () => {
  it("reports no calls when the trace is empty", () => {
    expect(formatTrace([])).toMatch(/no tool calls/i);
  });

  it("returns the full JSON trace, unlike formatWhy's truncated summary", () => {
    const longResult = { data: "x".repeat(500) };
    const text = formatTrace([{ ...EVENTS[0]!, result: longResult }]);
    expect(text).toContain("x".repeat(500));
  });
});
