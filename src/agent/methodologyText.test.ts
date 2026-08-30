import { describe, it, expect } from "vitest";
import { formatMethodology } from "./methodologyText.js";
import type { MethodologyPayload } from "./toolHandlers.js";
import { normalizationCaveat } from "../scoring/weights.js";

const PAYLOAD: MethodologyPayload = {
  weightsVersion: "v1",
  minAnnualPassengers: 1_000_000,
  caveat: normalizationCaveat(46),
  entries: [
    {
      kpi: "congestion",
      weights: { del15Rate: 0.3, nasDelayPerDeparture: 0.25, avgTaxiOutMin: 0.2, loadFactor: 0.15, cancellationRate: 0.1 },
    },
  ],
  effectiveWeights: { loadFactor: 0.165, nasDelayPerDeparture: 0.16 },
};

describe("formatMethodology", () => {
  it("includes the SPEC §4a relative-normalization caveat verbatim", () => {
    const text = formatMethodology(PAYLOAD);
    expect(text).toContain(PAYLOAD.caveat);
  });

  it("includes each weight for every requested KPI", () => {
    const text = formatMethodology(PAYLOAD);
    expect(text).toContain("del15Rate: 30%");
    expect(text).toContain("loadFactor: 15%");
  });

  it("includes the weights version and minimum-passenger threshold", () => {
    const text = formatMethodology(PAYLOAD);
    expect(text).toContain("v1");
    expect(text).toContain("1,000,000");
  });

  it("includes effective (compounded) weights", () => {
    const text = formatMethodology(PAYLOAD);
    expect(text).toContain("loadFactor: 16.5%");
  });

  it("handles multiple KPI entries", () => {
    const multi: MethodologyPayload = {
      ...PAYLOAD,
      entries: [
        ...PAYLOAD.entries,
        { kpi: "spare_capacity", weights: { del15Rate: 0.3 } },
      ],
    };
    const text = formatMethodology(multi);
    expect(text).toContain("Congestion Score");
    expect(text).toContain("Spare Capacity Score");
  });
});
