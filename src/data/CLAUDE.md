# src/data/ — data source layer

- Exposes the `AirportDataSource` interface (`types.ts`) and nothing else
  to the rest of the app. No other layer should know the shape of the raw
  BTS files or `data/processed/` JSON directly — go through this
  interface.
- `snapshotDataSource.ts` is today's only implementation, reading
  `data/processed/`. A future implementation (different API, a cache layer)
  is a new file implementing the same interface — it must not require
  changes in `src/scoring/` or `src/agent/`.
- `build.ts` is the one-time (or manually re-run) script that turns
  `data/raw/` into `data/processed/`. It is not part of the runtime path.
- `airportRegistry.ts` holds the fixed ~46-airport universe + region/state
  metadata (ADR 0005) — the source of truth for "in scope or not."

See ADR 0004, ADR 0005.
