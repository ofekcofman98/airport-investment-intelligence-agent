import { describe, it, expect } from "vitest";
import type { AirportRef, AirportYearMetrics } from "../data/types.js";
import { rankAirports, compareAirports } from "./rankCompare.js";
import { MIN_ANNUAL_PASSENGERS } from "./weights.js";

function airport(overrides: Partial<AirportYearMetrics>): AirportYearMetrics {
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

const BIG = airport({ code: "BIG", passengers: 40_000_000, del15Rate: 0.3, loadFactor: 0.95 });
const MID = airport({ code: "MID", passengers: 10_000_000, del15Rate: 0.15, loadFactor: 0.8 });
const SMALL = airport({
  code: "SML",
  passengers: MIN_ANNUAL_PASSENGERS - 1, // below threshold
  del15Rate: 0.05,
  loadFactor: 0.6,
});

const UNIVERSE = [BIG, MID, SMALL];

const REFS: AirportRef[] = [
  ref({ code: "BIG", region: "Pacific", state: "CA" }),
  ref({ code: "MID", region: "New England", state: "MA" }),
  ref({ code: "SML", region: "New England", state: "VT" }),
];

describe("rankAirports", () => {
  it("excludes a sub-threshold airport from results and lists it in excluded", () => {
    const { results, excluded } = rankAirports(UNIVERSE, { kpi: "congestion" });

    expect(results.some((r) => r.code === "SML")).toBe(false);
    expect(excluded).toEqual([
      { code: "SML", reason: "below_min_volume", passengers: SMALL.passengers },
    ]);
  });

  it("ranks descending by score and respects n", () => {
    const { results } = rankAirports(UNIVERSE, { kpi: "congestion", n: 1 });
    expect(results).toHaveLength(1);
    expect(results[0]!.code).toBe("BIG"); // highest del15Rate/loadFactor
    expect(results[0]!.rank).toBe(1);
  });

  it("a region filter narrows results without changing any airport's score", () => {
    const unfiltered = rankAirports(UNIVERSE, { kpi: "congestion" });
    const filtered = rankAirports(
      UNIVERSE,
      { kpi: "congestion", filter: { region: "New England" } },
      REFS
    );

    expect(filtered.results.map((r) => r.code)).toEqual(["MID"]);
    const midUnfiltered = unfiltered.results.find((r) => r.code === "MID")!;
    const midFiltered = filtered.results.find((r) => r.code === "MID")!;
    // Same normalization context (built over the full universe either way).
    expect(midFiltered.result.score).toBeCloseTo(midUnfiltered.result.score, 10);
  });

  it("every payload carries the normalization caveat", () => {
    const { normalization } = rankAirports(UNIVERSE, { kpi: "congestion" });
    expect(normalization.caveat.length).toBeGreaterThan(0);
    expect(normalization.n).toBe(UNIVERSE.length);
  });
});

describe("compareAirports", () => {
  it("includes a sub-threshold airport (no volume threshold applies to comparison)", () => {
    const { comparisons } = compareAirports(UNIVERSE, ["BIG", "SML"], "congestion");
    expect(comparisons.map((c) => c.code).sort()).toEqual(["BIG", "SML"]);
  });

  it("computes driver deltas with correct signs and magnitude", () => {
    const { driverDeltas } = compareAirports(UNIVERSE, ["BIG", "SML"], "congestion");
    const del15Delta = driverDeltas.find((d) => d.signal === "del15Rate")!;
    const big = del15Delta.values.BIG!;
    const small = del15Delta.values.SML!;
    expect(big).toBeGreaterThan(small);
    expect(del15Delta.maxDelta).toBeCloseTo(big - small, 10);
  });

  it("carries the normalization caveat", () => {
    const { normalization } = compareAirports(UNIVERSE, ["BIG", "MID"], "congestion");
    expect(normalization.caveat.length).toBeGreaterThan(0);
  });
});
