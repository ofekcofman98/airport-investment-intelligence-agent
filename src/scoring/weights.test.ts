import { describe, it, expect } from "vitest";
import {
  WEIGHTS_VERSION,
  MIN_ANNUAL_PASSENGERS,
  CONGESTION_WEIGHTS,
  UNMET_DEMAND_WEIGHTS,
  EXPANSION_WEIGHTS,
  renormalizeWeights,
  normalizationCaveat,
} from "./weights.js";

function sum(weights: Record<string, number>): number {
  return Object.values(weights).reduce((a, b) => a + b, 0);
}

describe("weight vectors", () => {
  it("CONGESTION_WEIGHTS sums to 1.0", () => {
    expect(sum(CONGESTION_WEIGHTS)).toBeCloseTo(1.0, 10);
  });

  it("UNMET_DEMAND_WEIGHTS sums to 1.0", () => {
    expect(sum(UNMET_DEMAND_WEIGHTS)).toBeCloseTo(1.0, 10);
  });

  it("EXPANSION_WEIGHTS sums to 1.0", () => {
    expect(sum(EXPANSION_WEIGHTS)).toBeCloseTo(1.0, 10);
  });

  it("WEIGHTS_VERSION is a non-empty version string", () => {
    expect(WEIGHTS_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("MIN_ANNUAL_PASSENGERS matches SPEC §1", () => {
    expect(MIN_ANNUAL_PASSENGERS).toBe(1_000_000);
  });
});

describe("renormalizeWeights", () => {
  const weights = { a: 0.3, b: 0.25, c: 0.2, d: 0.15, e: 0.1 };

  it("is the identity when all keys are present", () => {
    const { weights: out, retainedWeightShare } = renormalizeWeights(
      ["a", "b", "c", "d", "e"] as const,
      weights
    );
    expect(retainedWeightShare).toBeCloseTo(1.0, 10);
    for (const key of Object.keys(weights) as (keyof typeof weights)[]) {
      expect(out[key]).toBeCloseTo(weights[key], 10);
    }
  });

  it("rescales the remaining weights to sum to 1.0 when one is dropped", () => {
    const { weights: out, retainedWeightShare } = renormalizeWeights(
      ["a", "b", "c", "d"] as const,
      weights
    );
    expect(retainedWeightShare).toBeCloseTo(0.9, 10);
    expect(sum(out)).toBeCloseTo(1.0, 10);
    // 'e' must not appear in the rescaled output at all.
    expect(out).not.toHaveProperty("e");
  });

  it("dropping a signal yields a strictly lower retainedWeightShare than the full case", () => {
    const full = renormalizeWeights(["a", "b", "c", "d", "e"] as const, weights);
    const partial = renormalizeWeights(["a", "b", "c", "d"] as const, weights);
    expect(partial.retainedWeightShare).toBeLessThan(full.retainedWeightShare);
  });

  it("returns an empty weight map and zero share for an empty present list", () => {
    const { weights: out, retainedWeightShare } = renormalizeWeights(
      [] as const,
      weights
    );
    expect(retainedWeightShare).toBe(0);
    expect(Object.keys(out)).toHaveLength(0);
  });
});

describe("normalizationCaveat", () => {
  it("mentions the actual universe size and the relative-scoring warning", () => {
    const caveat = normalizationCaveat(48);
    expect(caveat).toContain("48");
    expect(caveat.toLowerCase()).toContain("relative");
    expect(caveat).toContain("400");
  });
});
