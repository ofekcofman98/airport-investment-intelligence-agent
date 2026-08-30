import { rankAirports as rankAirportsScoring } from "../../../scoring/rankCompare.js";
import type { ProxyKpi } from "../../../scoring/types.js";
import type { ToolRefusal } from "../../tools/tools.js";
import type { HandlerContext } from "../handlerContext.js";
import { guarded, parseArgs } from "../handlerHelpers.js";
import { roundScoreResult } from "../roundResult.js";
import type { RankPayload } from "../payloads.js";

export function rankAirports(ctx: HandlerContext) {
  return (args: unknown): RankPayload | ToolRefusal => {
    const parsed = parseArgs<{
      kpi: ProxyKpi;
      filter?: { region?: string; state?: string; codes?: string[] };
      n?: number;
    }>("rank_airports", args);
    if (!parsed.ok) return parsed.refusal;
    const { kpi, filter, n } = parsed.value;

    return guarded(() => {
      const result = rankAirportsScoring(ctx.universe, { kpi, filter: filter as never, n }, ctx.refs);
      return {
        ...result,
        results: result.results.map((entry) => ({
          ...entry,
          result: roundScoreResult(entry.result),
        })),
      };
    });
  };
}
