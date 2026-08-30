/**
 * src/agent/tools.ts — tool *schemas* only (SPEC §6, src/agent/CLAUDE.md).
 *
 * This file defines what the LLM sees and how its arguments are validated
 * at runtime. It performs no I/O, imports no data, and calls into neither
 * src/data/ nor src/scoring/ — that bridge is toolHandlers.ts. Adding a new
 * tool means adding an entry to TOOLS here without touching
 * orchestrator.ts; swapping the LLM SDK means rewriting anthropicTools()
 * without touching this file's schemas.
 */

import { z } from "zod";
import type { Region } from "../../data/types.js";
import type { ProxyKpi } from "../../scoring/types.js";

/** Mirrors scoring/types.ts's ProxyKpi — kept as a literal tuple here so
 * this file has no import-time dependency on scoring internals beyond the
 * type it's asserted against below. */
export const KPI_VALUES = [
  "congestion",
  "unmet_demand",
  "expansion_opportunity",
  "spare_capacity",
] as const satisfies readonly ProxyKpi[];

/** Mirrors data/types.ts's Region exactly (asserted via `satisfies` below). */
export const REGION_VALUES = [
  "New England",
  "Mid-Atlantic",
  "Southeast",
  "Midwest",
  "South Central",
  "Mountain",
  "Pacific",
  "Alaska",
  "Hawaii",
] as const satisfies readonly Region[];

// If either tuple above ever drops a member of its source union, this
// assignment fails to compile — a compile-time coverage check alongside
// the runtime length check in tools.test.ts.
const _kpiCoversAll: ProxyKpi = KPI_VALUES[0];
const _regionCoversAll: Region = REGION_VALUES[0];
void _kpiCoversAll;
void _regionCoversAll;

/** Shape-only validation: three uppercase letters. Whether the code is
 * actually in the ~46-airport universe is a toolHandlers.ts question
 * against src/data/airportRegistry.ts — this schema must not encode the
 * universe (decision 2). */
const AirportCodeSchema = z
  .string()
  .regex(/^[A-Z]{3}$/, "airport code must be 3 uppercase letters, e.g. \"SFO\"");

const KpiSchema = z.enum(KPI_VALUES);
const RegionSchema = z.enum(REGION_VALUES);

// ---------------------------------------------------------------------------
// Per-tool argument schemas
// ---------------------------------------------------------------------------

const ResolveAirportsArgs = z
  .object({
    query: z.string().min(1, "query must not be empty"),
  })
  .strict();

const GetAirportMetricsArgs = z
  .object({
    code: AirportCodeSchema,
    year: z.number().int().optional(),
  })
  .strict();

// Mirrors src/scoring/rankCompare.ts's RankFilter exactly (same three
// optional fields) so toolHandlers.ts is a pass-through, not a translation.
const RankFilterSchema = z
  .object({
    region: RegionSchema.optional(),
    state: z.string().length(2).optional(),
    codes: z.array(AirportCodeSchema).optional(),
  })
  .strict();

const RankAirportsArgs = z
  .object({
    kpi: KpiSchema,
    filter: RankFilterSchema.optional(),
    n: z.number().int().min(1).max(46).optional(),
  })
  .strict();

const CompareAirportsArgs = z
  .object({
    codes: z.array(AirportCodeSchema).min(2).max(6),
    kpi: KpiSchema,
  })
  .strict();

const ExplainScoreArgs = z
  .object({
    code: AirportCodeSchema,
    kpi: KpiSchema,
  })
  .strict();

const DescribeMethodologyArgs = z
  .object({
    kpi: KpiSchema.optional(),
  })
  .strict();

// ---------------------------------------------------------------------------
// Tool registry
// ---------------------------------------------------------------------------

export type ToolName =
  | "resolve_airports"
  | "get_airport_metrics"
  | "rank_airports"
  | "compare_airports"
  | "explain_score"
  | "describe_methodology";

/** A minimal JSON-Schema-object shape — just enough for Anthropic's
 * `input_schema`, not a general-purpose JSON Schema type. */
export interface JsonSchemaObject {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
}

export interface ToolDefinition<S extends z.ZodTypeAny = z.ZodTypeAny> {
  name: ToolName;
  description: string;
  schema: S;
  inputSchema: JsonSchemaObject;
}

const KPI_ENUM_DESCRIPTION =
  `One of: ${KPI_VALUES.join(", ")}. Every returned score carries a ` +
  `normalization.caveat string that MUST be surfaced verbatim in any ` +
  `answer that states the score (SPEC §4a) — it is relative to the ` +
  `in-scope airport universe, never a claim about all US airports.`;

export const TOOLS: readonly ToolDefinition[] = [
  {
    name: "resolve_airports",
    description:
      "Resolves free-text (an airport name, city, or IATA code) to one or " +
      "more in-scope IATA codes. Use this before any other tool when the " +
      "user names an airport by anything other than its exact 3-letter " +
      "code. Returns zero matches, rather than a guess, for an airport " +
      "outside the ~46-airport universe — the caller must then refuse " +
      "rather than invent a code.",
    schema: ResolveAirportsArgs,
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Free text naming an airport: name, city, or IATA code.",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "get_airport_metrics",
    description:
      "Returns the measured (not scored) base metrics for one airport/year " +
      "(SPEC §3): passengers, seats, load_factor, schedule_adherence_gap, " +
      "delay/cancellation rates, long_haul_share, pax_growth_yoy. Only " +
      "2025 is independently queryable — 2024 exists solely to compute " +
      "pax_growth_yoy and is never returned on its own; omit `year` for " +
      "2025. An out-of-scope code returns a refusal, not a number.",
    schema: GetAirportMetricsArgs,
    inputSchema: {
      type: "object",
      properties: {
        code: { type: "string", description: "3-letter IATA code, e.g. \"SFO\"." },
        year: {
          type: "integer",
          description: "Analysis year. Only 2025 is queryable; omit for 2025.",
        },
      },
      required: ["code"],
    },
  },
  {
    name: "rank_airports",
    description:
      "Ranks the in-scope universe on one proxy KPI, optionally filtered " +
      "by region/state/an explicit code list, top N. " +
      KPI_ENUM_DESCRIPTION +
      " Airports below the minimum-volume threshold (SPEC §1) are omitted " +
      "from `results` and listed in `excluded` with " +
      "reason \"below_min_volume\" — this list MUST be mentioned in the " +
      "answer, never silently dropped.",
    schema: RankAirportsArgs,
    inputSchema: {
      type: "object",
      properties: {
        kpi: { type: "string", enum: [...KPI_VALUES], description: KPI_ENUM_DESCRIPTION },
        filter: {
          type: "object",
          description: "Optional narrowing; all fields optional and combinable.",
          properties: {
            region: { type: "string", enum: [...REGION_VALUES] },
            state: { type: "string", description: "USPS 2-letter code, e.g. \"MA\"." },
            codes: {
              type: "array",
              items: { type: "string" },
              description: "Restrict to an explicit set of 3-letter IATA codes.",
            },
          },
        },
        n: {
          type: "integer",
          description: "Top N results to return; default is every eligible airport.",
        },
      },
      required: ["kpi"],
    },
  },
  {
    name: "compare_airports",
    description:
      "Compares 2-6 airports side by side on one proxy KPI, with per-signal " +
      "driver deltas explaining why they differ. " +
      KPI_ENUM_DESCRIPTION +
      " Unlike rank_airports, no minimum-volume threshold applies here " +
      "(SPEC §1) — every requested in-scope code is included.",
    schema: CompareAirportsArgs,
    inputSchema: {
      type: "object",
      properties: {
        codes: {
          type: "array",
          items: { type: "string" },
          minItems: 2,
          maxItems: 6,
          description: "2-6 3-letter IATA codes.",
        },
        kpi: { type: "string", enum: [...KPI_VALUES], description: KPI_ENUM_DESCRIPTION },
      },
      required: ["codes", "kpi"],
    },
  },
  {
    name: "explain_score",
    description:
      "Returns one airport's full contribution breakdown for one proxy " +
      "KPI: per-signal normalized value, weight, and contribution, plus " +
      "dropped signals, confidence, and any confounder/interpretive notes " +
      "(e.g. the weather-delay confounder, the signed schedule_adherence_gap " +
      "note). " +
      KPI_ENUM_DESCRIPTION,
    schema: ExplainScoreArgs,
    inputSchema: {
      type: "object",
      properties: {
        code: { type: "string", description: "3-letter IATA code, e.g. \"SFO\"." },
        kpi: { type: "string", enum: [...KPI_VALUES], description: KPI_ENUM_DESCRIPTION },
      },
      required: ["code", "kpi"],
    },
  },
  {
    name: "describe_methodology",
    description:
      "Returns the documented formula, weights, and effective (compounded) " +
      "weights for one KPI, or for all four KPIs if `kpi` is omitted. " +
      "Accesses no airport data and computes no score — pure documentation, " +
      "safe to call for any \"how do you define...\" / \"how is this " +
      "calculated\" question.",
    schema: DescribeMethodologyArgs,
    inputSchema: {
      type: "object",
      properties: {
        kpi: {
          type: "string",
          enum: [...KPI_VALUES],
          description: "Omit to get the methodology for all four KPIs.",
        },
      },
      required: [],
    },
  },
];

const TOOLS_BY_NAME: Map<ToolName, ToolDefinition> = new Map(
  TOOLS.map((t) => [t.name, t])
);

export function getTool(name: string): ToolDefinition | null {
  return TOOLS_BY_NAME.get(name as ToolName) ?? null;
}

/** The Anthropic Messages API `tools` array shape — kept minimal (no SDK
 * import) so this file has zero LLM-SDK dependency; orchestrator.ts is the
 * only place that touches @anthropic-ai/sdk. */
export interface AnthropicToolShape {
  name: string;
  description: string;
  input_schema: JsonSchemaObject;
}

export function anthropicTools(): AnthropicToolShape[] {
  return TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema,
  }));
}

// ---------------------------------------------------------------------------
// Structured refusal (SPEC §5 refusal cases; src/agent/CLAUDE.md "Error
// handling" — every tool result is a valid payload or a structured refusal,
// never a raw stack trace).
// ---------------------------------------------------------------------------

export type RefusalReason =
  | "out_of_scope_airport"
  | "unsupported_year"
  | "unsupported_topic"
  | "invalid_arguments"
  | "no_data";

export interface ToolRefusal {
  status: "refused";
  reason: RefusalReason;
  message: string;
  details?: Record<string, unknown>;
}

export function refusal(
  reason: RefusalReason,
  message: string,
  details?: Record<string, unknown>
): ToolRefusal {
  return details === undefined
    ? { status: "refused", reason, message }
    : { status: "refused", reason, message, details };
}
