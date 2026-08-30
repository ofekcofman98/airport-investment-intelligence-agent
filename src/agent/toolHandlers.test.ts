import { describe, it, expect } from "vitest";
import type {
  AirportDataSource,
  AirportRef,
  AirportYearMetrics,
  SnapshotManifest,
} from "../data/types.js";
import {
  createToolHandlers,
  HIGH_SEASONALITY_CODES,
  NEGATIVE_GAP_NOTE,
  type MetricsResult,
  type ExplainPayload,
  type RankPayload,
  type ComparePayload,
  type MethodologyPayload,
  type ResolveResult,
} from "./toolHandlers.js";
import type { ToolRefusal } from "./tools.js";

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
  ref({ code: "BIG", name: "Big Airport", city: "Bigtown", state: "CA", region: "Pacific" }),
  ref({ code: "MID", name: "Mid Airport", city: "Midtown", state: "MA", region: "New England" }),
  ref({ code: "SML", name: "Small Airport", city: "Smallville", state: "VT", region: "New England" }),
  ref({ code: "ANC", name: "Anchorage Intl", city: "Anchorage", state: "AK", region: "Alaska" }),
  ref({ code: "ATL", name: "Atlanta Hub", city: "Atlanta", state: "GA", region: "Southeast" }),
  ref({ code: "SNA", name: "John Wayne (Santa Ana)", city: "Santa Ana", state: "CA", region: "Pacific" }),
  ref({ code: "LAX", name: "Los Angeles Intl", city: "Los Angeles", state: "CA", region: "Pacific" }),
  ref({ code: "JFK", name: "JFK Intl", city: "New York", state: "NY", region: "Mid-Atlantic" }),
  ref({ code: "LGA", name: "LaGuardia", city: "New York", state: "NY", region: "Mid-Atlantic" }),
  ref({ code: "EWR", name: "Newark Liberty Intl", city: "Newark", state: "NJ", region: "Mid-Atlantic" }),
  ref({ code: "DCA", name: "Reagan National", city: "Washington", state: "DC", region: "Mid-Atlantic" }),
  ref({ code: "IAD", name: "Dulles Intl", city: "Washington", state: "DC", region: "Mid-Atlantic" }),
];

const METRICS: Record<string, AirportYearMetrics> = {
  BIG: metrics({ code: "BIG", passengers: 40_000_000, del15Rate: 0.3, loadFactor: 0.95 }),
  MID: metrics({ code: "MID", passengers: 10_000_000, del15Rate: 0.15, loadFactor: 0.8 }),
  SML: metrics({
    code: "SML",
    passengers: 900_000, // below MIN_ANNUAL_PASSENGERS
    del15Rate: 0.05,
    loadFactor: 0.6,
  }),
  ANC: metrics({
    code: "ANC",
    passengers: 5_000_000,
    scheduleAdherenceGap: -0.02, // negative gap -> NEGATIVE_GAP_NOTE
    del15Rate: 0.2,
    loadFactor: 0.7,
  }),
};

const MANIFEST: SnapshotManifest = {
  builtAt: "2026-01-01T00:00:00Z",
  sources: [],
  analysisYear: 2025,
  priorYear: 2024,
  airportCount: REFS.length,
};

function fakeDataSource(opts?: { throwOnCode?: string }): AirportDataSource {
  // createToolHandlers eagerly reads getYearMetrics for every ref at
  // construction time; a throwOnCode fake must let that one pass so
  // construction succeeds, then throw only on a later, handler-triggered
  // call — isolating the per-call error path the guarded() wrapper exists
  // for, rather than a construction-time failure.
  let constructed = false;
  return {
    listAirports: () => REFS,
    getAirportRef: (code) => REFS.find((r) => r.code === code.toUpperCase()) ?? null,
    getYearMetrics: (code, year) => {
      if (opts?.throwOnCode && code.toUpperCase() === opts.throwOnCode && constructed) {
        throw new Error("simulated data-layer failure");
      }
      if (year !== MANIFEST.analysisYear) return null;
      return METRICS[code.toUpperCase()] ?? null;
    },
    getManifest: () => MANIFEST,
    _markConstructed: () => {
      constructed = true;
    },
  } as AirportDataSource & { _markConstructed: () => void };
}

/** A data source whose methods throw if ever invoked — used to assert
 * describe_methodology never touches the data source. */
function throwingDataSource(): AirportDataSource {
  const boom = (): never => {
    throw new Error("describe_methodology must not touch the data source");
  };
  return {
    listAirports: boom,
    getAirportRef: boom,
    getYearMetrics: boom,
    getManifest: () => MANIFEST,
  };
}

function isRefusal(x: unknown): x is ToolRefusal {
  return typeof x === "object" && x !== null && (x as { status?: unknown }).status === "refused";
}

const handlers = createToolHandlers(fakeDataSource());

describe("invalid arguments", () => {
  it("every handler returns an invalid_arguments refusal for malformed args, never a throw", () => {
    const cases: [keyof typeof handlers, unknown][] = [
      ["resolve_airports", {}],
      ["get_airport_metrics", { code: "sfo" }],
      ["rank_airports", { kpi: "not_a_kpi" }],
      ["compare_airports", { codes: ["BIG"], kpi: "congestion" }],
      ["explain_score", { code: "BIG" }],
      ["describe_methodology", { kpi: "nope" }],
    ];
    for (const [name, args] of cases) {
      const result = (handlers[name] as (a: unknown) => unknown)(args);
      expect(isRefusal(result)).toBe(true);
      if (isRefusal(result)) expect(result.reason).toBe("invalid_arguments");
    }
  });
});

describe("get_airport_metrics", () => {
  it("returns a refusal for an out-of-scope code", () => {
    const result = handlers.get_airport_metrics({ code: "ZZZ" });
    expect(isRefusal(result)).toBe(true);
    if (isRefusal(result)) expect(result.reason).toBe("out_of_scope_airport");
  });

  it("returns a refusal for a non-analysis year", () => {
    const result = handlers.get_airport_metrics({ code: "BIG", year: 2024 });
    expect(isRefusal(result)).toBe(true);
    if (isRefusal(result)) expect(result.reason).toBe("unsupported_year");
  });

  it("returns the metrics record for the analysis year (year omitted)", () => {
    const result = handlers.get_airport_metrics({ code: "BIG" }) as MetricsResult;
    expect(isRefusal(result)).toBe(false);
    expect(result.metrics.code).toBe("BIG");
    expect(result.ref.code).toBe("BIG");
    expect(result.notes.length).toBeGreaterThan(0);
  });

  it("attaches NEGATIVE_GAP_NOTE only when scheduleAdherenceGap is negative", () => {
    const negative = handlers.get_airport_metrics({ code: "ANC" }) as MetricsResult;
    const positive = handlers.get_airport_metrics({ code: "BIG" }) as MetricsResult;
    expect(negative.notes).toContain(NEGATIVE_GAP_NOTE);
    expect(positive.notes).not.toContain(NEGATIVE_GAP_NOTE);
  });
});

describe("resolve_airports", () => {
  it("matches by exact code", () => {
    const result = handlers.resolve_airports({ query: "BIG" }) as ResolveResult;
    expect(result.matches.map((m) => m.code)).toEqual(["BIG"]);
  });

  it("matches by city, case-insensitively", () => {
    const result = handlers.resolve_airports({ query: "midtown" }) as ResolveResult;
    expect(result.matches.map((m) => m.code)).toEqual(["MID"]);
  });

  it("returns an empty-match success (not a refusal) for an unknown query", () => {
    const result = handlers.resolve_airports({ query: "Nowhereville" }) as ResolveResult;
    expect(isRefusal(result)).toBe(false);
    expect(result.matches).toEqual([]);
    expect(result.message.length).toBeGreaterThan(0);
  });

  it("does not match a short query against an unrelated word it happens to be a mid-word substring of", () => {
    // "la" is a raw substring of "Atlanta" (At-la-nta) but should not match
    // it — regression for docs/fixes/answers/answer3.md.
    const result = handlers.resolve_airports({ query: "la" }) as ResolveResult;
    expect(result.matches.map((m) => m.code)).not.toContain("ATL");
  });

  it("resolves the curated 'LA' alias to Los Angeles", () => {
    const result = handlers.resolve_airports({ query: "LA" }) as ResolveResult;
    expect(result.matches.map((m) => m.code)).toEqual(["LAX"]);
  });

  it("matches a multi-word query with a trailing generic word against a multi-word city", () => {
    // Query is longer than the city field itself — a plain substring check
    // (field.includes(query)) can never match this.
    const result = handlers.resolve_airports({ query: "santa ana airport" }) as ResolveResult;
    expect(result.matches.map((m) => m.code)).toEqual(["SNA"]);
  });

  it("resolves the 'NYC' metro alias to all three New York-area airports", () => {
    const result = handlers.resolve_airports({ query: "NYC" }) as ResolveResult;
    expect(result.matches.map((m) => m.code).sort()).toEqual(["EWR", "JFK", "LGA"]);
  });

  it("resolves 'D.C.' (punctuation variant) to both DC-area airports", () => {
    const result = handlers.resolve_airports({ query: "D.C." }) as ResolveResult;
    expect(result.matches.map((m) => m.code).sort()).toEqual(["DCA", "IAD"]);
  });

  it("a metro alias short-circuits word-boundary matching (no LAS/LGA/etc. noise for 'la')", () => {
    const result = handlers.resolve_airports({ query: "la" }) as ResolveResult;
    expect(result.matches.map((m) => m.code)).toEqual(["LAX"]);
  });

  it("degrades an alias whose target codes are absent from the current universe to no match", () => {
    // "bay area" -> SFO/OAK/SJC, none of which are in this test's REFS.
    const result = handlers.resolve_airports({ query: "bay area" }) as ResolveResult;
    expect(isRefusal(result)).toBe(false);
    expect(result.matches).toEqual([]);
  });
});

describe("rank_airports", () => {
  it("excludes the sub-threshold airport from results and lists it in excluded", () => {
    const result = handlers.rank_airports({ kpi: "congestion" }) as RankPayload;
    expect(result.results.some((r) => r.code === "SML")).toBe(false);
    expect(result.excluded.some((e) => e.code === "SML" && e.reason === "below_min_volume")).toBe(true);
  });

  it("carries a non-empty normalization caveat", () => {
    const result = handlers.rank_airports({ kpi: "congestion" }) as RankPayload;
    expect(result.normalization.caveat.length).toBeGreaterThan(0);
  });

  it("rounds each ranked entry's score to 1 decimal", () => {
    const result = handlers.rank_airports({ kpi: "congestion" }) as RankPayload;
    for (const entry of result.results) {
      expect(entry.result.score).toBeCloseTo(Math.round(entry.result.score * 10) / 10, 10);
    }
  });
});

describe("compare_airports", () => {
  it("refuses with the bad codes named when a code is out of scope", () => {
    const result = handlers.compare_airports({ codes: ["BIG", "ZZZ"], kpi: "congestion" });
    expect(isRefusal(result)).toBe(true);
    if (isRefusal(result)) {
      expect(result.reason).toBe("out_of_scope_airport");
      expect(result.details?.codes).toEqual(["ZZZ"]);
    }
  });

  it("compares two in-scope codes and carries the caveat", () => {
    const result = handlers.compare_airports({ codes: ["BIG", "MID"], kpi: "congestion" }) as ComparePayload;
    expect(result.comparisons.map((c) => c.code).sort()).toEqual(["BIG", "MID"]);
    expect(result.normalization.caveat.length).toBeGreaterThan(0);
  });

  it("rounds comparison scores and driver-delta values to 1 decimal", () => {
    const result = handlers.compare_airports({ codes: ["BIG", "MID"], kpi: "congestion" }) as ComparePayload;
    for (const c of result.comparisons) {
      expect(c.score).toBeCloseTo(Math.round(c.score * 10) / 10, 10);
    }
    for (const d of result.driverDeltas) {
      expect(d.maxDelta).toBeCloseTo(Math.round(d.maxDelta * 10) / 10, 10);
    }
  });
});

describe("explain_score", () => {
  it("refuses for an out-of-scope code", () => {
    const result = handlers.explain_score({ code: "ZZZ", kpi: "congestion" });
    expect(isRefusal(result)).toBe(true);
    if (isRefusal(result)) expect(result.reason).toBe("out_of_scope_airport");
  });

  it("rounds the score to 1 decimal", () => {
    const result = handlers.explain_score({ code: "BIG", kpi: "congestion" }) as ExplainPayload;
    expect(result.result.score).toBeCloseTo(Math.round(result.result.score * 10) / 10, 10);
  });

  it("carries the normalization caveat", () => {
    const result = handlers.explain_score({ code: "BIG", kpi: "congestion" }) as ExplainPayload;
    expect(result.result.normalization.caveat.length).toBeGreaterThan(0);
  });

  it("flags the high-seasonality note only for a HIGH_SEASONALITY_CODES member", () => {
    expect(HIGH_SEASONALITY_CODES.has("ANC")).toBe(true);
    const seasonal = handlers.explain_score({ code: "ANC", kpi: "congestion" }) as ExplainPayload;
    const nonSeasonal = handlers.explain_score({ code: "BIG", kpi: "congestion" }) as ExplainPayload;
    expect(seasonal.notes.some((n) => n.includes("ANC"))).toBe(true);
    expect(nonSeasonal.notes.some((n) => n.includes("BIG"))).toBe(false);
  });

  it("attaches NEGATIVE_GAP_NOTE only for the airport with a negative gap", () => {
    const negative = handlers.explain_score({ code: "ANC", kpi: "congestion" }) as ExplainPayload;
    const positive = handlers.explain_score({ code: "BIG", kpi: "congestion" }) as ExplainPayload;
    expect(negative.notes).toContain(NEGATIVE_GAP_NOTE);
    expect(positive.notes).not.toContain(NEGATIVE_GAP_NOTE);
  });
});

describe("describe_methodology", () => {
  it("never touches the data source", () => {
    const isolated = createToolHandlers(throwingDataSource());
    expect(() => isolated.describe_methodology({})).not.toThrow();
  });

  it("returns effective weights summing to 1.0", () => {
    const result = handlers.describe_methodology({}) as MethodologyPayload;
    const total = Object.values(result.effectiveWeights).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1.0, 10);
  });

  it("returns all four KPIs when kpi is omitted, one when given", () => {
    const all = handlers.describe_methodology({}) as MethodologyPayload;
    const one = handlers.describe_methodology({ kpi: "spare_capacity" }) as MethodologyPayload;
    expect(all.entries).toHaveLength(4);
    expect(one.entries).toHaveLength(1);
    expect(one.entries[0]!.kpi).toBe("spare_capacity");
  });
});

describe("error handling", () => {
  it("converts an unexpected data-layer throw into a no_data refusal with no stack trace", () => {
    const source = fakeDataSource({ throwOnCode: "BIG" }) as AirportDataSource & {
      _markConstructed: () => void;
    };
    const brokenHandlers = createToolHandlers(source);
    source._markConstructed();
    const result = brokenHandlers.get_airport_metrics({ code: "BIG" });
    expect(isRefusal(result)).toBe(true);
    if (isRefusal(result)) {
      expect(result.reason).toBe("no_data");
      const serialized = JSON.stringify(result);
      expect(serialized).not.toMatch(/at Object\.<anonymous>/);
    }
  });
});
