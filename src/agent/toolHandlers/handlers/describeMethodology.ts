import { effectiveRawWeights } from "../../../scoring/effectiveWeights.js";
import { WEIGHTS_VERSION, MIN_ANNUAL_PASSENGERS, normalizationCaveat } from "../../../scoring/weights.js";
import type { ProxyKpi } from "../../../scoring/types.js";
import type { ToolRefusal } from "../../tools/tools.js";
import type { HandlerContext } from "../handlerContext.js";
import { parseArgs } from "../handlerHelpers.js";
import type { MethodologyPayload } from "../payloads.js";

export function describeMethodology(ctx: HandlerContext) {
  return (args: unknown): MethodologyPayload | ToolRefusal => {
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
      caveat: normalizationCaveat(ctx.refs.length),
      entries: kpisToDescribe.map((k) => ({ kpi: k, weights: ctx.weightsFor(k) })),
      effectiveWeights: effectiveRawWeights(),
    };
  };
}
