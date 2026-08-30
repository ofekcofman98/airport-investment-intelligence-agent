import { describe, it, expect } from "vitest";
import { createTrace } from "./trace.js";

describe("createTrace", () => {
  it("records events in call order with all four fields", () => {
    const trace = createTrace();
    trace.record({ tool: "get_airport_metrics", args: { code: "SFO" }, result: { ok: true } });
    trace.record({ tool: "explain_score", args: { code: "SFO", kpi: "congestion" }, result: { score: 50 } });

    const events = trace.events();
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ tool: "get_airport_metrics", args: { code: "SFO" }, result: { ok: true } });
    expect(events[1]).toMatchObject({ tool: "explain_score" });
    for (const e of events) {
      expect(typeof e.timestamp).toBe("string");
      expect(Number.isNaN(Date.parse(e.timestamp))).toBe(false);
    }
  });

  it("clear() empties the log", () => {
    const trace = createTrace();
    trace.record({ tool: "resolve_airports", args: { query: "SFO" }, result: {} });
    trace.clear();
    expect(trace.events()).toEqual([]);
  });

  it("events() returns a copy — mutating it does not affect the recorder", () => {
    const trace = createTrace();
    trace.record({ tool: "resolve_airports", args: { query: "SFO" }, result: {} });
    const events = trace.events();
    events.push({ tool: "fake", args: {}, result: {}, timestamp: "x" });
    expect(trace.events()).toHaveLength(1);
  });
});
