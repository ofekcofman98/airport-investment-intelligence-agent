# ADR 0007: Session/conversation state lives in the agent core

## Status
Accepted

## Context
Follow-up questions must work ("what about JFK?" after a prior question).
There's no built-in state between LLM API calls — conversation history has
to be kept and replayed explicitly on every call. Per ADR 0006, the
interface layer is meant to be a thin, swappable channel adapter.

## Decision
Conversation history is owned and stored by the agent core, in
`src/agent/session.ts`, keyed by `sessionId`. A channel's only
responsibility is to generate/hold a `sessionId` and pass it into
`handleMessage(input, sessionId)` — it never stores or manipulates history
itself.

## Rationale
If session state lived in the interface layer instead, every new channel
(web, voice) would have to reimplement history management, and swapping
channels could lose or fragment conversation state. Keeping it in the core
means any channel gets multi-turn follow-ups for free, and it keeps
`src/interface/` genuinely thin per ADR 0006's separation.

## Consequences
- `src/agent/session.ts` exposes something like `getHistory(sessionId)` /
  `appendTurn(sessionId, turn)`, used only by `orchestrator.ts`.
- History storage is in-memory for the demo (process-lifetime only); a
  persistent store (file/DB) would be a swap-in implementation behind the
  same interface, not a redesign.
- `src/interface/cli.ts` generates one `sessionId` per CLI process and
  reuses it for every input line in that run.
