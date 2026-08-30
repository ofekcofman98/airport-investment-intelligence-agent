import { compareAirports as compareAirportsScoring } from "../../../scoring/rankCompare.js";
import type { ProxyKpi } from "../../../scoring/types.js";
import { refusal, type ToolRefusal } from "../../tools/tools.js";
import type { HandlerContext } from "../handlerContext.js";
import { guarded, parseArgs } from "../handlerHelpers.js";
import { round, roundScoreResult } from "../roundResult.js";
import type { ComparePayload } from "../payloads.js";

export function compareAirports(ctx: HandlerContext) {
  return (args: unknown): ComparePayload | ToolRefusal => {
    const parsed = parseArgs<{ codes: string[]; kpi: ProxyKpi }>("compare_airports", args);
    if (!parsed.ok) return parsed.refusal;
    const { codes, kpi } = parsed.value;

    return guarded(() => {
      const badCodes = codes.filter((c) => !ctx.dataSource.getAirportRef(c));
      if (badCodes.length > 0) {
        return refusal(
          "out_of_scope_airport",
          `The following codes are not in the in-scope universe: ${badCodes.join(", ")}.`,
          { codes: badCodes }
        );
      }
      const result = compareAirportsScoring(ctx.universe, codes, kpi);
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
  };
}
