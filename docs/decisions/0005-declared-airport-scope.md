# ADR 0005: Declared scoping, not full coverage

## Status
Accepted

## Context
There are ~400+ US airports with BTS-reportable commercial service. Full
coverage isn't necessary for a one-day demo and would dilute effort spent
on the actual thing being evaluated: scoring and proxy logic.

## Decision
Cover a declared subset of ~46 airports: the top ~40 US airports by 2025
enplanements, plus a forced-include list (`LAX`, `SNA`, `ANC`, `SFO` for
the assignment's example questions; `BOS`, `BDL`, `PVD`, `MHT`, `PWM`,
`BTV` for New England completeness). Full list in `SPEC.md` §1.

## Rationale
30-50 well-handled airports beat 400 shallow ones. The scope is stated
explicitly rather than left to be discovered by a user hitting an
unsupported airport.

## Consequences
- An out-of-universe airport query returns a structured "not in scope"
  result — never an LLM-improvised number (see ADR 0002).
- Every score is normalized relative to this universe, not to all US
  airports — surfaced in every scored response (SPEC §4a).
