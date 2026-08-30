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

See ADR 0006, ADR 0007.
