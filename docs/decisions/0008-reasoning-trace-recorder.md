# ADR 0008: Reasoning-trace recorder (src/obs/)

## Status
Accepted

## Context
`src/obs/` was not part of the folder structure originally proposed and
approved in Stage 3. It was added afterward as an independent decision and
is recorded here per the global `CLAUDE.md` rule: flag decisions not
covered by an existing ADR rather than silently picking one.

## Decision
Add `src/obs/trace.ts`: a write-only, in-memory recorder that logs every
tool call/result (`{ tool, args, result, timestamp }`) made during a turn.
`orchestrator.ts` appends to it; `cli.ts` can surface it (e.g. via a
`--trace` flag or a `/why` follow-up).

## Rationale
The assignment requires the agent to "explain its reasoning clearly." A
trace of the exact tool calls and deterministic results behind an answer is
a direct, cheap way to satisfy that: it lets a user (or a reviewer) see
precisely which data and formula produced a number, which also doubles as
proof — not just an assertion in docs — of the LLM/deterministic split in
ADR 0002. It costs nothing beyond appending to an array; no new dependency,
no change to scoring or data.

## Consequences
- `src/obs/` is a fifth layer alongside data/scoring/agent/interface, with
  its own `CLAUDE.md`: write-only, never a source of truth for an answer,
  no side effects on scoring or data.
- Only `src/agent/orchestrator.ts` writes to it; only `src/interface/`
  reads from it for display. No other layer touches it.
