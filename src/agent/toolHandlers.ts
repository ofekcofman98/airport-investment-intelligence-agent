/**
 * src/agent/toolHandlers.ts — the only bridge from a tool call to
 * src/scoring/ + src/data/ (src/agent/CLAUDE.md). Every handler returns
 * either a valid payload or a structured ToolRefusal — never a raw
 * exception or stack trace reaches the LLM.
 *
 * Does NOT record trace events — that is orchestrator.ts's job
 * (src/obs/CLAUDE.md: "orchestrator.ts appends a TraceEvent on every tool
 * call/return"). This file has no dependency on src/obs/.
 */

import type { z } from "zod";
import type {
  AirportCode,
  AirportDataSource,
  AirportRef,
  AirportYearMetrics,
} from "../data/types.js";
import {
  buildNormalizationContext,
  congestionScore,
  expansionOpportunityScore,
  spareCapacityScore,
  unmetDemandScore,
} from "../scoring/proxyScores.js";
import { rankAirports, compareAirports, type RankResult, type CompareResult } from "../scoring/rankCompare.js";
import { effectiveRawWeights } from "../scoring/effectiveWeights.js";
import {
  CONGESTION_WEIGHTS,
  UNMET_DEMAND_WEIGHTS,
  EXPANSION_WEIGHTS,
  WEIGHTS_VERSION,
  MIN_ANNUAL_PASSENGERS,
  normalizationCaveat,
} from "../scoring/weights.js";
import type { NormalizationContext, ProxyKpi, ScoreResult } from "../scoring/types.js";
import {
  TOOLS,
  refusal,
  type ToolRefusal,
  type ToolName,
} from "./tools.js";

// ---------------------------------------------------------------------------
// Disclosed notes (SPEC §2, §3, §4) — attached to the payloads that carry
// the facts they describe, per decision 5 (root CLAUDE.md "Independent
// decisions"): systemPrompt.ts states the rule that these must be
// surfaced; the note text itself lives here, next to the data it's about.
// ---------------------------------------------------------------------------

/** SPEC §2 — del15Rate/avgTaxiOutMin/nasDelayPerDeparture/cancellationRate
 * are estimated from a single representative month, not measured year-round. */
export const SAMPLE_MONTH_NOTE =
  "Delay and cancellation figures (del15_rate, avg_taxi_out_min, " +
  "nas_delay_per_departure, cancellation_rate) are estimated from a single " +
  "representative month — March 2025 — not measured across the full year.";

/** SPEC §4 — NAS_DELAY is the best available volume signal, but delay
 * minutes also reflect weather, carrier ops, and upstream late aircraft. */
export const WEATHER_CONFOUNDER_NOTE =
  "Delay minutes also reflect weather, carrier operations, and upstream " +
  "late aircraft, not congestion alone; weather_delay_per_departure is " +
  "reported alongside this score so an analyst can discount weather-driven " +
  "airports.";

/** SPEC §3 — a negative schedule_adherence_gap is a known T-100 quirk
 * (non-scheduled/charter operations counted as performed), not a data error. */
export const NEGATIVE_GAP_NOTE =
  "This airport's schedule_adherence_gap is negative: departures_performed " +
  "exceeded departures_scheduled, likely due to non-scheduled (charter, " +
  "extra-section) operations BTS counts as performed. This is not a data " +
  "error and can indicate an airport adding capacity beyond its published " +
  "schedule, rather than under-delivering on it.";

/**
 * Hand-authored, not derived: the snapshot has only a single-month On-Time
 * sample (see SAMPLE_MONTH_NOTE), so there is no data-driven seasonality
 * measure to test against. This list flags airports with well-known strong
 * seasonal/weather traffic variation for extra emphasis on top of the
 * universal SAMPLE_MONTH_NOTE. If the snapshot ever gains multi-month
 * On-Time data, replace this with a computed measure instead of extending
 * it by hand.
 */
export const HIGH_SEASONALITY_CODES: ReadonlySet<AirportCode> = new Set([
  "ANC", // SPEC §2 named example: strong seasonal/weather traffic variation
  "HNL",
  "BTV",
  "PWM",
]);

export function highSeasonalityNote(code: AirportCode): string {
  return (
    `${code} has strong seasonal traffic variation; a one-month sample is ` +
    `a weaker proxy for its typical congestion/delay levels than for a ` +
    `less seasonal airport.`
  );
}

// ---------------------------------------------------------------------------
// Rounding at the tool boundary (decision 3): structure unchanged, so the
// planned KPI audit layer compares narration against the same precision
// the LLM was shown.
// ---------------------------------------------------------------------------

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function roundScoreResult(result: ScoreResult): ScoreResult {
  return {
    ...result,
    score: round(result.score, 1),
    confidence: round(result.confidence, 2),
    breakdown: result.breakdown.map((entry) => ({
      ...entry,
      normalized: round(entry.normalized, 1),
      contribution: round(entry.contribution, 1),
    })),
  };
}

// ---------------------------------------------------------------------------
// Payload shapes returned by each handler
// ---------------------------------------------------------------------------

export interface ResolveMatch {
  code: AirportCode;
  name: string;
  city: string;
  state: string;
}

export interface ResolveResult {
  matches: ResolveMatch[];
  message: string;
}

export interface MetricsResult {
  ref: AirportRef;
  metrics: AirportYearMetrics;
  notes: string[];
}

export interface RankPayload extends RankResult {}

export interface ComparePayload extends CompareResult {}

export interface ExplainPayload {
  result: ScoreResult;
  weights: Record<string, number>;
  effectiveWeights: Record<string, number>;
  confounderNote: string;
  notes: string[];
}

export interface MethodologyEntry {
  kpi: ProxyKpi;
  weights: Record<string, number>;
}

export interface MethodologyPayload {
  weightsVersion: string;
  minAnnualPassengers: number;
  caveat: string;
  entries: MethodologyEntry[];
  effectiveWeights: Record<string, number>;
}

export interface ToolHandlers {
  resolve_airports(args: unknown): ResolveResult | ToolRefusal;
  get_airport_metrics(args: unknown): MetricsResult | ToolRefusal;
  rank_airports(args: unknown): RankPayload | ToolRefusal;
  compare_airports(args: unknown): ComparePayload | ToolRefusal;
  explain_score(args: unknown): ExplainPayload | ToolRefusal;
  describe_methodology(args: unknown): MethodologyPayload | ToolRefusal;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function toolSchema(name: ToolName): z.ZodTypeAny {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) throw new Error(`toolHandlers: no schema registered for "${name}"`);
  return tool.schema;
}

/** Parses `args` against the named tool's Zod schema, returning either the
 * parsed value or an `invalid_arguments` refusal — never throws. */
function parseArgs<T>(name: ToolName, args: unknown): { ok: true; value: T } | { ok: false; refusal: ToolRefusal } {
  const result = toolSchema(name).safeParse(args);
  if (!result.success) {
    return {
      ok: false,
      refusal: refusal(
        "invalid_arguments",
        `Arguments for "${name}" failed validation: ${result.error.issues.map((i) => i.message).join("; ")}`,
        { issues: result.error.issues }
      ),
    };
  }
  return { ok: true, value: result.data as T };
}

/** Wraps a handler body so any unexpected throw from data/scoring becomes a
 * structured refusal — the message text only, never a stack trace. */
function guarded<T>(fn: () => T | ToolRefusal): T | ToolRefusal {
  try {
    return fn();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return refusal("no_data", "An unexpected error occurred while computing this result.", {
      error: message,
    });
  }
}

function weatherNoteFor(m: AirportYearMetrics): string {
  return m.weatherDelayPerDeparture === null
    ? WEATHER_CONFOUNDER_NOTE + " (No weather-delay figure is available for this airport.)"
    : `${WEATHER_CONFOUNDER_NOTE} This airport's weather_delay_per_departure is ${m.weatherDelayPerDeparture} minutes.`;
}

function notesFor(m: AirportYearMetrics): string[] {
  const notes = [SAMPLE_MONTH_NOTE];
  if (m.scheduleAdherenceGap < 0) notes.push(NEGATIVE_GAP_NOTE);
  if (HIGH_SEASONALITY_CODES.has(m.code)) notes.push(highSeasonalityNote(m.code));
  return notes;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Builds the six tool handlers over one AirportDataSource. Never imports
 * snapshotDataSource.ts directly — the caller (cli.ts) wires the real
 * source; tests hand in a fake AirportDataSource.
 */
export function createToolHandlers(dataSource: AirportDataSource): ToolHandlers {
  const manifest = dataSource.getManifest();
  const refs = dataSource.listAirports();

  // Assembled once at construction (decision 2) so every handler scores
  // against an identical universe/normalization context across a
  // conversation. Airports with no metrics file for the analysis year
  // (legitimately absent from a BTS extract) are simply excluded from the
  // scoring universe — they still resolve via resolve_airports/getAirportRef.
  const universe: AirportYearMetrics[] = [];
  for (const ref of refs) {
    const metrics = dataSource.getYearMetrics(ref.code, manifest.analysisYear);
    if (metrics) universe.push(metrics);
  }
  const universeByCode = new Map(universe.map((m) => [m.code, m]));
  const ctx: NormalizationContext = buildNormalizationContext(universe);

  function scoreFor(kpi: ProxyKpi, m: AirportYearMetrics): ScoreResult {
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

  function weightsFor(kpi: ProxyKpi): Record<string, number> {
    switch (kpi) {
      case "congestion":
        return CONGESTION_WEIGHTS;
      case "unmet_demand":
        return UNMET_DEMAND_WEIGHTS;
      case "expansion_opportunity":
        return EXPANSION_WEIGHTS;
      case "spare_capacity":
        // Spare Capacity has no weights of its own — it is 100 - congestion.
        return CONGESTION_WEIGHTS;
    }
  }

  return {
    resolve_airports(args) {
      const parsed = parseArgs<{ query: string }>("resolve_airports", args);
      if (!parsed.ok) return parsed.refusal;
      const query = parsed.value.query.trim().toLowerCase();

      return guarded(() => {
        const exact = refs.find((r) => r.code.toLowerCase() === query);
        const pool = exact
          ? [exact]
          : refs.filter(
              (r) =>
                r.code.toLowerCase().includes(query) ||
                r.name.toLowerCase().includes(query) ||
                r.city.toLowerCase().includes(query)
            );

        const matches: ResolveMatch[] = pool.map((r) => ({
          code: r.code,
          name: r.name,
          city: r.city,
          state: r.state,
        }));

        return {
          matches,
          message:
            matches.length > 0
              ? `Found ${matches.length} match(es) in the in-scope universe.`
              : `No airport matching "${parsed.value.query}" was found in the in-scope universe.`,
        };
      });
    },

    get_airport_metrics(args) {
      const parsed = parseArgs<{ code: string; year?: number }>("get_airport_metrics", args);
      if (!parsed.ok) return parsed.refusal;
      const { code, year } = parsed.value;

      return guarded(() => {
        const ref = dataSource.getAirportRef(code);
        if (!ref) {
          return refusal(
            "out_of_scope_airport",
            `"${code}" is not in the in-scope ~${refs.length}-airport universe.`,
            { code }
          );
        }

        if (year !== undefined && year !== manifest.analysisYear) {
          return refusal(
            "unsupported_year",
            `Only ${manifest.analysisYear} is independently queryable; ${manifest.priorYear} ` +
              `is loaded solely to compute pax_growth_yoy.`,
            { requestedYear: year, queryableYear: manifest.analysisYear }
          );
        }

        const metrics = dataSource.getYearMetrics(code, manifest.analysisYear);
        if (!metrics) {
          return refusal(
            "no_data",
            `No ${manifest.analysisYear} metrics are available for "${code}".`,
            { code }
          );
        }

        return { ref, metrics, notes: notesFor(metrics) };
      });
    },

    rank_airports(args) {
      const parsed = parseArgs<{
        kpi: ProxyKpi;
        filter?: { region?: string; state?: string; codes?: string[] };
        n?: number;
      }>("rank_airports", args);
      if (!parsed.ok) return parsed.refusal;
      const { kpi, filter, n } = parsed.value;

      return guarded(() => {
        const result = rankAirports(universe, { kpi, filter: filter as never, n }, refs);
        return {
          ...result,
          results: result.results.map((entry) => ({
            ...entry,
            result: roundScoreResult(entry.result),
          })),
        };
      });
    },

    compare_airports(args) {
      const parsed = parseArgs<{ codes: string[]; kpi: ProxyKpi }>("compare_airports", args);
      if (!parsed.ok) return parsed.refusal;
      const { codes, kpi } = parsed.value;

      return guarded(() => {
        const badCodes = codes.filter((c) => !dataSource.getAirportRef(c));
        if (badCodes.length > 0) {
          return refusal(
            "out_of_scope_airport",
            `The following codes are not in the in-scope universe: ${badCodes.join(", ")}.`,
            { codes: badCodes }
          );
        }
        const result = compareAirports(universe, codes, kpi);
        return {
          ...result,
          comparisons: result.comparisons.map(roundScoreResult),
          driverDeltas: result.driverDeltas.map((d) => ({
            ...d,
            values: Object.fromEntries(
              Object.entries(d.values).map(([code, v]) => [code, round(v, 1)])
            ),
            maxDelta: round(d.maxDelta, 1),
          })),
        };
      });
    },

    explain_score(args) {
      const parsed = parseArgs<{ code: string; kpi: ProxyKpi }>("explain_score", args);
      if (!parsed.ok) return parsed.refusal;
      const { code, kpi } = parsed.value;

      return guarded(() => {
        const ref = dataSource.getAirportRef(code);
        if (!ref) {
          return refusal(
            "out_of_scope_airport",
            `"${code}" is not in the in-scope ~${refs.length}-airport universe.`,
            { code }
          );
        }
        const m = universeByCode.get(code);
        if (!m) {
          return refusal(
            "no_data",
            `No ${manifest.analysisYear} metrics are available for "${code}", so it cannot be scored.`,
            { code }
          );
        }

        const result = roundScoreResult(scoreFor(kpi, m));

        return {
          result,
          weights: weightsFor(kpi),
          effectiveWeights: effectiveRawWeights(),
          confounderNote: weatherNoteFor(m),
          notes: notesFor(m),
        };
      });
    },

    describe_methodology(args) {
      const parsed = parseArgs<{ kpi?: ProxyKpi }>("describe_methodology", args);
      if (!parsed.ok) return parsed.refusal;
      const { kpi } = parsed.value;

      // Pure documentation: touches no data source, per plan decision.
      const allKpis: ProxyKpi[] = [
        "congestion",
        "unmet_demand",
        "expansion_opportunity",
        "spare_capacity",
      ];
      const kpisToDescribe = kpi ? [kpi] : allKpis;

      return {
        weightsVersion: WEIGHTS_VERSION,
        minAnnualPassengers: MIN_ANNUAL_PASSENGERS,
        caveat: normalizationCaveat(refs.length),
        entries: kpisToDescribe.map((k) => ({ kpi: k, weights: weightsFor(k) })),
        effectiveWeights: effectiveRawWeights(),
      };
    },
  };
}

/** Dispatches a tool call by name to the matching handler. Returns a
 * structured refusal for an unrecognized tool name rather than throwing. */
export function dispatch(
  handlers: ToolHandlers,
  name: string,
  args: unknown
): ReturnType<ToolHandlers[keyof ToolHandlers]> | ToolRefusal {
  switch (name as ToolName) {
    case "resolve_airports":
      return handlers.resolve_airports(args);
    case "get_airport_metrics":
      return handlers.get_airport_metrics(args);
    case "rank_airports":
      return handlers.rank_airports(args);
    case "compare_airports":
      return handlers.compare_airports(args);
    case "explain_score":
      return handlers.explain_score(args);
    case "describe_methodology":
      return handlers.describe_methodology(args);
    default:
      return refusal("invalid_arguments", `Unknown tool "${name}".`, { name });
  }
}
