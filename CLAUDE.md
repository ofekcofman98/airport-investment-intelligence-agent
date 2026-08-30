# CLAUDE.md — Airport Investment Intelligence Agent

Global rules for working in this repo. See `SPEC.md` for exact scope and
`docs/architecture.md` + `docs/decisions/` for the reasoning behind every
rule below.

## Layering rule (the core architectural constraint)

Four layers, each with its own local `CLAUDE.md`, communicating **only**
through the interface each exposes:

```
src/data      -> AirportDataSource interface (data/CLAUDE.md)
src/scoring   -> pure functions, no I/O                 (scoring/CLAUDE.md)
src/agent     -> tool calls + LLM synthesis only         (agent/CLAUDE.md)
src/interface -> Channel adapter, calls agent core only  (interface/CLAUDE.md)
src/obs       -> write-only trace recorder               (obs/CLAUDE.md)
```

Adding or swapping a component (new tool, different data source, a cache
layer, a new channel) should only ever mean adding a new implementation of
an existing interface — never editing code in another layer. If you're
about to import across a layer boundary that isn't the declared interface,
stop and reconsider.

## The non-negotiable split

The LLM interprets the question, selects tools/arguments, and narrates
results in natural language. It **never** computes a score, invents a
number, or picks a weight. All scoring/ranking/comparison logic is pure,
unit-tested functions in `src/scoring/`, reachable from the LLM only via
`src/agent/tools.ts`. See ADR 0002.

## Before changing scope

Airport universe, KPIs, and supported question types are fixed in
`SPEC.md`. Changing any of them is a scope decision, not an implementation
detail — flag it rather than silently expanding/narrowing.

## Every scored response

Must include the relative-normalization caveat (SPEC §4a) — a score is
relative to the ~46-airport in-scope universe, never a claim about all US
airports.

## Independent decisions

If you hit a decision not covered by an ADR or `SPEC.md`, resolve it using
the layering/interface principle above, then flag the decision explicitly
rather than silently picking one.