import { describe, it, expect } from "vitest";
import type { AirportYearMetrics } from "../data/types.js";
import {
  buildNormalizationContext,
  normalizeSignal,
  congestionScore,
  unmetDemandScore,
  expansionOpportunityScore,
  spareCapacityScore,
  scoreUniverse,
} from "./proxyScores.js";

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

// Three-airport universe with clear low/mid/high spread on every signal.
const LOW = airport({
  code: "LOW",
  passengers: 1_000_000,
  loadFactor: 0.6,
  scheduleAdherenceGap: -0.05,
  del15Rate: 0.05,
  avgTaxiOutMin: 10,
  nasDelayPerDeparture: 1,
  cancellationRate: 0.01,
  paxGrowthYoy: -0.05,
});
// Exact midpoint of LOW/HIGH on every congestion/unmet-demand signal, so
// its min-max normalized value is exactly 50 on each of them.
const MID = airport({
  code: "MID",
  passengers: 10_000_000,
  loadFactor: 0.775, // (0.6 + 0.95) / 2
  scheduleAdherenceGap: 0.075, // (-0.05 + 0.2) / 2
  del15Rate: 0.175, // (0.05 + 0.3) / 2
  avgTaxiOutMin: 17.5, // (10 + 25) / 2
  nasDelayPerDeparture: 3.5, // (1 + 6) / 2
  cancellationRate: 0.03, // (0.01 + 0.05) / 2
  paxGrowthYoy: 0.025, // (-0.05 + 0.1) / 2
});
const HIGH = airport({
  code: "HIGH",
  passengers: 50_000_000,
  loadFactor: 0.95,
  scheduleAdherenceGap: 0.2,
  del15Rate: 0.3,
  avgTaxiOutMin: 25,
  nasDelayPerDeparture: 6,
  cancellationRate: 0.05,
  paxGrowthYoy: 0.1,
});

const UNIVERSE = [LOW, MID, HIGH];

describe("normalizeSignal", () => {
  it("maps the min to 0 and the max to 100", () => {
    expect(normalizeSignal(0, 0, 10)).toBe(0);
    expect(normalizeSignal(10, 0, 10)).toBe(100);
  });

  it("maps the midpoint to 50", () => {
    expect(normalizeSignal(5, 0, 10)).toBe(50);
  });

  it("returns 50 when the universe has no spread on a signal", () => {
    expect(normalizeSignal(42, 7, 7)).toBe(50);
  });
});

describe("congestionScore", () => {
  const ctx = buildNormalizationContext(UNIVERSE);

  it("matches a hand-computed score for the MID airport", () => {
    // Every MID signal sits exactly at the midpoint of LOW/HIGH, so each
    // normalized value is 50 and the weighted score is 50 regardless of
    // the weight vector (sum of weights is 1.0 by construction).
    const result = congestionScore(MID, ctx);
    expect(result.score).toBeCloseTo(50, 6);
  });

  it("breakdown contributions sum to the score", () => {
    for (const m of UNIVERSE) {
      const result = congestionScore(m, ctx);
      const sum = result.breakdown.reduce((s, e) => s + e.contribution, 0);
      expect(sum).toBeCloseTo(result.score, 6);
    }
  });

  it("drops a null component instead of scoring it as 0, and renormalizes weights to 1.0", () => {
    const thin = { ...MID, code: "THIN", del15Rate: null };
    const result = congestionScore(thin, ctx);

    expect(result.droppedSignals).toContain("del15Rate");
    expect(result.breakdown.some((e) => e.signal === "del15Rate")).toBe(false);
    const weightSum = result.breakdown.reduce((s, e) => s + e.weight, 0);
    expect(weightSum).toBeCloseTo(1.0, 6);
  });

  it("gives the thin-data airport strictly lower confidence than the full-data case", () => {
    const full = congestionScore(MID, ctx);
    const thin = congestionScore({ ...MID, del15Rate: null }, ctx);
    expect(thin.confidence).toBeLessThan(full.confidence);
  });

  it("normalizes a negative scheduleAdherenceGap without throwing (it is not clamped)", () => {
    // scheduleAdherenceGap is not a congestion signal, but loadFactor and
    // other congestion inputs must tolerate a universe where some other
    // airport has a negative gap without that value ever reaching NaN.
    expect(() => congestionScore(LOW, ctx)).not.toThrow();
    expect(Number.isFinite(congestionScore(LOW, ctx).score)).toBe(true);
  });

  it("every payload carries the SPEC §4a normalization caveat", () => {
    for (const m of UNIVERSE) {
      const result = congestionScore(m, ctx);
      expect(result.normalization.caveat.length).toBeGreaterThan(0);
      expect(result.normalization.n).toBe(UNIVERSE.length);
    }
  });
});

describe("unmetDemandScore", () => {
  const ctx = buildNormalizationContext(UNIVERSE);

  it("normalizes a negative paxGrowthYoy without throwing", () => {
    const result = unmetDemandScore(LOW, ctx);
    expect(Number.isFinite(result.score)).toBe(true);
  });

  it("drops paxGrowthYoy when null and still sums weights to 1.0", () => {
    const thin = { ...MID, paxGrowthYoy: null };
    const result = unmetDemandScore(thin, ctx);
    expect(result.droppedSignals).toContain("paxGrowthYoy");
    const weightSum = result.breakdown.reduce((s, e) => s + e.weight, 0);
    expect(weightSum).toBeCloseTo(1.0, 6);
  });

  it("carries the normalization caveat", () => {
    expect(unmetDemandScore(MID, ctx).normalization.caveat.length).toBeGreaterThan(0);
  });
});

describe("expansionOpportunityScore", () => {
  const ctx = buildNormalizationContext(UNIVERSE);

  it("composes congestion and unmet demand without throwing and stays in [0, 100]", () => {
    for (const m of UNIVERSE) {
      const result = expansionOpportunityScore(m, ctx);
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(100);
    }
  });

  it("drops paxGrowthYoy when null and renormalizes the remaining three weights to 1.0", () => {
    const thin = { ...MID, paxGrowthYoy: null };
    const result = expansionOpportunityScore(thin, ctx);
    expect(result.droppedSignals).toContain("paxGrowthYoy");
    const weightSum = result.breakdown.reduce((s, e) => s + e.weight, 0);
    expect(weightSum).toBeCloseTo(1.0, 6);
  });

  it("degrades confidence when a sub-score's input is missing", () => {
    const full = expansionOpportunityScore(MID, ctx);
    const thin = expansionOpportunityScore({ ...MID, del15Rate: null }, ctx);
    expect(thin.confidence).toBeLessThan(full.confidence);
  });

  it("carries the normalization caveat", () => {
    expect(expansionOpportunityScore(MID, ctx).normalization.caveat.length).toBeGreaterThan(0);
  });
});

describe("spareCapacityScore", () => {
  const ctx = buildNormalizationContext(UNIVERSE);

  it("equals 100 minus the congestion score for every airport", () => {
    for (const m of UNIVERSE) {
      const spare = spareCapacityScore(m, ctx);
      const cong = congestionScore(m, ctx);
      expect(spare.score).toBeCloseTo(100 - cong.score, 6);
    }
  });

  it("carries the normalization caveat", () => {
    expect(spareCapacityScore(MID, ctx).normalization.caveat.length).toBeGreaterThan(0);
  });
});

describe("scoreUniverse", () => {
  it("scores every airport with all four KPIs, each carrying the caveat", () => {
    const scores = scoreUniverse(UNIVERSE);
    expect(scores.size).toBe(UNIVERSE.length);
    for (const all of scores.values()) {
      for (const result of [
        all.congestion,
        all.unmetDemand,
        all.expansionOpportunity,
        all.spareCapacity,
      ]) {
        expect(result.normalization.caveat.length).toBeGreaterThan(0);
      }
    }
  });
});
