# src/scoring/ — deterministic scoring layer

- Pure functions only. No I/O, no network, no LLM calls, no imports from
  `src/agent/` or `src/interface/`. Inputs in, numbers/objects out.
- Every exported function gets a colocated `*.test.ts`. No network or LLM
  dependency in any test here (see ADR 0002).
- `weights.ts` is the single source of truth for every weight constant —
  versioned, never duplicated or hand-tuned elsewhere.
- `effectiveWeights.ts` (`effectiveRawWeights()`) must be kept in sync with
  `weights.ts` and `proxyScores.ts`'s composition; its test asserts
  compounded weights sum to 1.0 (see `docs/architecture.md` "Key
  tradeoffs").
- Every scored payload must include the `normalization` object and caveat
  string (SPEC §4a) — enforced by a test, not left to the caller.

## Error handling

Invalid input (unknown airport code, unknown KPI name) must fail Zod
validation **before** reaching a scoring function, and return a structured
refusal — never an uncaught exception. Missing or partial underlying data
is reflected via the existing `confidence` field, not a crash: a scoring
function degrades its confidence, it doesn't throw for thin data.

## Missing-component renormalization

A component score is never computed as 0 for a signal the airport lacks.
`weights.ts` exports `renormalizeWeights(present, weights)`, the single
place this happens — it rescales the weights of the signals actually
present back up to sum to 1.0. `confidence` for that score is then
`dataCompleteness × retainedWeightShare`, so thinner data always yields
strictly lower confidence than the complete case. Every composed score
(`proxyScores.ts`) reports which raw signals were dropped. Test required:
a missing-component case sums retained weights to 1.0 and has lower
confidence than the same airport with full data.

## Minimum-volume threshold (ranking scope, SPEC §1)

`rankCompare.ts` filters out airports below the SPEC §1 minimum-volume
constant (declared in `weights.ts`) **before** ranking — never after, and
never silently: excluded airports are returned in a separate `excluded`
list with a reason, alongside `results`. Lookup, explanation, and
comparison are unaffected by this threshold; it applies to
`rank_airports` only. Test required: a sub-threshold airport is absent
from `results` and present in `excluded`.

See ADR 0002, ADR 0003.
