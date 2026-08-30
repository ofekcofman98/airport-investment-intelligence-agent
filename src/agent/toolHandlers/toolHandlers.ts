/**
 * src/agent/toolHandlers/toolHandlers.ts — the only bridge from a tool call
 * to src/scoring/ + src/data/ (src/agent/CLAUDE.md). Every handler returns
 * either a valid payload or a structured ToolRefusal — never a raw
 * exception or stack trace reaches the LLM.
 *
 * Does NOT record trace events — that is orchestrator.ts's job
 * (src/obs/CLAUDE.md: "orchestrator.ts appends a TraceEvent on every tool
 * call/return"). This file has no dependency on src/obs/.
 *
 * This file itself only builds the shared HandlerContext (handlerContext.ts)
 * once per data source and wires it into each handlers/*.ts factory; the
 * actual per-tool logic lives in handlers/, disclosed-note text in
 * disclosedNotes.ts, payload/interface shapes in payloads.ts, rounding in
 * roundResult.ts, and resolve_airports' matching heuristics in
 * resolveAirportsMatch.ts.
 */

import type {
  AirportCode,
  AirportDataSource,
  AirportRef,
  AirportYearMetrics,
} from "../../data/types.js";
import {
  buildNormalizationContext,
  congestionScore,
  expansionOpportunityScore,
  spareCapacityScore,
  unmetDemandScore,
} from "../../scoring/proxyScores.js";
import {
  CONGESTION_WEIGHTS,
  UNMET_DEMAND_WEIGHTS,
  EXPANSION_WEIGHTS,
} from "../../scoring/weights.js";
import type { NormalizationContext, ProxyKpi, ScoreResult } from "../../scoring/types.js";
import { refusal, type ToolRefusal, type ToolName } from "../tools/tools.js";
import type { HandlerContext } from "./handlerContext.js";
import type { ToolHandlers } from "./payloads.js";
import { resolveAirports } from "./handlers/resolveAirports.js";
import { getAirportMetrics } from "./handlers/getAirportMetrics.js";
import { rankAirports } from "./handlers/rankAirports.js";
import { compareAirports } from "./handlers/compareAirports.js";
import { explainScore } from "./handlers/explainScore.js";
import { describeMethodology } from "./handlers/describeMethodology.js";

export type { HandlerContext } from "./handlerContext.js";
export type {
  ResolveMatch,
  ResolveResult,
  MetricsResult,
  RankPayload,
  ComparePayload,
  ExplainPayload,
  MethodologyEntry,
  MethodologyPayload,
  ToolHandlers,
} from "./payloads.js";

function scoreForKpi(kpi: ProxyKpi, m: AirportYearMetrics, ctx: NormalizationContext): ScoreResult {
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

function weightsForKpi(kpi: ProxyKpi): Record<string, number> {
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

/**
 * Builds the six tool handlers over one AirportDataSource. Never imports
 * snapshotDataSource.ts directly — the caller (cli.ts) wires the real
 * source; tests hand in a fake AirportDataSource.
 */
export function createToolHandlers(dataSource: AirportDataSource): ToolHandlers {
  const manifest = dataSource.getManifest();

  // Memoized on first access (decision 2 still holds: once built, the same
  // universe/normalization context is reused for the rest of the
  // conversation) — but NOT built at construction time, so a handler that
  // never touches the data source (describe_methodology) truly never
  // triggers a dataSource fetch. Airports with no metrics file for the
  // analysis year (legitimately absent from a BTS extract) are simply
  // excluded from the scoring universe — they still resolve via
  // resolve_airports/getAirportRef.
  let built:
    | {
        refs: AirportRef[];
        universe: AirportYearMetrics[];
        universeByCode: Map<AirportCode, AirportYearMetrics>;
        normalizationCtx: NormalizationContext;
      }
    | undefined;

  function getOrBuild() {
    if (!built) {
      const refs = dataSource.listAirports();
      const universe: AirportYearMetrics[] = [];
      for (const ref of refs) {
        const metrics = dataSource.getYearMetrics(ref.code, manifest.analysisYear);
        if (metrics) universe.push(metrics);
      }
      const universeByCode = new Map(universe.map((m) => [m.code, m]));
      const normalizationCtx = buildNormalizationContext(universe);
      built = { refs, universe, universeByCode, normalizationCtx };
    }
    return built;
  }

  const ctx: HandlerContext = {
    dataSource,
    manifest,
    get refs() {
      return getOrBuild().refs;
    },
    get universe() {
      return getOrBuild().universe;
    },
    get universeByCode() {
      return getOrBuild().universeByCode;
    },
    get ctx() {
      return getOrBuild().normalizationCtx;
    },
    scoreFor: (kpi, m) => scoreForKpi(kpi, m, getOrBuild().normalizationCtx),
    weightsFor: weightsForKpi,
  };

  return {
    resolve_airports: resolveAirports(ctx),
    get_airport_metrics: getAirportMetrics(ctx),
    rank_airports: rankAirports(ctx),
    compare_airports: compareAirports(ctx),
    explain_score: explainScore(ctx),
    describe_methodology: describeMethodology(ctx),
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
