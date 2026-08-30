# data/ — snapshot storage

- `raw/` is exactly-as-downloaded from BTS TranStats. Never hand-edited.
  Gitignored (bulky) — regenerate via `src/data/build.ts` sources, or ask
  for a manual re-download if the scripted fetch fails.
- `processed/` is rebuilt **only** by `src/data/build.ts`. It's the
  normalized, per-airport JSON actually read at runtime, plus
  `manifest.json` (download date + BTS revision stamp). Committed.
- No other code reads `raw/` directly — only `build.ts` does. Runtime code
  reads `processed/` through `src/data/snapshotDataSource.ts`.

See ADR 0004 (static snapshot, not live) and ADR 0005 (declared scope).
