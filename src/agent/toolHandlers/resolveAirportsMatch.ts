/**
 * src/agent/toolHandlers/resolveAirportsMatch.ts — resolve_airports matching
 * (used by handlers/resolveAirports.ts).
 *
 * A plain `field.includes(query)` substring check has two failure modes,
 * both surfaced by real end-to-end testing (docs/fixes/answers/answer3.md):
 *   - too permissive for a short query: "la" is a substring of "Atlanta",
 *     "Dallas", "Orlando", "Charlotte" (via "Douglas"), etc. — nearly every
 *     airport in the universe, none of them Los Angeles.
 *   - too strict for a multi-word query with a trailing generic word: query
 *     "santa ana airport" is never a substring of city "Santa Ana", since
 *     the query is longer than the field.
 * Fixed by matching whole query words at word boundaries in the airport's
 * code/name/city (so "la" no longer matches mid-word), requiring every
 * non-generic query word to match rather than the query as one literal
 * substring (so a trailing "airport"/"international" doesn't break the
 * match).
 *
 * Metropolitan abbreviations ("NYC", "SF", "DC", "LA") are handled
 * separately and *before* this word-boundary matching, via the curated
 * METRO_ALIASES table (ADR 0010) — some, like "SF"/"DC", would otherwise
 * only resolve by an accidental code-prefix collision (matching "sfo"/
 * "dca"), and others, like "NYC", cannot resolve at all under word-boundary
 * matching even though the airports are in scope.
 */

import type { AirportRef } from "../../data/types.js";

export const GENERIC_QUERY_WORDS = new Set(["airport", "airports", "international", "intl", "the"]);

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function matchesQuery(ref: AirportRef, query: string): boolean {
  const words = query.split(/\s+/).filter((w) => w.length > 0);
  const significant = words.filter((w) => !GENERIC_QUERY_WORDS.has(w));
  // A query made entirely of generic words ("airport") has nothing specific
  // to match on — fall back to the raw words rather than matching everything.
  const tokens = significant.length > 0 ? significant : words;

  const haystacks = [ref.code, ref.name, ref.city].map((h) => h.toLowerCase());
  return tokens.every((token) => {
    const boundary = new RegExp(`\\b${escapeRegExp(token)}`, "i");
    return haystacks.some((h) => boundary.test(h));
  });
}
