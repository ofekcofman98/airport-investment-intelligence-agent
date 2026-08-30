import { effectiveRawWeights } from "../../../scoring/effectiveWeights.js";
import type { ProxyKpi } from "../../../scoring/types.js";
import { refusal, type ToolRefusal } from "../../tools/tools.js";
import type { HandlerContext } from "../handlerContext.js";
import { guarded, parseArgs } from "../handlerHelpers.js";
import { notesFor, weatherNoteFor } from "../disclosedNotes.js";
import { roundScoreResult } from "../roundResult.js";
import type { ExplainPayload } from "../payloads.js";

export function explainScore(ctx: HandlerContext) {
  return (args: unknown): ExplainPayload | ToolRefusal => {
    const parsed = parseArgs<{ code: string; kpi: ProxyKpi }>("explain_score", args);
    if (!parsed.ok) return parsed.refusal;
    const { code, kpi } = parsed.value;

    return guarded(() => {
      const ref = ctx.dataSource.getAirportRef(code);
      if (!ref) {
        return refusal(
          "out_of_scope_airport",
          `"${code}" is not in the in-scope ~${ctx.refs.length}-airport universe.`,
          { code }
        );
      }
      const m = ctx.universeByCode.get(code);
      if (!m) {
        return refusal(
          "no_data",
          `No ${ctx.manifest.analysisYear} metrics are available for "${code}", so it cannot be scored.`,
          { code }
        );
      }

      const result = roundScoreResult(ctx.scoreFor(kpi, m));

      return {
        result,
        weights: ctx.weightsFor(kpi),
        effectiveWeights: effectiveRawWeights(),
        confounderNote: weatherNoteFor(m),
        notes: notesFor(m),
      };
    });
  };
}
