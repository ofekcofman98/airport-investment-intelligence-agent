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

See ADR 0002, ADR 0003.
