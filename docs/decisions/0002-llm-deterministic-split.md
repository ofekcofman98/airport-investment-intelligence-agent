# ADR 0002: Hard separation between the LLM and the deterministic layer

## Status
Accepted

## Context
The assignment explicitly tests for "deterministic scoring or ranking
logic, not only LLM output." This is the central axis the whole
architecture is organized around.

## Decision
- The LLM is responsible **only** for: interpreting the question, selecting
  the right tool and arguments, and synthesizing the final explanation in
  natural language (including surfacing assumptions/uncertainty).
- Deterministic code is responsible **only** for: computing every metric,
  score, ranking, and comparison.
- The LLM never invents a number, never picks a weight, and never computes
  a score itself. It calls a pure function and narrates the result it gets
  back.
- The scoring layer (`src/scoring/`) is pure functions: unit-testable, no
  dependency on the LLM or the network.

## Rationale
This is the property that makes the system auditable and demo-safe: every
number in an answer is traceable to a deterministic function call, not to
model sampling. It also makes the scoring layer trivially testable in
isolation.

## Consequences
`src/agent/toolHandlers.ts` is the only bridge between the LLM's tool calls
and `src/scoring/`. If a review ever finds the LLM producing a number that
didn't come from a tool result, that's a bug against this ADR.
