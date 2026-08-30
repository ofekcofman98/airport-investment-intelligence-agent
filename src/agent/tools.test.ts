import { describe, it, expect } from "vitest";
import { z } from "zod";
import {
  TOOLS,
  KPI_VALUES,
  REGION_VALUES,
  getTool,
  anthropicTools,
  refusal,
  type ToolName,
} from "./tools.js";

const EXPECTED_TOOL_NAMES: ToolName[] = [
  "resolve_airports",
  "get_airport_metrics",
  "rank_airports",
  "compare_airports",
  "explain_score",
  "describe_methodology",
];

// Recursively pulls the top-level object's own keys/required set out of a
// Zod object schema, unwrapping the .optional()/.default() wrappers that
// z.object(...).strict() fields get, without reaching into nested objects
// (nested objects, e.g. rank_airports' `filter`, are checked as a single
// property here — their own shape is exercised via parse() tests below).
function zodShape(schema: z.ZodTypeAny): { keys: string[]; required: string[] } {
  if (!(schema instanceof z.ZodObject)) {
    throw new Error("expected a ZodObject at the tool's top level");
  }
  const shape = schema.shape as Record<string, z.ZodTypeAny>;
  const keys = Object.keys(shape);
  const required = keys.filter((k) => !shape[k]!.isOptional());
  return { keys, required };
}

describe("TOOLS registry", () => {
  it("contains exactly the six SPEC §6 tools, no more, no fewer", () => {
    expect(TOOLS.map((t) => t.name).sort()).toEqual([...EXPECTED_TOOL_NAMES].sort());
  });

  it("every tool's Zod schema and input_schema agree on property names and required set", () => {
    for (const tool of TOOLS) {
      const { keys, required } = zodShape(tool.schema);
      const jsonKeys = Object.keys(tool.inputSchema.properties);
      const jsonRequired = tool.inputSchema.required ?? [];

      expect(new Set(jsonKeys)).toEqual(new Set(keys));
      expect(new Set(jsonRequired)).toEqual(new Set(required));
    }
  });

  it("every tool has a non-empty description and an object input_schema", () => {
    for (const tool of TOOLS) {
      expect(tool.description.length).toBeGreaterThan(0);
      expect(tool.inputSchema.type).toBe("object");
    }
  });

  it("every scored tool's description obligates the SPEC §4a caveat", () => {
    const scoredTools = ["rank_airports", "compare_airports", "explain_score"];
    for (const name of scoredTools) {
      const tool = getTool(name)!;
      expect(tool.description).toMatch(/caveat/i);
    }
  });
});

describe("KPI_VALUES / REGION_VALUES", () => {
  it("KPI_VALUES has all four proxy KPIs", () => {
    expect(KPI_VALUES).toEqual([
      "congestion",
      "unmet_demand",
      "expansion_opportunity",
      "spare_capacity",
    ]);
  });

  it("REGION_VALUES has all nine regions", () => {
    expect(REGION_VALUES.length).toBe(9);
    expect(new Set(REGION_VALUES).has("New England")).toBe(true);
  });
});

describe("getTool", () => {
  it("returns the matching tool definition", () => {
    expect(getTool("explain_score")?.name).toBe("explain_score");
  });

  it("returns null, not a throw, for an unknown name", () => {
    expect(getTool("nope")).toBeNull();
  });
});

describe("anthropicTools", () => {
  it("returns six entries with name/description/input_schema", () => {
    const tools = anthropicTools();
    expect(tools).toHaveLength(6);
    for (const t of tools) {
      expect(t.name.length).toBeGreaterThan(0);
      expect(t.description.length).toBeGreaterThan(0);
      expect(t.input_schema.type).toBe("object");
    }
  });
});

describe("per-tool argument validation", () => {
  it("resolve_airports accepts a query and rejects extra keys", () => {
    const tool = getTool("resolve_airports")!;
    expect(tool.schema.safeParse({ query: "Santa Ana" }).success).toBe(true);
    expect(tool.schema.safeParse({ query: "SNA", extra: 1 }).success).toBe(false);
    expect(tool.schema.safeParse({}).success).toBe(false);
  });

  it("get_airport_metrics rejects a lowercase or 4-letter code", () => {
    const tool = getTool("get_airport_metrics")!;
    expect(tool.schema.safeParse({ code: "SFO" }).success).toBe(true);
    expect(tool.schema.safeParse({ code: "sfo" }).success).toBe(false);
    expect(tool.schema.safeParse({ code: "SFOX" }).success).toBe(false);
  });

  it("rank_airports rejects n: 0 and accepts a full filter", () => {
    const tool = getTool("rank_airports")!;
    expect(tool.schema.safeParse({ kpi: "congestion", n: 0 }).success).toBe(false);
    expect(
      tool.schema.safeParse({
        kpi: "congestion",
        filter: { region: "New England", state: "MA", codes: ["BOS"] },
        n: 5,
      }).success
    ).toBe(true);
  });

  it("compare_airports rejects fewer than 2 codes", () => {
    const tool = getTool("compare_airports")!;
    expect(tool.schema.safeParse({ codes: ["SFO"], kpi: "congestion" }).success).toBe(false);
    expect(
      tool.schema.safeParse({ codes: ["SFO", "LAX"], kpi: "congestion" }).success
    ).toBe(true);
  });

  it("explain_score requires both code and kpi", () => {
    const tool = getTool("explain_score")!;
    expect(tool.schema.safeParse({ code: "SFO" }).success).toBe(false);
    expect(tool.schema.safeParse({ code: "SFO", kpi: "congestion" }).success).toBe(true);
  });

  it("describe_methodology's kpi is optional", () => {
    const tool = getTool("describe_methodology")!;
    expect(tool.schema.safeParse({}).success).toBe(true);
    expect(tool.schema.safeParse({ kpi: "spare_capacity" }).success).toBe(true);
  });
});

describe("refusal", () => {
  it("builds a structured refusal without details", () => {
    const r = refusal("out_of_scope_airport", "XYZ is not in our ~46-airport universe.");
    expect(r).toEqual({
      status: "refused",
      reason: "out_of_scope_airport",
      message: "XYZ is not in our ~46-airport universe.",
    });
  });

  it("builds a structured refusal with details", () => {
    const r = refusal("unsupported_year", "Only 2025 is queryable.", { requestedYear: 2023 });
    expect(r.details).toEqual({ requestedYear: 2023 });
  });
});
