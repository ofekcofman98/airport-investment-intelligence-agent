import { describe, it, expect } from "vitest";
import { effectiveRawWeights, type RawSignal } from "./effectiveWeights.js";

describe("effectiveRawWeights", () => {
  const weights = effectiveRawWeights();

  it("sums to 1.0 (SPEC §7)", () => {
    const total = Object.values(weights).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1.0, 10);
  });

  it("matches the compounded influence table in docs/architecture.md", () => {
    expect(weights.loadFactor).toBeCloseTo(0.165, 3);
    expect(weights.nasDelayPerDeparture).toBeCloseTo(0.16, 3);
    expect(weights.del15Rate).toBeCloseTo(0.12, 3);
    expect(weights.avgTaxiOutMin).toBeCloseTo(0.08, 3);
    expect(weights.cancellationRate).toBeCloseTo(0.04, 3);
    expect(weights.paxGrowthYoy).toBeCloseTo(0.29, 3);
    expect(weights.scheduleAdherenceGap).toBeCloseTo(0.045, 3);
    expect(weights.logPassengers).toBeCloseTo(0.1, 3);
  });

  it("covers exactly the raw signals proxyScores.ts composes into Expansion Opportunity", () => {
    const expected: RawSignal[] = [
      "loadFactor",
      "nasDelayPerDeparture",
      "del15Rate",
      "avgTaxiOutMin",
      "cancellationRate",
      "paxGrowthYoy",
      "scheduleAdherenceGap",
      "logPassengers",
    ];
    expect(Object.keys(weights).sort()).toEqual([...expected].sort());
  });
});
