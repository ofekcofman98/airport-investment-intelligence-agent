# ADR 0006: CLI-first interface, with a channel adapter for future growth

## Status
Accepted

## Context
The assignment asks for a "chat interface," not a web app. A separate
client/server (React frontend + Express backend) would be expensive polish
not required by the assignment, diverting effort from the core being
evaluated (scoring/proxy logic).

## Decision
- The agent core is a pure library exposing `handleMessage(input,
  sessionId)` and nothing else — it knows nothing about the communication
  channel.
- The primary interface is a CLI (`src/interface/cli.ts`, readline) calling
  that same core function.
- An abstract `Channel` interface (`src/interface/channel.ts`) defines
  input/output so a web chat or voice channel can be added later as another
  implementation, without touching the agent core or scoring layer.
- Voice is a bonus per the assignment: no real STT/TTS is implemented, only
  an architecture that structurally supports it (a `Channel` implementation
  would sit at the STT/TTS boundary).
- If time remains, a simple web chat (single HTML file + one local server)
  is an optional addition — not required, not prioritized.

## Rationale
Matches the assignment's actual ask (a chat interface) while keeping the
door open for additional channels at near-zero cost, per the "adding a
component should never require changing other layers" principle.

## Consequences
No channel-specific code may appear in `src/agent/` or `src/scoring/`. Any
new channel is a new file in `src/interface/` implementing `Channel`.
