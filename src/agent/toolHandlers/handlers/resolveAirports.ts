import { METRO_ALIASES, normalizeQuery } from "../../airportAliases/airportAliases.js";
import type { ToolRefusal } from "../../tools/tools.js";
import type { HandlerContext } from "../handlerContext.js";
import { guarded, parseArgs } from "../handlerHelpers.js";
import { matchesQuery } from "../resolveAirportsMatch.js";
import type { ResolveMatch, ResolveResult } from "../payloads.js";

export function resolveAirports(ctx: HandlerContext) {
  return (args: unknown): ResolveResult | ToolRefusal => {
    const parsed = parseArgs<{ query: string }>("resolve_airports", args);
    if (!parsed.ok) return parsed.refusal;
    const query = parsed.value.query.trim().toLowerCase();

    return guarded(() => {
      const exact = ctx.refs.find((r) => r.code.toLowerCase() === query);
      // A metro alias hit short-circuits word-boundary matching entirely
      // (ADR 0010) — "la" must return only LAX, not LAX unioned with every
      // ref whose name/city happens to start with "la" (LAS, LaGuardia,
      // Lauderdale, ...). Filtered against `refs` so an alias whose target
      // has dropped out of the universe degrades to no match rather than
      // surfacing an out-of-scope code.
      const alias = METRO_ALIASES[normalizeQuery(query)];
      const pool = exact
        ? [exact]
        : alias
          ? ctx.refs.filter((r) => alias.includes(r.code))
          : ctx.refs.filter((r) => matchesQuery(r, query));

      const matches: ResolveMatch[] = pool.map((r) => ({
        code: r.code,
        name: r.name,
        city: r.city,
        state: r.state,
      }));

      return {
        matches,
        message:
          matches.length > 0
            ? `Found ${matches.length} match(es) in the in-scope universe.`
            : `No airport matching "${parsed.value.query}" was found in the in-scope universe.`,
      };
    });
  };
}
