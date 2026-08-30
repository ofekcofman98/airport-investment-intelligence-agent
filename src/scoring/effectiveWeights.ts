/**
 * src/scoring/effectiveWeights.ts — the compounded-influence table
 * (docs/architecture.md "Effective weights: what actually drives the
 * headline score"; SPEC §4 "Overlap" tradeoff).
 *
 * `loadFactor` and `nasDelayPerDeparture` each feed both Congestion and
 * Unmet Demand, which then both feed Expansion Opportunity, so their true
 * influence on the headline score compounds across two channels. This
 * file multiplies that composition through purely from the constants in
 * weights.ts — it takes no arguments and can never drift out of sync by
 * hand, only by weights.ts or proxyScores.ts's composition changing.
 */

import {
  CONGESTION_WEIGHTS,
  UNMET_DEMAND_WEIGHTS,
  EXPANSION_WEIGHTS,
} from "./weights.js";

/** Every raw signal that feeds Expansion Opportunity, directly or via a
 * composed sub-score, per proxyScores.ts's composition. */
export type RawSignal =
  | "loadFactor"
  | "nasDelayPerDeparture"
  | "del15Rate"
  | "avgTaxiOutMin"
  | "cancellationRate"
  | "paxGrowthYoy"
  | "scheduleAdherenceGap"
  | "logPassengers";

/**
 * Each raw signal's total compounded contribution to Expansion
 * Opportunity. Returned values sum to 1.0 (asserted by a unit test) and
 * match the table published by `describe_methodology`.
 */
export function effectiveRawWeights(): Record<RawSignal, number> {
  const congestionShare = EXPANSION_WEIGHTS.congestionScore;
  const unmetDemandShare = EXPANSION_WEIGHTS.unmetDemandScore;

  return {
    // Fed by both Congestion and Unmet Demand.
    loadFactor:
      congestionShare * CONGESTION_WEIGHTS.loadFactor +
      unmetDemandShare * UNMET_DEMAND_WEIGHTS.loadFactor,
    nasDelayPerDeparture:
      congestionShare * CONGESTION_WEIGHTS.nasDelayPerDeparture +
      unmetDemandShare * UNMET_DEMAND_WEIGHTS.nasDelayPerDeparture,

    // Fed by Congestion only.
    del15Rate: congestionShare * CONGESTION_WEIGHTS.del15Rate,
    avgTaxiOutMin: congestionShare * CONGESTION_WEIGHTS.avgTaxiOutMin,
    cancellationRate: congestionShare * CONGESTION_WEIGHTS.cancellationRate,

    // Fed directly by Expansion Opportunity AND via Unmet Demand.
    paxGrowthYoy:
      EXPANSION_WEIGHTS.paxGrowthYoy +
      unmetDemandShare * UNMET_DEMAND_WEIGHTS.paxGrowthYoy,

    // Fed by Unmet Demand only.
    scheduleAdherenceGap:
      unmetDemandShare * UNMET_DEMAND_WEIGHTS.scheduleAdherenceGap,

    // Fed directly by Expansion Opportunity only.
    logPassengers: EXPANSION_WEIGHTS.logPassengers,
  };
}
