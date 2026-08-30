/**
 * src/scoring/proxyScores.ts — Congestion / Unmet Demand / Expansion
 * Opportunity / Spare Capacity scores (SPEC §4). Pure functions only: no
 * I/O, no imports outside src/data/types.ts (types only) and this
 * layer's own weights.ts/types.ts.
 *
 * All signals used below are positively oriented — a higher raw value
 * always means a higher score (more congested / more unmet demand / more
 * opportunity). If a future signal is added that runs the other way, it
 * must be inverted (e.g. `100 - normalized`) before entering a breakdown;
 * nothing here does that inversion implicitly.
 */

import type { AirportCode, AirportYearMetrics } from "../data/types.js";
import {
  CONGESTION_WEIGHTS,
  UNMET_DEMAND_WEIGHTS,
  EXPANSION_WEIGHTS,
  WEIGHTS_VERSION,
  renormalizeWeights,
  normalizationCaveat,
} from "./weights.js";
import type {
  AllScores,
  Normalization,
  NormalizationContext,
  ScoreResult,
  SignalContribution,
} from "./types.js";

/** Raw signal names that need a min-max range across the universe.
 * `logPassengers` is derived (Math.log10(passengers)), not a direct
 * AirportYearMetrics field, so it is computed here rather than read off m. */
const RAW_SIGNAL_NAMES = [
  "del15Rate",
  "nasDelayPerDeparture",
  "avgTaxiOutMin",
  "loadFactor",
  "cancellationRate",
  "scheduleAdherenceGap",
  "paxGrowthYoy",
  "logPassengers",
] as const;

type RawSignalName = (typeof RAW_SIGNAL_NAMES)[number];

function rawSignalValue(
  m: AirportYearMetrics,
  signal: RawSignalName
): number | null {
  switch (signal) {
    case "logPassengers":
      return Math.log10(m.passengers);
    default:
      return m[signal];
  }
}

/**
 * Per-signal min/max over non-null values across the universe, plus n
 * (universe size) and the analysis year. Built once per universe and
 * passed explicitly into every scoring function below — scoring never
 * reaches back into the data layer to recompute this itself.
 */
export function buildNormalizationContext(
  universe: readonly AirportYearMetrics[]
): NormalizationContext {
  const ranges: Record<string, { min: number; max: number }> = {};

  for (const signal of RAW_SIGNAL_NAMES) {
    let min = Infinity;
    let max = -Infinity;
    for (const m of universe) {
      const value = rawSignalValue(m, signal);
      if (value === null) continue;
      if (value < min) min = value;
      if (value > max) max = value;
    }
    // No non-null observation at all: leave a degenerate [0, 0] range.
    // normalizeSignal's min===max branch (-> 50) makes this safe; it
    // only matters if every airport in the universe lacks this signal,
    // which would already tank confidence to 0 for anyone using it.
    ranges[signal] = min <= max ? { min, max } : { min: 0, max: 0 };
  }

  const year = universe.length > 0 ? universe[0]!.year : 0;

  return { ranges, n: universe.length, year };
}

function getRange(
  ctx: NormalizationContext,
  signal: RawSignalName
): { min: number; max: number } {
  const range = ctx.ranges[signal];
  if (!range) {
    throw new Error(
      `normalization context is missing a range for signal "${signal}" — ` +
        `buildNormalizationContext must be called with the full universe`
    );
  }
  return range;
}

/**
 * Min-max normalize a raw value to 0-100. When the universe has no
 * spread on this signal (min === max), there is no relative information
 * to report — returning 50 avoids fabricating a false "top" or "bottom"
 * ranking claim for every airport tied on that signal.
 */
export function normalizeSignal(value: number, min: number, max: number): number {
  if (min === max) return 50;
  return ((value - min) / (max - min)) * 100;
}

function buildNormalization(ctx: NormalizationContext): Normalization {
  return {
    basis: "in-scope universe",
    n: ctx.n,
    year: ctx.year,
    caveat: normalizationCaveat(ctx.n),
  };
}

/**
 * Computes a weighted score from a fixed set of raw signals, dropping
 * (never zero-scoring) any signal whose raw value is null and
 * renormalizing the remaining weights via weights.ts's single helper.
 */
function computeWeightedScore<K extends RawSignalName>(
  m: AirportYearMetrics,
  ctx: NormalizationContext,
  weights: Record<K, number>
): { breakdown: SignalContribution[]; dropped: string[]; score: number; retainedWeightShare: number } {
  const allSignals = Object.keys(weights) as K[];
  const present: K[] = [];
  const raws: Partial<Record<K, number>> = {};

  for (const signal of allSignals) {
    const raw = rawSignalValue(m, signal);
    if (raw === null) continue;
    present.push(signal);
    raws[signal] = raw;
  }

  const dropped = allSignals.filter((s) => !present.includes(s));
  const { weights: renormed, retainedWeightShare } = renormalizeWeights(
    present,
    weights
  );

  const breakdown: SignalContribution[] = present.map((signal) => {
    const raw = raws[signal]!;
    const { min, max } = getRange(ctx, signal);
    const normalized = normalizeSignal(raw, min, max);
    const weight = renormed[signal];
    return { signal, raw, normalized, weight, contribution: normalized * weight };
  });

  // Clamp guards against float summation drift (weighted [0,100]
  // sub-contributions can overshoot 100 by a fraction of a ULP) — not a
  // logic bug, so don't "fix" it back out.
  const score = Math.min(100, Math.max(0, breakdown.reduce((sum, entry) => sum + entry.contribution, 0)));

  return { breakdown, dropped, score, retainedWeightShare };
}

export function congestionScore(
  m: AirportYearMetrics,
  ctx: NormalizationContext
): ScoreResult {
  const { breakdown, dropped, score, retainedWeightShare } =
    computeWeightedScore(m, ctx, CONGESTION_WEIGHTS);

  return {
    kpi: "congestion",
    code: m.code,
    score,
    breakdown,
    droppedSignals: dropped,
    confidence: m.dataCompleteness * retainedWeightShare,
    weightsVersion: WEIGHTS_VERSION,
    normalization: buildNormalization(ctx),
  };
}

export function unmetDemandScore(
  m: AirportYearMetrics,
  ctx: NormalizationContext
): ScoreResult {
  const { breakdown, dropped, score, retainedWeightShare } =
    computeWeightedScore(m, ctx, UNMET_DEMAND_WEIGHTS);

  return {
    kpi: "unmet_demand",
    code: m.code,
    score,
    breakdown,
    droppedSignals: dropped,
    confidence: m.dataCompleteness * retainedWeightShare,
    weightsVersion: WEIGHTS_VERSION,
    normalization: buildNormalization(ctx),
  };
}

/**
 * Composes congestion + unmet demand with direct growth/scale signals
 * (SPEC §4). The two sub-scores are already on a universe-relative 0-100
 * scale, so they enter this score as-is (raw === normalized) rather than
 * being min-max normalized a second time. Confidence propagates the
 * sub-scores' own confidence rather than re-deriving it from scratch, so
 * a thin-data sub-score degrades the headline score's confidence too.
 */
export function expansionOpportunityScore(
  m: AirportYearMetrics,
  ctx: NormalizationContext
): ScoreResult {
  const congestion = congestionScore(m, ctx);
  const unmetDemand = unmetDemandScore(m, ctx);

  const congestionEntry: SignalContribution = {
    signal: "congestionScore",
    raw: congestion.score,
    normalized: congestion.score,
    weight: EXPANSION_WEIGHTS.congestionScore,
    contribution: congestion.score * EXPANSION_WEIGHTS.congestionScore,
  };
  const unmetDemandEntry: SignalContribution = {
    signal: "unmetDemandScore",
    raw: unmetDemand.score,
    normalized: unmetDemand.score,
    weight: EXPANSION_WEIGHTS.unmetDemandScore,
    contribution: unmetDemand.score * EXPANSION_WEIGHTS.unmetDemandScore,
  };

  const logPassengersRaw = Math.log10(m.passengers);
  const logRange = getRange(ctx, "logPassengers");
  const logPassengersEntry: SignalContribution = {
    signal: "logPassengers",
    raw: logPassengersRaw,
    normalized: normalizeSignal(logPassengersRaw, logRange.min, logRange.max),
    weight: EXPANSION_WEIGHTS.logPassengers,
    contribution:
      normalizeSignal(logPassengersRaw, logRange.min, logRange.max) *
      EXPANSION_WEIGHTS.logPassengers,
  };

  const dropped: string[] = [];
  let paxGrowthEntry: SignalContribution | null = null;
  if (m.paxGrowthYoy !== null) {
    const range = getRange(ctx, "paxGrowthYoy");
    const normalized = normalizeSignal(m.paxGrowthYoy, range.min, range.max);
    paxGrowthEntry = {
      signal: "paxGrowthYoy",
      raw: m.paxGrowthYoy,
      normalized,
      weight: EXPANSION_WEIGHTS.paxGrowthYoy,
      contribution: normalized * EXPANSION_WEIGHTS.paxGrowthYoy,
    };
  } else {
    dropped.push("paxGrowthYoy");
  }

  // congestionScore/unmetDemandScore/logPassengers are always present
  // (loadFactor and passengers are never null), so only paxGrowthYoy can
  // ever be dropped here. Renormalize the four direct weights over
  // whichever of them are present, same pattern as computeWeightedScore.
  const presentDirect: (keyof typeof EXPANSION_WEIGHTS)[] = paxGrowthEntry
    ? ["congestionScore", "unmetDemandScore", "paxGrowthYoy", "logPassengers"]
    : ["congestionScore", "unmetDemandScore", "logPassengers"];
  const { weights: renormed, retainedWeightShare } = renormalizeWeights(
    presentDirect,
    EXPANSION_WEIGHTS
  );

  const rescale = (entry: SignalContribution, key: keyof typeof EXPANSION_WEIGHTS): SignalContribution => ({
    ...entry,
    weight: renormed[key],
    contribution: entry.normalized * renormed[key],
  });

  const breakdown = [
    rescale(congestionEntry, "congestionScore"),
    rescale(unmetDemandEntry, "unmetDemandScore"),
    ...(paxGrowthEntry ? [rescale(paxGrowthEntry, "paxGrowthYoy")] : []),
    rescale(logPassengersEntry, "logPassengers"),
  ];

  // Clamp guards against float summation drift (weighted [0,100]
  // sub-contributions can overshoot 100 by a fraction of a ULP) — not a
  // logic bug, so don't "fix" it back out.
  const score = Math.min(100, Math.max(0, breakdown.reduce((sum, entry) => sum + entry.contribution, 0)));

  // Weighted average of the retained inputs' own confidence: the two
  // composed sub-scores contribute their real confidence, the two direct
  // signals contribute 1 (they are either present at full quality or
  // dropped entirely, which renormalizeWeights already accounts for via
  // retainedWeightShare / the weights used here).
  const confidence = breakdown.reduce((sum, entry) => {
    const subConfidence =
      entry.signal === "congestionScore"
        ? congestion.confidence
        : entry.signal === "unmetDemandScore"
          ? unmetDemand.confidence
          : 1;
    return sum + entry.weight * subConfidence;
  }, 0);

  void retainedWeightShare; // already reflected in `renormed`/`breakdown` above

  return {
    kpi: "expansion_opportunity",
    code: m.code,
    score,
    breakdown,
    droppedSignals: dropped,
    confidence,
    weightsVersion: WEIGHTS_VERSION,
    normalization: buildNormalization(ctx),
  };
}

/**
 * Inverse view of Congestion (SPEC §4), reported for completeness. Each
 * breakdown entry is congestion's own entry with the normalized value
 * flipped (100 - normalized) and the same post-renormalization weight,
 * so the entries still sum to `100 - congestion.score` exactly.
 */
export function spareCapacityScore(
  m: AirportYearMetrics,
  ctx: NormalizationContext
): ScoreResult {
  const congestion = congestionScore(m, ctx);

  const breakdown: SignalContribution[] = congestion.breakdown.map((entry) => {
    const normalized = 100 - entry.normalized;
    return {
      ...entry,
      normalized,
      contribution: normalized * entry.weight,
    };
  });

  return {
    kpi: "spare_capacity",
    code: m.code,
    score: 100 - congestion.score,
    breakdown,
    droppedSignals: congestion.droppedSignals,
    confidence: congestion.confidence,
    weightsVersion: WEIGHTS_VERSION,
    normalization: congestion.normalization,
  };
}

/** Scores every airport in the universe against one shared normalization
 * context, so all four KPIs are directly comparable across airports. */
export function scoreUniverse(
  universe: readonly AirportYearMetrics[]
): Map<AirportCode, AllScores> {
  const ctx = buildNormalizationContext(universe);
  const result = new Map<AirportCode, AllScores>();

  for (const m of universe) {
    result.set(m.code, {
      congestion: congestionScore(m, ctx),
      unmetDemand: unmetDemandScore(m, ctx),
      expansionOpportunity: expansionOpportunityScore(m, ctx),
      spareCapacity: spareCapacityScore(m, ctx),
    });
  }

  return result;
}
