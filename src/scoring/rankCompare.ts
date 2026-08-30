/**
 * src/scoring/rankCompare.ts — rank_airports / compare_airports (SPEC §5,
 * §6). Pure functions: takes the full metrics universe (and, for
 * filtering, the matching AirportRef list) as explicit arguments rather
 * than reaching into src/data/ itself.
 */

import type { AirportCode, AirportRef, AirportYearMetrics, Region } from "../data/types.js";
import { MIN_ANNUAL_PASSENGERS } from "./weights.js";
import {
  buildNormalizationContext,
  congestionScore,
  expansionOpportunityScore,
  spareCapacityScore,
  unmetDemandScore,
} from "./proxyScores.js";
import type { Normalization, ProxyKpi, ScoreResult } from "./types.js";

export interface RankFilter {
  region?: Region;
  state?: string; // USPS 2-letter code
  codes?: AirportCode[]; // restrict to an explicit set, e.g. a named region's codes
}

export interface RankOptions {
  kpi: ProxyKpi;
  filter?: RankFilter;
  n?: number; // top N; default returns every eligible airport
}

export interface RankedEntry {
  code: AirportCode;
  rank: number;
  result: ScoreResult;
}

export interface ExcludedEntry {
  code: AirportCode;
  reason: "below_min_volume";
  passengers: number;
}

export interface RankResult {
  results: RankedEntry[];
  excluded: ExcludedEntry[];
  normalization: Normalization;
}

export interface SignalDelta {
  signal: string;
  values: Record<AirportCode, number>; // normalized 0-100 value per airport
  maxDelta: number; // max(values) - min(values)
}

export interface CompareResult {
  comparisons: ScoreResult[];
  driverDeltas: SignalDelta[];
  normalization: Normalization;
}

function scoreFor(kpi: ProxyKpi, m: AirportYearMetrics, ctx: ReturnType<typeof buildNormalizationContext>): ScoreResult {
  switch (kpi) {
    case "congestion":
      return congestionScore(m, ctx);
    case "unmet_demand":
      return unmetDemandScore(m, ctx);
    case "expansion_opportunity":
      return expansionOpportunityScore(m, ctx);
    case "spare_capacity":
      return spareCapacityScore(m, ctx);
  }
}

function matchesFilter(ref: AirportRef | undefined, filter: RankFilter | undefined): boolean {
  if (!filter) return true;
  if (filter.codes && !filter.codes.includes(ref?.code ?? "")) return false;
  if (filter.region && ref?.region !== filter.region) return false;
  if (filter.state && ref?.state !== filter.state) return false;
  return true;
}

/**
 * Ranks the in-scope universe on one KPI. Order matters (SPEC §1,
 * src/scoring/CLAUDE.md "Minimum-volume threshold"):
 *
 *   1. build the normalization context over the FULL universe, so scores
 *      stay comparable to the whole ~46-airport set regardless of filter
 *      (SPEC §4);
 *   2. apply the region/state/codes filter;
 *   3. drop anything below MIN_ANNUAL_PASSENGERS into `excluded` — never
 *      silently, and never before scoring context is fixed;
 *   4. rank what remains.
 *
 * `refs` is optional and only needed when `filter.region`/`filter.state`
 * is used — passing metrics-only is fine for an unfiltered or
 * `codes`-filtered ranking.
 */
export function rankAirports(
  universe: readonly AirportYearMetrics[],
  options: RankOptions,
  refs?: readonly AirportRef[]
): RankResult {
  const ctx = buildNormalizationContext(universe);
  const refByCode = new Map((refs ?? []).map((r) => [r.code, r]));

  const filtered = universe.filter((m) => matchesFilter(refByCode.get(m.code), options.filter));

  const excluded: ExcludedEntry[] = [];
  const eligible: AirportYearMetrics[] = [];
  for (const m of filtered) {
    if (m.passengers < MIN_ANNUAL_PASSENGERS) {
      excluded.push({ code: m.code, reason: "below_min_volume", passengers: m.passengers });
    } else {
      eligible.push(m);
    }
  }

  const scored = eligible
    .map((m) => scoreFor(options.kpi, m, ctx))
    .sort((a, b) => b.score - a.score);

  const limited = options.n !== undefined ? scored.slice(0, options.n) : scored;

  const results: RankedEntry[] = limited.map((result, index) => ({
    code: result.code,
    rank: index + 1,
    result,
  }));

  return {
    results,
    excluded,
    normalization: results[0]?.result.normalization ?? {
      basis: "in-scope universe",
      n: ctx.n,
      year: ctx.year,
      caveat: scoreFallbackCaveat(ctx.n),
    },
  };
}

// Only reached when every airport is excluded/filtered out and there is no
// scored result to read `normalization` off of — keeps RankResult's
// `normalization` non-optional (SPEC §4a) even for an empty result set.
function scoreFallbackCaveat(n: number): string {
  return `This score is relative to the ~${n} major US airports in our dataset, not all ~400 US airports. A score of 90 means "near the top of this set", not "top 10% nationally".`;
}

/**
 * Compares 2+ airports on one KPI, side by side, with per-signal driver
 * deltas. No minimum-volume threshold applies here (SPEC §1: the
 * threshold is ranking-only) — comparison and lookup remain unaffected.
 */
export function compareAirports(
  universe: readonly AirportYearMetrics[],
  codes: readonly AirportCode[],
  kpi: ProxyKpi
): CompareResult {
  const ctx = buildNormalizationContext(universe);
  const byCode = new Map(universe.map((m) => [m.code, m]));

  const comparisons: ScoreResult[] = [];
  for (const code of codes) {
    const m = byCode.get(code);
    if (!m) continue; // out-of-scope codes are rejected upstream by Zod validation
    comparisons.push(scoreFor(kpi, m, ctx));
  }

  const driverDeltas: SignalDelta[] = [];
  const signalNames = new Set<string>();
  for (const c of comparisons) {
    for (const entry of c.breakdown) signalNames.add(entry.signal);
  }

  for (const signal of signalNames) {
    const values: Record<AirportCode, number> = {};
    for (const c of comparisons) {
      const entry = c.breakdown.find((e) => e.signal === signal);
      if (entry) values[c.code] = entry.normalized;
    }
    const nums = Object.values(values);
    const maxDelta = nums.length > 0 ? Math.max(...nums) - Math.min(...nums) : 0;
    driverDeltas.push({ signal, values, maxDelta });
  }

  driverDeltas.sort((a, b) => b.maxDelta - a.maxDelta);

  return {
    comparisons,
    driverDeltas,
    normalization: comparisons[0]?.normalization ?? {
      basis: "in-scope universe",
      n: ctx.n,
      year: ctx.year,
      caveat: scoreFallbackCaveat(ctx.n),
    },
  };
}
