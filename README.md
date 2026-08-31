# Airport Investment Intelligence Agent

AI agent that answers investment-research questions about US airports
(congestion, unmet demand, expansion opportunity) using public BTS
aviation data — built for the FDE take-home assignment at Wonderful.

## Quick start

```bash
npm install
export ANTHROPIC_API_KEY=sk-...
npm run cli
```

## Requirements

- Node.js 20.6+ (for `--env-file-if-exists`, used by `npm run cli`)
- An Anthropic API key

## Try it

- "What is the percentage of long-haul flights out of Anchorage?"
- "Which airports in New England are strong candidates for terminal expansion?"
- "Compare LA and Santa Ana airport congestion levels."
- "What is the unmet flight demand at SFO and why?"

In the CLI: `/why` shows which tool calls produced the last answer's
numbers, `/trace` shows the full tool call/result trace, `/reset` clears
session history.

## Data

Static snapshot, ~48 top US airports by 2025 enplanements (plus a few
forced-include regional airports), built from BTS TranStats:

- **T-100 Segment** (full-year 2025, plus 2024 for YoY growth) — passengers,
  seats, departures scheduled/performed, distance
- **Marketing Carrier On-Time Performance** — single representative month
  (March 2025) — delay, taxi-out, and cancellation signals

No live refresh; see `data/processed/manifest.json` for exact download
dates and `SPEC.md` §1–2 for scope and sampling rationale.

## Architecture

`data → scoring → agent → interface` (+ `src/obs` for a reasoning trace).
Each layer sits behind a defined interface; the LLM never computes a
score — every number traces to a pure function in `src/scoring/`.

- Full write-up: `docs/architecture.md`
- Design decisions: `docs/decisions/` (10 ADRs)
- Exact scope: `SPEC.md`

## Testing

```bash
npm test        # 148/148 passing
npm run typecheck
```

## Known, documented scoping decisions

- Voice: bonus per assignment — not implemented, `Channel` adapter ready (ADR 0006)
- Delay metrics: single-month sample, March 2025 (SPEC §2)
