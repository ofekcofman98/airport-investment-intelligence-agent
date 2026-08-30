# ADR 0010: Free-text airport resolution strategy in resolve_airports

## Status
Accepted

## Context
`resolve_airports` (`src/agent/toolHandlers.ts`) turns free text (a city, a
full name, an abbreviation, or a code) into in-scope IATA codes. Live testing
(`docs/fixes/answers/answer3.md`, fixed via word-boundary matching plus a
single hardcoded `la -> LAX` alias) surfaced a further gap on review: that fix
was strictly literal (exact code, then whole-word matching against
code/name/city), which leaves common metropolitan abbreviations unresolved or
resolved only by accident.

- **"NYC" returned zero matches.** No code starts `nyc`, and the city field is
  `"New York"`, which `\bnyc` cannot match — even though JFK, LGA, and EWR are
  all in scope. The empty result reads to the LLM as "not in our universe,"
  which is simply wrong, not just unhelpful.
- **"SF" and "DC" only worked by accident.** `\bsf` happens to prefix-match
  the *code* `sfo`; `\bdc` happens to prefix-match `dca`. Neither `state` nor
  any alias list was consulted — "DC" silently never reaches IAD, and nothing
  guarantees the coincidence holds as the registry changes.
- **"LA" needed a hardcoded alias precisely because the same coincidence
  doesn't occur for it** — `\bla` matches LAS, LaGuardia, Lauderdale, Salt
  *La*ke, *La*mbert, but never "Los Angeles" itself.

This is a decision independent of any ADR or SPEC section (root `CLAUDE.md`
"Independent decisions"): SPEC fixes the airport universe and question types,
not how free text maps onto codes.

## Decision
Add `src/agent/airportAliases.ts`: a small, hand-curated
`METRO_ALIASES: Record<string, readonly AirportCode[]>` table plus a
`normalizeQuery()` helper (lowercase, strip periods, collapse whitespace).
`resolve_airports` checks it as a second stage, **short-circuiting** the
word-boundary matcher on a hit (so `"la"` returns only `["LAX"]`, not `LAX`
unioned with every ref whose name/city starts with "la"):

```
1. exact code match
2. metro alias hit  -> return exactly those codes (filtered to the current
                        universe, so a dropped code degrades to no match
                        rather than an out-of-scope code)
3. word-boundary token match against code/name/city (unchanged from the
   answer3.md fix)
```

`systemPrompt.ts`'s tool-selection guidance gained one line: when
`resolve_airports` returns more than one match, name the candidates and ask
rather than silently pick — since a metro alias can now legitimately return
several codes (`nyc -> JFK, LGA, EWR`).

**Explicitly declined: typo tolerance / fuzzy or edit-distance matching.**
`"Snta Ana"` still returns zero matches. A similarity threshold is a
correctness knob that needs tuning and can produce a confidently wrong match
silently — the cost of an honest "no match" (the LLM refuses and asks) is
lower than a fuzzy resolver guessing the wrong airport. If this becomes a
real usability problem, the fix is a second, explicit request for
clarification, not a lowered matching bar.

**Explicitly declined: LLM-side entity resolution.** The model could be asked
to expand "NYC" into candidate codes itself before calling the tool, but that
moves entity resolution — an auditable, testable operation — into the
un-auditable half of the split ADR 0002 draws. Keeping the alias table
deterministic means every resolution is a unit-tested fact, not a model
guess that happens to be right today.

## Consequences
- Adding a new metro alias is a one-line table edit + a unit test, never a
  change to the matching algorithm.
- `airportAliases.test.ts` includes a drift guard: every alias's target codes
  must exist in `AIRPORT_REGISTRY`, so a future universe edit (SPEC §1) that
  drops a code fails a test immediately instead of silently degrading an
  alias. This is a deliberate test-only reference from `src/agent/` to
  `src/data/airportRegistry.ts`'s exported constant — production code still
  reaches the universe only through the injected `AirportDataSource`, per
  `src/data/CLAUDE.md`.
- The alias table only grows by hand-curation; it is not, and is not meant to
  become, a general gazetteer.
