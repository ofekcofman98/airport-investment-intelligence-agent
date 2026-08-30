# ADR 0004: Data snapshot, not a live API

## Status
Accepted

## Context
Real public aviation data (BTS) is downloaded once and stored as a local
snapshot, rather than queried live on every request.

## Decision
Download BTS T-100 Segment and On-Time Performance data once, normalize to
JSON in `data/processed/`, and treat it as static for the life of the demo.
This is **not** a caching mechanism with periodic refresh — no TTL, no
refresh logic.

## Rationale
- Historical aviation data doesn't change materially day to day.
- In a one-day build/demo, reliability matters far more than liveness: if
  the live API goes down, changes schema, or rate-limits during the demo,
  it wrecks the day.
- A snapshot also makes the scoring layer's inputs fully deterministic and
  reproducible for tests.

## Consequences
- `data/raw/` holds the exact downloaded files (gitignored — bulky);
  `data/processed/` holds the normalized JSON actually used at runtime
  (committed).
- `data/processed/manifest.json` records download date and BTS revision
  stamp so the snapshot's provenance and staleness are always inspectable.
- Refreshing the snapshot is a manual, deliberate re-run of
  `src/data/build.ts`, never an automatic background process.
