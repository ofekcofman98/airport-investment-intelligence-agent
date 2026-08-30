/**
 * src/scoring/types.ts — payload shapes shared by every scoring function.
 * Kept separate from src/data/types.ts: the data layer is scoped to the
 * AirportDataSource contract and must not know about scores.
 */

import type { AirportCode } from "../data/types.js";

export type ProxyKpi =
  | "congestion"
  | "unmet_demand"
  | "expansion_opportunity"
  | "spare_capacity";

/** Per-signal min/max observed across the in-scope universe (non-null
 * values only), used to min-max normalize every raw signal to 0-100. */
export interface NormalizationContext {
  ranges: Record<string, { min: number; max: number }>;
  n: number;
  year: number;
}

/** One raw signal's contribution to a composed score. */
export interface SignalContribution {
  signal: string;
  raw: number;
  normalized: number; // 0-100
  weight: number; // post-renormalization weight actually applied
  contribution: number; // normalized * weight
}

/** SPEC §4a — carried on every scored payload, never optional. */
export interface Normalization {
  basis: "in-scope universe";
  n: number;
  year: number;
  caveat: string;
}

export interface ScoreResult {
  kpi: ProxyKpi;
  code: AirportCode;
  score: number; // 0-100
  breakdown: SignalContribution[];
  droppedSignals: string[];
  confidence: number; // dataCompleteness * retainedWeightShare, in [0, 1]
  weightsVersion: string;
  normalization: Normalization;
}

export interface AllScores {
  congestion: ScoreResult;
  unmetDemand: ScoreResult;
  expansionOpportunity: ScoreResult;
  spareCapacity: ScoreResult;
}
