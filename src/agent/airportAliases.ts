/**
 * src/agent/airportAliases.ts — curated metropolitan-abbreviation aliases
 * for resolve_airports (ADR 0010).
 *
 * Deliberately a small, hand-maintained table, not a fuzzy/edit-distance
 * matcher and not an LLM lookup: entity resolution stays deterministic and
 * auditable (ADR 0002). Only covers colloquial forms that
 * toolHandlers.ts's word-boundary matching cannot already reach — see
 * ADR 0010 for why each entry exists.
 */

import type { AirportCode } from "../data/types.js";

/** Lowercase, collapse whitespace, and strip periods so punctuation variants
 * ("D.C.", "  dc ", "DC") all key the same alias entry. */
export function normalizeQuery(raw: string): string {
  return raw.toLowerCase().replace(/\./g, "").trim().replace(/\s+/g, " ");
}

export const METRO_ALIASES: Record<string, readonly AirportCode[]> = {
  // "LA" is not a substring/prefix of "Los Angeles" itself, so word-boundary
  // matching can never reach LAX from it — unlike "LAS", "LaGuardia",
  // "Lauderdale", etc., which it reaches by accident. Intentionally excludes
  // SNA: SPEC's own example question contrasts "LA" *with* Santa Ana.
  la: ["LAX"],

  // No code starts "nyc" and the city field is "New York", which "nyc"
  // cannot match — this query previously returned zero matches even though
  // all three airports are in scope.
  nyc: ["JFK", "LGA", "EWR"],
  "new york city": ["JFK", "LGA", "EWR"],

  // "SF" only worked before by an accidental code-prefix hit on "sfo" — this
  // makes it a stated alias instead of a matching-logic side effect.
  sf: ["SFO"],
  "san fran": ["SFO"],
  "bay area": ["SFO", "OAK", "SJC"],

  // "DC" also only worked by accident (prefix of code "dca"), and missed
  // IAD entirely; state metadata ("DC") is not part of the match haystack.
  dc: ["DCA", "IAD"],
  "washington dc": ["DCA", "IAD"],
};
