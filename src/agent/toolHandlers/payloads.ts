/**
 * src/agent/toolHandlers/payloads.ts — the payload shapes returned by each
 * handler, plus the ToolHandlers interface toolHandlers.ts builds and
 * dispatch() dispatches against.
 */

import type { AirportCode, AirportRef, AirportYearMetrics } from "../../data/types.js";
import type { RankResult, CompareResult } from "../../scoring/rankCompare.js";
import type { ProxyKpi, ScoreResult } from "../../scoring/types.js";
import type { ToolRefusal } from "../tools/tools.js";

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
