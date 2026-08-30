# Fix log

## 2026-08-30 — KPI audit layer rejected every scored answer

**Symptom** (`docs/fixes/answers.md`): "Which airports in New England are
strong candidates for terminal expansion?" returned the raw-JSON
`templatedAnswer()` fallback instead of prose, with
`[note: this answer was templated by the output-consistency check before
being shown]`. The underlying ranking was correct (PWM 66.8, BOS 64.4,
PVD 60.8, BDL 54.6; MHT/BTV excluded `below_min_volume`) — only the
narration layer failed.

**Root cause.** `auditNarration()` (`src/agent/orchestrator.ts`) cross-checks
every number in the model's narration against numbers found in that turn's
tool results, and discards the narration on any mismatch (twice, then falls
back to the template). Three independent bugs in what counted as "truth"
meant no scored answer could ever pass:

1. `extractNumbersFromResults` only collected `typeof value === "number"`
   fields, but `systemPrompt.ts` *requires* every scored answer to restate
   the SPEC §4a caveat close to verbatim — and the caveat's numbers (`~400`,
   `90`) live inside a **string** field, never entering the truth set.
2. Claim extraction used a plain digit regex, so a narrated `686,314` (a
   required excluded-airport passenger count) was read as two numbers, `686`
   and `314`.
3. A tool result's raw fraction (`paxGrowthYoy: 0.0532`) is naturally
   narrated as a percentage ("5.3%"), which never matches `0.0532` under a
   ±0.5 absolute tolerance.

**Fix.** `auditNarration`/`extractNumbersFromResults`/`extractNumbers` in
`src/agent/orchestrator.ts`:
- truth extraction now also scans numbers inside string-typed result fields;
- claim extraction strips thousands separators before matching;
- a claim written as `"N%"` also passes if `N/100` matches a truth value;
- truth values ≥ 10,000 additionally accept a claim within 1% relative
  (on top of the existing strict ±0.5 absolute, which still applies to
  everything else — scores are unaffected).

Full reasoning and decision record: ADR 0009 (D3).

**Verification:** `npm run typecheck`, `npm test`, then the exact question
from `answers.md` re-run via `npm run cli` — see that file's second entry.

## 2026-08-30 — resolve_airports over/under-matched free-text queries

**Symptom** (`docs/fixes/answers/answer3.md`): "Compare LA and Santa Ana
airport congestion levels" templated. `resolve_airports({query: "LA"})`
returned 15 unrelated matches; `resolve_airports({query: "Santa Ana
airport"})` returned zero.

**Root cause.** `resolve_airports` (`src/agent/toolHandlers.ts`) matched with
plain `field.includes(query)`:
- too permissive for short queries — `"la"` is a raw substring of
  "At**la**nta", "Dal**la**s", "Or**la**ndo", etc., matching nearly every
  airport in the universe;
- too strict for multi-word queries — `"santa ana airport"` is longer than
  the city field `"Santa Ana"`, so it can never be a substring of it, even
  though SNA is in scope.

**Fix.** Replaced substring matching with: strip generic words ("airport",
"international", …) from the query, then require every remaining query word
to match a whole word (word-boundary prefix) in the airport's code/name/city
— fixes both directions. Added one narrow, curated alias (`"la" → LAX`),
since "LA" is genuine informal shorthand that never appears as a
word-boundary match of "Los Angeles" itself, and SPEC's own example question
depends on resolving it (flagged, not a general abbreviation resolver).

**Verification:** `npm run typecheck`, `npm test` (6 new
`toolHandlers.test.ts` cases), then the exact question from `answer3.md`
re-run via `npm run cli` — returns a clean LAX-vs-SNA prose comparison, with
the model itself surfacing the remaining "LA" ambiguity (LAX/LAS/LGA/SLC/STL,
all legitimate "La-" prefix matches) rather than silently guessing.

## 2026-08-30 — metropolitan abbreviations ("NYC", "SF", "DC") unresolved or resolved by accident

**Symptom (found on review, not a live-test failure).** The previous fix's
one-off `la -> LAX` alias raised the question of what other common metro
abbreviations do. `"NYC"` returned zero matches (JFK/LGA/EWR are in scope but
unreachable — the empty result is narrated as "not in our universe," which is
wrong). `"SF"`/`"DC"` only worked because `\bsf`/`\bdc` happen to prefix-match
the codes `sfo`/`dca` — not by design, and `"DC"` silently never reached IAD.

**Fix.** New `src/agent/airportAliases.ts`: a small, curated
`METRO_ALIASES` table (`nyc`, `la`, `sf`, `dc`, and their longer forms) plus
`normalizeQuery()` (case/whitespace/period normalization). `resolve_airports`
now checks it as a second stage, **short-circuiting** word-boundary matching
on a hit — `"la"` returns only `LAX`, not `LAX` unioned with every airport
whose name/city starts with "la" (LAS, LaGuardia, Lauderdale, ...).
`systemPrompt.ts` gained a line telling the model to name candidates and ask
when `resolve_airports` returns more than one match, since an alias can now
legitimately be multi-airport. Typo tolerance (fuzzy/edit-distance matching)
was explicitly declined — see ADR 0010 for the reasoning.

**Verification:** `npm run typecheck`, `npm test` (new
`airportAliases.test.ts` plus extended `toolHandlers.test.ts` cases), then
`npm run cli` for "NYC", "DC", and the original LA/Santa Ana question.

## 2026-08-30 — 3-way compare_airports narration templated on a correct answer

**Symptom.** "Compare congestion at DC airports" (DCA/IAD/BWI) intermittently
templated. Reproduced with temporary debug logging of `auditNarration`'s
input/output around both the first attempt and the regeneration in
`orchestrator.ts`.

**Root cause — two audit regex bugs, not a model error; both narration
attempts stated correct values:**
1. The model wrote `"~25-29"` for load factor (DCA 29.4, BWI 25.0, both
   normalized). `NUMBER_PATTERN`'s optional leading `-` matched the hyphen in
   `"25-29"` as a negative sign, parsing the second number as `-29` — which
   matches nothing in the truth set (truth has `29.4` and `25.0`, no negative
   values). A genuine negative number is never written glued to a preceding
   digit with no separator, so this was always a false positive waiting to
   happen on any hyphenated range.
2. The regenerated attempt also got flagged on a bare `100` from
   `"0–100 scale"` — describing the fixed bounds every normalized score/
   confidence value has by construction, not a claimed figure.

**Fix** (`src/agent/orchestrator.ts`):
- `NUMBER_PATTERN` gained a negative lookbehind (`(?<!\d)-?\d+...`) so a `-`
  immediately preceded by a digit is read as a range separator, not a sign.
- A bare `0` or `100` is now exempted from claim extraction the same way a
  stated year already was (`looksLikeScaleBound`, alongside `looksLikeYear`).
- `systemPrompt.ts` also gained a hard constraint (#6): for 3+ airport
  comparisons, state each figure as its own exact value (prefer a table)
  rather than a hyphenated range — defense-in-depth on top of the regex fix,
  since a vague range is inherently harder for any regex-based audit to
  parse correctly.

**Verification:** `npm run typecheck`, `npm test` (3 new
`orchestrator.test.ts` cases: the exact hyphenated-range regression, a
genuine negative number still catches a real mismatch, and the 0/100
scale-bound exemption), then re-ran "Compare congestion at DC airports"
repeatedly via `npm run cli` with no further template fallback.
