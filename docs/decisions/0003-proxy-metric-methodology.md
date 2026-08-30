# ADR 0003: Documented proxy-metric methodology

## Status
Accepted

## Context
Concepts like "congestion," "spare capacity," and "unmet demand" are not
fields that exist directly in any API — they must be derived from raw
metrics (load factor, delays, flights/seats, etc.) into proxy measures.

## Decision
Every proxy metric must have:
- An explicit, documented formula (not "magic" buried in a prompt) —
  recorded in `SPEC.md` §4 and `src/scoring/weights.ts`.
- A matching explanation ("why") spelling out which signals drove the
  score — returned as a contribution breakdown, not just a number.
- Acknowledged confounders (e.g. delays can stem from weather/ATC, not only
  infrastructure congestion) — surfaced in the answer, not hidden.

## Rationale
This is the assignment's uncertainty-communication requirement made
concrete: a proxy metric without a stated formula and stated confounders is
indistinguishable from an LLM guess, which is exactly what ADR 0002 exists
to prevent.

## Consequences
See `docs/architecture.md` "Key tradeoffs" for the two methodology
tradeoffs this creates (signal overlap across composed scores; weights as
heuristics, not fitted parameters) and how each is handled.
