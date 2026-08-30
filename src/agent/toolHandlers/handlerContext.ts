/**
 * src/agent/toolHandlers/handlerContext.ts — the shared, once-built context
 * every handlers/*.ts factory closes over. Assembled once in
 * createToolHandlers (toolHandlers.ts) so every handler scores against an
 * identical universe/normalization context across a conversation (decision
 * 2). Making this explicit (rather than an implicit closure) is what lets
 * each handler live in its own file.
 */

import type {
  AirportCode,
  AirportDataSource,
  AirportRef,
  AirportYearMetrics,
  SnapshotManifest,
} from "../../data/types.js";
import type { NormalizationContext, ProxyKpi, ScoreResult } from "../../scoring/types.js";

export interface HandlerContext {
  dataSource: AirportDataSource;
  manifest: SnapshotManifest;
  /** Lazily built on first access (memoized) so handlers that never need the
   * airport universe — e.g. describe_methodology — never trigger a
   * dataSource fetch. See toolHandlers.ts createToolHandlers. */
  readonly refs: AirportRef[];
  /** Airports with metrics for the analysis year — legitimately-absent BTS
   * extracts are excluded from the scoring universe but still resolve via
   * resolve_airports/getAirportRef. Lazily built, same as `refs`. */
  readonly universe: AirportYearMetrics[];
  readonly universeByCode: Map<AirportCode, AirportYearMetrics>;
  readonly ctx: NormalizationContext;
  scoreFor(kpi: ProxyKpi, m: AirportYearMetrics): ScoreResult;
  weightsFor(kpi: ProxyKpi): Record<string, number>;
}
