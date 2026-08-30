import { describe, it, expect } from "vitest";
import type {
  AirportDataSource,
  AirportRef,
  AirportYearMetrics,
  SnapshotManifest,
} from "../data/types.js";
import { createToolHandlers } from "./toolHandlers.js";
import { createSessionStore } from "./session.js";
import { createTrace } from "../obs/trace.js";
import {
  createAgent,
  auditNarration,
  templatedAnswer,
  MAX_TOOL_ROUNDS,
  type LlmClient,
  type LlmRequest,
  type LlmResponse,
} from "./orchestrator.js";

// ---------------------------------------------------------------------------
// Fakes — same style as toolHandlers.test.ts / proxyScores.test.ts: hand
// built, no I/O, no network.
// ---------------------------------------------------------------------------

function ref(overrides: Partial<AirportRef>): AirportRef {
  return {
    code: "XXX",
    name: "Test Airport",
    city: "Testville",
    state: "MA",
    region: "New England",
    lat: 0,
    lon: 0,
    ...overrides,
  };
}

function metrics(overrides: Partial<AirportYearMetrics>): AirportYearMetrics {
  return {
    code: "XXX",
    year: 2025,
    passengers: 10_000_000,
    seats: 12_000_000,
    departuresScheduled: 100_000,
    departuresPerformed: 99_000,
    loadFactor: 0.83,
    scheduleAdherenceGap: 0.01,
    del15Rate: 0.15,
    avgTaxiOutMin: 18,
    nasDelayPerDeparture: 3.5,
    weatherDelayPerDeparture: 1.2,
    cancellationRate: 0.02,
    longHaulShare: 0.1,
    paxGrowthYoy: 0.03,
    dataCompleteness: 1,
    ...overrides,
  };
}

const REFS: AirportRef[] = [
  ref({ code: "SFO", name: "San Francisco Intl", city: "San Francisco", state: "CA", region: "Pacific" }),
  ref({ code: "JFK", name: "JFK Intl", city: "New York", state: "NY", region: "Mid-Atlantic" }),
];

const METRICS: Record<string, AirportYearMetrics> = {
  SFO: metrics({ code: "SFO", passengers: 40_000_000, del15Rate: 0.2 }),
  JFK: metrics({ code: "JFK", passengers: 35_000_000, del15Rate: 0.25 }),
};

const MANIFEST: SnapshotManifest = {
  builtAt: "2026-01-01T00:00:00Z",
  sources: [],
  analysisYear: 2025,
  priorYear: 2024,
  airportCount: REFS.length,
};

function fakeDataSource(): AirportDataSource {
  return {
    listAirports: () => REFS,
    getAirportRef: (code) => REFS.find((r) => r.code === code.toUpperCase()) ?? null,
    getYearMetrics: (code, year) =>
      year === MANIFEST.analysisYear ? (METRICS[code.toUpperCase()] ?? null) : null,
    getManifest: () => MANIFEST,
  };
}

function textResponse(text: string): LlmResponse {
  return { content: [{ type: "text", text }] };
}

function toolUseResponse(name: string, input: unknown, id = "call_1"): LlmResponse {
  return { content: [{ type: "tool_use", id, name, input }] };
}

/** A scripted LlmClient: returns each queued response in order, ignoring
 * the request content (tests inspect calls via `requests`). */
function scriptedLlm(responses: LlmResponse[]): LlmClient & { requests: LlmRequest[] } {
  const queue = [...responses];
  const requests: LlmRequest[] = [];
  return {
    requests,
    async createMessage(request: LlmRequest): Promise<LlmResponse> {
      requests.push(request);
      const next = queue.shift();
      if (!next) throw new Error("scriptedLlm: ran out of scripted responses");
      return next;
    },
  };
}

function newAgentDeps(llm: LlmClient) {
  return {
    llm,
    handlers: createToolHandlers(fakeDataSource()),
    sessions: createSessionStore(),
    trace: createTrace(),
    airportCount: REFS.length,
    analysisYear: MANIFEST.analysisYear,
  };
}

// ---------------------------------------------------------------------------

describe("createAgent — single tool round", () => {
  it("calls the handler, records exactly one trace event, and returns the model's text", async () => {
    const llm = scriptedLlm([
      toolUseResponse("get_airport_metrics", { code: "SFO" }),
      textResponse("SFO handled 40000000 passengers in 2025."),
    ]);
    const deps = newAgentDeps(llm);
    const agent = createAgent(deps);

    const reply = await agent.handleMessage("How many passengers did SFO have?", "s1");

    expect(reply.audited).toBe("passed");
    expect(reply.text).toContain("40000000");
    expect(deps.trace.events()).toHaveLength(1);
    expect(deps.trace.events()[0]!.tool).toBe("get_airport_metrics");
  });
});

describe("createAgent — tool round limit", () => {
  it("caps at MAX_TOOL_ROUNDS and forces a final tools-disabled call", async () => {
    // Always requests another tool call — never stops on its own. One more
    // than MAX_TOOL_ROUNDS so the cap is actually exercised: the last of
    // these is never executed, only used to detect the model still wants
    // a tool after the cap.
    const infiniteToolUse = Array.from({ length: MAX_TOOL_ROUNDS + 1 }, (_, i) =>
      toolUseResponse("get_airport_metrics", { code: "SFO" }, `call_${i}`)
    );
    const llm = scriptedLlm([...infiniteToolUse, textResponse("Here is a summary with no numbers.")]);
    const deps = newAgentDeps(llm);
    const agent = createAgent(deps);

    const reply = await agent.handleMessage("Tell me everything.", "s1");

    expect(reply.audited).toBe("passed");
    expect(deps.trace.events()).toHaveLength(MAX_TOOL_ROUNDS);
    // The final call must have no `tools` field (tools disabled).
    const finalRequest = llm.requests[llm.requests.length - 1]!;
    expect(finalRequest.tools).toBeUndefined();
  });
});

describe("createAgent — audit / regenerate / template", () => {
  it("passes narration that quotes an exact tool value", () => {
    const result = auditNarration("The score is 63.8.", [{ score: 63.8 }]);
    expect(result.ok).toBe(true);
  });

  it("passes narration within the ±0.5 tolerance", () => {
    const result = auditNarration("The score is 63.9.", [{ score: 63.6 }]);
    expect(result.ok).toBe(true);
  });

  it("fails narration outside the ±0.5 tolerance", () => {
    const result = auditNarration("The score is 70.0.", [{ score: 63.6 }]);
    expect(result.ok).toBe(false);
    expect(result.mismatches).toContain(70);
  });

  it("ignores a bare year and passes trivially with no tool results", () => {
    expect(auditNarration("This is the 2025 analysis year.", [{ score: 63.6 }]).ok).toBe(true);
    expect(auditNarration("Anything at all, 12345.", []).ok).toBe(true);
  });

  it("passes a required caveat's numbers even though they live inside a string field", () => {
    const caveat =
      'This score is relative to the ~400 major US airports in our dataset. ' +
      'A score of 90 means "near the top of this set".';
    const result = auditNarration(
      `PWM scores 66.8. ${caveat}`,
      [{ score: 66.8, normalization: { caveat } }]
    );
    expect(result.ok).toBe(true);
  });

  it("matches a thousands-separated count against the unformatted truth value", () => {
    const result = auditNarration(
      "MHT was excluded with 686,314 passengers.",
      [{ code: "MHT", passengers: 686314 }]
    );
    expect(result.ok).toBe(true);
  });

  it("matches a percent-form claim against a raw fraction", () => {
    const result = auditNarration(
      "PWM grew 5.3% year over year.",
      [{ paxGrowthYoy: 0.0532 }]
    );
    expect(result.ok).toBe(true);
  });

  it("matches a rounded large count within 1% relative tolerance", () => {
    const result = auditNarration(
      "MHT had roughly 690,000 passengers.",
      [{ passengers: 686314 }]
    );
    expect(result.ok).toBe(true);
  });

  it("still fails a large-magnitude claim outside 1% relative tolerance", () => {
    const result = auditNarration(
      "MHT had roughly 750,000 passengers.",
      [{ passengers: 686314 }]
    );
    expect(result.ok).toBe(false);
  });

  it("does not misread a hyphenated range as a negative number", () => {
    // Regression: "~25-29" for load factor (DCA 29.4, BWI 25.0) was
    // previously parsed as "25" then the negative number "-29", which
    // matches nothing in the truth set. docs/fixes/fixes.md.
    const result = auditNarration(
      "DCA and BWI both run lower (~25-29).",
      [{ dca: 29.4 }, { bwi: 25.0 }]
    );
    expect(result.ok).toBe(true);
  });

  it("still catches a genuine negative-number mismatch (not glued to a preceding digit)", () => {
    // truth is 0.6 (60%), not 0.03, so this isn't just the existing
    // percent<->fraction check finding an incidental match.
    const result = auditNarration("Growth was -12.0% year over year.", [{ paxGrowthYoy: 0.6 }]);
    expect(result.ok).toBe(false);
  });

  it("treats a bare 0 or 100 as scale language, not a claimed figure", () => {
    const result = auditNarration(
      "Scores run on a 0-100 scale; DCA is 62.1.",
      [{ score: 62.1 }]
    );
    expect(result.ok).toBe(true);
  });

  it("regenerates once on a mismatch and succeeds", async () => {
    const llm = scriptedLlm([
      toolUseResponse("get_airport_metrics", { code: "SFO" }),
      textResponse("SFO's del15Rate is 99.9."), // wrong — no tool result near 99.9
      textResponse("SFO's del15Rate is 0.2."), // matches METRICS.SFO.del15Rate
    ]);
    const deps = newAgentDeps(llm);
    const agent = createAgent(deps);

    const reply = await agent.handleMessage("What's SFO's delay rate?", "s1");

    expect(reply.audited).toBe("regenerated");
    expect(reply.text).toContain("0.2");
  });

  it("falls back to a templated answer after two mismatches", async () => {
    const llm = scriptedLlm([
      toolUseResponse("get_airport_metrics", { code: "SFO" }),
      textResponse("SFO's del15Rate is 99.9."),
      textResponse("SFO's del15Rate is still wrong: 12345."),
    ]);
    const deps = newAgentDeps(llm);
    const agent = createAgent(deps);

    const reply = await agent.handleMessage("What's SFO's delay rate?", "s1");

    expect(reply.audited).toBe("templated");
    expect(reply.text).toContain('"code": "SFO"');
  });

  it("templatedAnswer with no tool results says it could not verify", () => {
    expect(templatedAnswer([])).toMatch(/unable to produce/i);
  });
});

describe("createAgent — refusals reach the LLM as narratable content", () => {
  it("passes a structured refusal through as a tool_result, not a throw", async () => {
    const llm = scriptedLlm([
      toolUseResponse("get_airport_metrics", { code: "ZZZ" }),
      textResponse("ZZZ is not in our airport universe."),
    ]);
    const deps = newAgentDeps(llm);
    const agent = createAgent(deps);

    const reply = await agent.handleMessage("What about ZZZ?", "s1");

    expect(reply.audited).toBe("passed");
    const toolResultMessage = llm.requests[1]!.messages.at(-1)!;
    expect(JSON.stringify(toolResultMessage.content)).toContain("out_of_scope_airport");
  });
});

describe("createAgent — describe_methodology LLM bypass", () => {
  it("returns the formatted payload directly after exactly one LLM call", async () => {
    const llm = scriptedLlm([toolUseResponse("describe_methodology", { kpi: "congestion" })]);
    const deps = newAgentDeps(llm);
    const agent = createAgent(deps);

    const reply = await agent.handleMessage("How do you define congestion?", "s1");

    expect(reply.audited).toBe("passed");
    expect(reply.text).toContain("del15Rate");
    expect(reply.text).toMatch(/relative to the/i);
    expect(llm.requests).toHaveLength(1);
    expect(deps.trace.events()).toHaveLength(1);
    expect(deps.trace.events()[0]!.tool).toBe("describe_methodology");
  });

  it("does not bypass when describe_methodology is called alongside another tool", async () => {
    const llm = scriptedLlm([
      {
        content: [
          { type: "tool_use", id: "call_1", name: "describe_methodology", input: {} },
          { type: "tool_use", id: "call_2", name: "get_airport_metrics", input: { code: "SFO" } },
        ],
      },
      textResponse("Congestion is defined as... and SFO handled 40000000 passengers."),
    ]);
    const deps = newAgentDeps(llm);
    const agent = createAgent(deps);

    const reply = await agent.handleMessage(
      "Explain congestion and tell me SFO's passengers.",
      "s1"
    );

    expect(reply.audited).toBe("passed");
    expect(llm.requests.length).toBeGreaterThan(1);
  });
});

describe("createAgent — session history", () => {
  it("replays prior-turn history on the next handleMessage call", async () => {
    const llm = scriptedLlm([
      textResponse("SFO is a large West Coast hub."),
      textResponse("JFK is a large East Coast hub."),
    ]);
    const deps = newAgentDeps(llm);
    const agent = createAgent(deps);

    await agent.handleMessage("Tell me about SFO.", "s1");
    await agent.handleMessage("What about JFK?", "s1");

    const secondRequest = llm.requests[1]!;
    const historyText = JSON.stringify(secondRequest.messages);
    expect(historyText).toContain("Tell me about SFO.");
    expect(historyText).toContain("SFO is a large West Coast hub.");
    expect(historyText).toContain("What about JFK?");
  });
});
