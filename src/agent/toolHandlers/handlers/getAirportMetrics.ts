import { refusal, type ToolRefusal } from "../../tools/tools.js";
import type { HandlerContext } from "../handlerContext.js";
import { guarded, parseArgs } from "../handlerHelpers.js";
import { notesFor } from "../disclosedNotes.js";
import type { MetricsResult } from "../payloads.js";

export function getAirportMetrics(ctx: HandlerContext) {
  return (args: unknown): MetricsResult | ToolRefusal => {
    const parsed = parseArgs<{ code: string; year?: number }>("get_airport_metrics", args);
    if (!parsed.ok) return parsed.refusal;
    const { code, year } = parsed.value;

    return guarded(() => {
      const ref = ctx.dataSource.getAirportRef(code);
      if (!ref) {
        return refusal(
          "out_of_scope_airport",
          `"${code}" is not in the in-scope ~${ctx.refs.length}-airport universe.`,
          { code }
        );
      }

      if (year !== undefined && year !== ctx.manifest.analysisYear) {
        return refusal(
          "unsupported_year",
          `Only ${ctx.manifest.analysisYear} is independently queryable; ${ctx.manifest.priorYear} ` +
            `is loaded solely to compute pax_growth_yoy.`,
          { requestedYear: year, queryableYear: ctx.manifest.analysisYear }
        );
      }

      const metrics = ctx.dataSource.getYearMetrics(code, ctx.manifest.analysisYear);
      if (!metrics) {
        return refusal(
          "no_data",
          `No ${ctx.manifest.analysisYear} metrics are available for "${code}".`,
          { code }
        );
      }

      return { ref, metrics, notes: notesFor(metrics) };
    });
  };
}
