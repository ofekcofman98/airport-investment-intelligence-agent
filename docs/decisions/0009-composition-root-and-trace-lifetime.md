# ADR 0009: Composition root split out of cli.ts; per-turn trace clearing; audit tolerance normalization

## Status
Accepted

## Context
ADR 0006 words the wiring as living directly in `cli.ts` ("The primary
interface is a CLI ... calling that same core function"). Building the
interface layer surfaced two decisions not covered by that ADR or
`SPEC.md`, per the root `CLAUDE.md` "Independent decisions" rule.

1. **Where wiring lives.** `cli.ts` needs a fully-assembled `Agent`
   (data source -> tool handlers -> session store -> trace -> LLM client ->
   agent). Building that assembly inline in `cli.ts` would make `cli.ts`
   both a `Channel` implementation and a cross-layer composition root,
   which contradicts `interface/CLAUDE.md`'s "a channel calls
   `agent.handleMessage(input, sessionId)` and nothing else" — and would
   force a future web/voice channel to duplicate the wiring rather than
   reuse it.
2. **Trace lifetime across turns.** `src/obs/trace.ts`'s `Trace` is a
   single recorder for the process; `orchestrator.ts` returns
   `trace.events()` (cumulative) on every `handleMessage` call. Nothing in
   `src/obs/CLAUDE.md` or ADR 0008 specifies whether a `/why` follow-up
   should show only the latest answer's calls or the whole session's.
3. **Audit tolerance for large-magnitude claims.** First live end-to-end
   test (`docs/fixes/answers.md`) showed `auditNarration()`'s ±0.5 absolute
   tolerance rejecting every scored answer — the required SPEC §4a caveat
   text, thousands-separated counts, and percent-form fractions all failed
   to match `extractNumbersFromResults()`'s truth set, none of which
   `src/agent/CLAUDE.md`'s "KPI audit layer" bullet or any ADR specifies.
   Full diagnosis in `docs/fixes/fixes.md`.
4. **Audit number-parsing false positives.** A later 3-way `compare_airports`
   narration templated despite stating correct values: a hyphenated range
   ("~25-29") was misread as a negative number ("-29"), and a bare "100"
   from "0-100 scale" language was flagged as an unmatched claim. Fixed with
   a negative lookbehind on the number regex and a scale-bound (0/100)
   exemption alongside the existing year exemption. Full diagnosis in
   `docs/fixes/fixes.md`.

## Decision
- Add `src/interface/composition.ts`: the one file that imports across
  `src/data`, `src/agent`, `src/obs`, and this layer's own
  `anthropicClient.ts`. It exposes `compose(): Composition` returning a
  fully-wired `{ agent, trace, sessions, airportCount, analysisYear }`.
  `cli.ts` calls `compose()` and otherwise only touches the `Channel`/
  `ChannelDeps` surface.
- Add `src/interface/anthropicClient.ts`: the only file importing
  `@anthropic-ai/sdk`, implementing `orchestrator.ts`'s locally-defined
  `LlmClient` interface (so the orchestrator's tool-loop/audit/refusal
  logic stays testable with a scripted fake and zero network, unchanged).
- `cli.ts` calls `trace.clear()` immediately before each
  `agent.handleMessage(...)` call, so `/why` and `/trace` describe the turn
  just answered, not the whole process's accumulated history. This is a
  channel-local choice — `src/obs/trace.ts` itself is unchanged and stays a
  simple append-only recorder with no per-turn concept.
- `auditNarration()`'s truth set now also scans string-typed values inside
  tool results (not just bare numbers), so required narration text like the
  caveat is auditable. Claim extraction in the narration strips thousands
  separators before matching, and a claim written as `"N%"` also passes if
  `N/100` matches a truth value. Truth values `>= 10,000` additionally
  accept a claim within 1% relative (not just the strict ±0.5 absolute),
  since an honest narration of a passenger count rounds. AUDIT_TOLERANCE
  stays ±0.5 absolute for everything else, so a 0-100 score is unaffected —
  the fix only widens what the raw numeric-mismatch checker was never
  designed to parse (strings, separators, units), it doesn't loosen the
  score check itself.

## Rationale
Keeps every layer's stated interface literally true rather than
technically-true-with-an-exception, and costs nothing: `compose()` is a
handful of already-existing constructor calls moved into one file that a
second channel (the optional `webChatStub.ts`) can call identically.

## Consequences
- A new channel implementation only ever calls `compose()` + implements
  `Channel` — it never constructs a data source, tool handlers, session
  store, trace recorder, or LLM client itself.
- `src/obs/trace.ts` remains exactly as specified in ADR 0008; per-turn
  scoping is presentation-layer behavior, not a change to the recorder's
  contract.
