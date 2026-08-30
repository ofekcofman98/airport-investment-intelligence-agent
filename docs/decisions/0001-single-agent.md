# ADR 0001: Single agent, not multi-agent

## Status
Accepted

## Context
The system answers query, ranking, comparison, and explanation questions
about airports — all read-only operations against a fixed data snapshot.

## Decision
Use one agent with tool selection, not a multi-agent architecture.

## Rationale
Sub-agent splitting is justified by a genuine difference in *authority* or
*risk* between request types (e.g. read vs. write, or trusted vs.
untrusted input) — not merely by "a few different question types." Every
operation here is read-only and equally low-risk, so there is no authority
boundary to split along. One agent choosing from a shared tool set is
simpler to reason about, trace, and test.

## Consequences
All tools live in one registry (`src/agent/tools.ts`); the orchestrator is
a single tool-use loop. Revisit only if a future capability introduces a
real authority split (e.g. a write/action tool).
