# src/interface/ — channel adapters

- A channel calls `agent.handleMessage(input, sessionId)` and nothing else.
  No imports from `src/scoring/` or `src/data/` — if a channel needs
  something beyond text in/text out, that need belongs in the agent core's
  interface, not worked around here.
- `channel.ts` defines the abstract `Channel` interface (the adapter
  pattern). `cli.ts` is the required, primary implementation (readline),
  generating one `sessionId` per process run.
- `webChatStub.ts` is optional/bonus, only if time remains — a single HTML
  file + one local server, not a monorepo client/server.
- Voice is structurally supported (a `Channel` impl at the STT/TTS
  boundary) but not implemented — no real STT/TTS in this build.
- `composition.ts` is the composition root: the only file that wires
  `src/data`, `src/agent`, `src/obs`, and `anthropicClient.ts` together.
  `cli.ts` (and any future channel) calls `compose()` and gets back
  fully-wired deps — it never constructs a data source, tool handlers, or
  an LLM client itself. `anthropicClient.ts` is the only file importing
  `@anthropic-ai/sdk`, implementing `orchestrator.ts`'s local `LlmClient`.
  Independent decision, recorded as ADR 0009.
- Each CLI turn clears `src/obs/trace.ts` before calling `handleMessage` so
  `/why`/`/trace` mean "the last answer", not the whole process's history —
  a channel-local choice, since the trace recorder itself has no built-in
  per-turn boundary.

See ADR 0006, ADR 0007, ADR 0009.
