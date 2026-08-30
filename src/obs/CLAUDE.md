# src/obs/ — reasoning trace (observability)

- `trace.ts` is a write-only recorder: `orchestrator.ts` appends a
  `TraceEvent` (`{ tool, args, result, timestamp }`) on every tool
  call/return within a turn.
- Never a source of truth for an answer — it only observes what already
  crossed the `src/agent/tools.ts` boundary. No side effects on scoring or
  data.
- Consumed by `cli.ts` (e.g. a `--trace` flag or a `/why` follow-up) to
  show exactly which tools ran with which arguments and results.
