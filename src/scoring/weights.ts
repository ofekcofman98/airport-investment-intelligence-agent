/**
 * src/scoring/weights.ts — single source of truth for every weight
 * constant used by the scoring layer (SPEC §4, §4a). Never duplicate or
 * hand-tune a weight anywhere else; `effectiveWeights.ts` and
 * `proxyScores.ts` both compose from these constants.
 */

/** Bump on any weight change — surfaced in every scored payload so a
 * reader can tell which version of the methodology produced a number. */
export const WEIGHTS_VERSION = "1.0.0";

/** SPEC §1 — airports below this annual-passenger threshold are excluded
 * from rank_airports results (never from lookup/explain/compare). */
export const MIN_ANNUAL_PASSENGERS = 1_000_000;

/** Congestion Score weights (SPEC §4). All five signals are positively
 * oriented: higher raw value -> more congested -> higher score. */
export const CONGESTION_WEIGHTS = {
  del15Rate: 0.30,
  nasDelayPerDeparture: 0.25,
  avgTaxiOutMin: 0.20,
  loadFactor: 0.15,
  cancellationRate: 0.10,
} as const;

/** Unmet Demand Score weights (SPEC §4). All four signals positively
 * oriented: higher raw value -> more unmet demand -> higher score. */
export const UNMET_DEMAND_WEIGHTS = {
  loadFactor: 0.35,
  paxGrowthYoy: 0.30,
  nasDelayPerDeparture: 0.20,
  scheduleAdherenceGap: 0.15,
} as const;

/** Expansion Opportunity Score weights (SPEC §4) — composes the two
 * scores above plus growth and scale. Positively oriented throughout. */
export const EXPANSION_WEIGHTS = {
  congestionScore: 0.40,
  unmetDemandScore: 0.30,
  paxGrowthYoy: 0.20,
  logPassengers: 0.10,
} as const;

/**
 * The single place missing-component renormalization happens
 * (src/scoring/CLAUDE.md "Missing-component renormalization"). Rescales
 * the weights of the signals actually `present` back up to sum to 1.0.
 * `retainedWeightShare` is the sum of the present weights *before*
 * rescaling — feeds directly into `confidence = dataCompleteness *
 * retainedWeightShare` in proxyScores.ts.
 *
 * `present` with no entries returns an empty weight map and a share of 0
 * rather than dividing by zero — the caller is expected to treat a fully
 * dropped signal set as a null/unscoreable result, not call this with an
 * empty universe of present signals in the normal case.
 */
export function renormalizeWeights<K extends string>(
  present: readonly K[],
  weights: Record<K, number>
): { weights: Record<K, number>; retainedWeightShare: number } {
  const retainedWeightShare = present.reduce(
    (sum, key) => sum + weights[key],
    0
  );

  const rescaled: Record<string, number> = {};
  if (retainedWeightShare > 0) {
    for (const key of present) {
      rescaled[key] = weights[key] / retainedWeightShare;
    }
  }

  return { weights: rescaled as Record<K, number>, retainedWeightShare };
}

/**
 * SPEC §4a — the relative-normalization caveat, verbatim in substance,
 * with the actual in-scope universe size interpolated so the payload can
 * never disagree with the data it was computed from. Every scored
 * response must surface this string (enforced by a test on every KPI in
 * proxyScores.test.ts).
 */
export function normalizationCaveat(n: number): string {
  return (
    `This score is relative to the ~${n} major US airports in our ` +
    `dataset, not all ~400 US airports. A score of 90 means "near the ` +
    `top of this set", not "top 10% nationally".`
  );
}
