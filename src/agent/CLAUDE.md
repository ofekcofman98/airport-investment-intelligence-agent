# src/agent/ — orchestration layer

- The LLM (via `orchestrator.ts`) interprets the question, selects a tool
  and arguments, and narrates the final answer. It never computes a score,
  invents a number, or picks a weight (ADR 0002) — every number in a
  response must be traceable to a `src/scoring/` function call recorded via
  `src/obs/trace.ts`.
- `tools.ts` defines tool *schemas* only (what the LLM sees). Add a new
  tool here without touching `orchestrator.ts`.
- `toolHandlers.ts` is the only bridge from a tool call to
  `src/scoring/` + `src/data/`. Keeping it separate from `tools.ts` means
  swapping the LLM SDK touches `orchestrator.ts`/`tools.ts` only.
- `session.ts` owns conversation history, keyed by `sessionId` (ADR 0007).
  Nothing in `src/interface/` stores history itself.
- `systemPrompt.ts` must state the relative-normalization caveat rule
  (SPEC §4a) and the refusal cases (SPEC §5) as hard constraints.

## Error handling

`toolHandlers.ts` is responsible for catching any error raised by the
scoring or data layer (validation failure, unknown airport/KPI, thin data)
and converting it into a structured result the LLM can narrate as a
refusal. The LLM must never see a raw stack trace or exception — every tool
result reaching the orchestrator is either a valid payload or a structured
"refusal" shape, nothing else.

## Required follow-ups (implement when this layer starts)

Recorded now so they aren't skipped once `orchestrator.ts` exists — not
implemented yet:

- **KPI audit layer (output-consistency check).** A different failure mode
  than "the LLM computes a number" (already prevented by ADR 0002): the LLM
  could misquote or mis-round a value that a tool call already returned
  correctly. Before finalizing a turn, cross-check every numeric claim in
  the narration against that turn's tool results (tolerance ±0.5). On
  mismatch, discard the narration and either regenerate once or fall back
  to a templated response built directly from the tool's exact values.
  Defense-in-depth on top of the LLM/deterministic split, not a
  replacement for it.
- **Tool-call round limit.** Cap agentic tool-calling rounds per turn
  (`MAX_TOOL_ROUNDS = 5` in `orchestrator.ts`). If the cap is hit, make one
  final LLM call with tools disabled, forcing a synthesized answer from
  whatever data has already been gathered, instead of letting the loop
  continue. Standard cost/latency safeguard for any tool-calling agent.

See ADR 0001, ADR 0002, ADR 0007, ADR 0008.
