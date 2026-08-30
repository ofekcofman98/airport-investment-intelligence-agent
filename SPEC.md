# SPEC — Airport Investment Intelligence Agent

Status: **approved** (2026-08-30). Scope-defining document. Architectural
decisions (single agent, LLM/deterministic split, static snapshot, CLI-first
with a channel adapter, per-session history) are recorded as ADRs in
`docs/decisions/` and are not re-litigated here.

## 1. Scope declaration

**Geography:** US airports only.

**Time window:** calendar year **2025** as the analysis period, with **2024**
loaded solely to compute year-over-year growth.

> Availability verified 2026-08-30 before committing to this window: BTS
> publishes T-100 with roughly a two-month lag and TranStats currently
> carries segment data into early/mid-2026; DOT released Airline Service
> Quality (On-Time) data for June 2026 in early August 2026. Full-year 2025
> and 2024 are both complete and downloadable today.
>
> Residual caveat: T-100 **international** segments revise on a longer cycle
> than domestic. At 8+ months past year-end the 2025 international figures
> are effectively final, but the build script records the exact download
> date and BTS revision stamp in `data/processed/manifest.json` so any later
> restatement is traceable.

Single static snapshot, no refresh — see ADR on snapshot-vs-live.

**Airport universe (~46 airports):** top ~40 US airports by 2025
enplanements, plus a forced-include list so no example question lands on an
empty set:
- Example-question airports: `LAX`, `SNA`, `ANC`, `SFO`
- New England completeness: `BOS`, `BDL`, `PVD`, `MHT`, `PWM`, `BTV`

Everything outside this list is **out of scope**. The agent states this
explicitly for an unknown airport rather than guessing — an out-of-universe
query returns a structured "not in scope" result, never an LLM-improvised
number.

**Minimum volume for ranking:** airports below **1,000,000 annual
passengers** (analysis-year) are excluded from `rank_airports` results. A
low-base airport can post a headline `pax_growth_yoy` that is statistically
meaningless (3 → 6 departures = "+100%") and would otherwise top a regional
expansion ranking on noise. These airports remain fully queryable for
single-metric lookup, explanation, and comparison — they are excluded only
from ranking, and **visibly**: `rank_airports` returns an `excluded: [{
code, reason: "below_min_volume", passengers }]` list alongside `results`,
which the agent must mention rather than silently drop. The threshold is a
named constant in `src/scoring/weights.ts`, applied in
`src/scoring/rankCompare.ts` before ranking.

**Explicitly out of scope:** non-US airports; cargo-only analysis; capital
cost / ROI / valuation modelling (we score *opportunity*, not project
economics); real-time flight status; slot-allocation and gate-count data
(not available in the chosen public sources — a stated limitation of the
congestion proxy, not an oversight).

## 2. Data sources

| Source | Table | Fields used |
|---|---|---|
| BTS TranStats | T-100 Segment (Domestic + International) | `ORIGIN`, `DEST`, `PASSENGERS`, `SEATS`, `DEPARTURES_SCHEDULED`, `DEPARTURES_PERFORMED`, `DISTANCE`, `YEAR`, `MONTH` |
| BTS TranStats | Marketing Carrier On-Time Performance | `ORIGIN`, `DEP_DEL15`, `DEP_DELAY`, `TAXI_OUT`, `CANCELLED`, `NAS_DELAY`, `WEATHER_DELAY`, `CARRIER_DELAY`, `LATE_AIRCRAFT_DELAY` |
| Static (hand-authored) | airport reference | IATA code, name, city, state, region, lat/lon |

Raw ZIP/CSV lands in `data/raw/`; a build script normalizes to one
per-airport JSON in `data/processed/`, plus `manifest.json` recording
download date and BTS revision stamp. TranStats downloads are form-driven —
if the scripted download fails, manual pull will be requested rather than
substituting synthetic data.

**On-Time Performance sampling (stated approximation, not a scope gap).**
On-Time Performance is flight-level (one row per flight), not
segment-aggregated like T-100: a single month is ~237MB, a full year would
be multiple GB. Delay-derived metrics (`del15_rate`, `avg_taxi_out_min`,
`nas_delay_per_departure`, `weather_delay_per_departure`,
`cancellation_rate`) are therefore estimated from a **single representative
month — March 2025** — rather than measured across the full year. March
was chosen deliberately over January/February to avoid winter-weather
seasonal distortion (holiday-adjacent and snow-driven delays would bias
these signals toward weather rather than structural/volume causes). This
is a stated approximation: the manifest and `dataCompleteness` reflect it
directly (see §3), and `explain_score` carries a one-sentence seasonal
caveat for airports with strong seasonal variation (e.g. `ANC`). T-100
(`passengers`, `seats`, `load_factor`, `schedule_adherence_gap`,
`long_haul_share`, `pax_growth_yoy`) remains full-year, both 2024 and 2025.

## 3. Base metrics (measured, not derived)

Per airport, per year, computed deterministically from the snapshot:

- `passengers`, `seats`, `departures_performed`, `departures_scheduled`
- `load_factor` = passengers / seats
- `schedule_adherence_gap` = 1 − departures_performed / departures_scheduled

  > **Known T-100 quirk — this value can be negative.** `DEPARTURES_PERFORMED`
  > can exceed `DEPARTURES_SCHEDULED` because BTS counts non-scheduled
  > operations (charter, extra-section, ad-hoc capacity) as performed even
  > though they were never in the published schedule. A negative gap is
  > **not** treated as a data error and is **not** clamped to 0 — it is
  > left signed, since min-max normalization across the in-scope universe
  > already handles the sign correctly for scoring. It is also
  > interpretively different from a positive gap: it can indicate an
  > airport adding capacity in response to demand pressure rather than
  > failing to meet its schedule. `explain_score`/`describe_methodology`
  > must carry a one-sentence version of this interpretive note wherever
  > `schedule_adherence_gap` appears in a scored breakdown, the same way
  > the weather-delay confounder note is carried for congestion (§4).
- `del15_rate` = share of departures delayed ≥ 15 min
- `avg_taxi_out_min`
- `nas_delay_per_departure` (NAS = National Airspace System delay minutes —
  the delay category closest to volume/infrastructure)
- `weather_delay_per_departure` (a **confounder control**, not a scoring
  input)
- `cancellation_rate`
- `pax_growth_yoy` = passengers(2025) / passengers(2024) − 1

  > **Coverage-parity check performed, not assumed.** Before trusting this
  > ratio, `build.ts` was verified to compare equal-length periods: both
  > the 2024 and 2025 T-100 files contain all 12 months, with comparable
  > row counts and monthly passenger totals in each (ruling out the
  > domestic/international uniform-cutoff trim from §1 as a factor here —
  > that trim affects how recent the *snapshot* is, not month coverage
  > within a completed year). A per-airport spot check (e.g. `ATL`) showed
  > the 2025 decline is consistent across every individual month, not
  > concentrated in a missing or partial tail month. The broad-based
  > decline seen across most large-hub airports (roughly -1% to -15%
  > YoY) against a roughly flat nationwide total is read as a real
  > traffic-distribution signal (an observation for the analysis, not a
  > data defect), not corrected or normalized away.
- `long_haul_share` = departures with `DISTANCE` ≥ 2,500 mi / total
  departures (buckets: short < 1,000 mi; medium 1,000–2,499 mi; long ≥ 2,500 mi)

## 4. Proxy KPIs (derived — the deterministic scoring layer)

All inputs min–max normalized to 0–100 **across the in-scope universe only**
— every score is explicitly relative, never absolute (see §4a). Weights are
named constants in one versioned file and surfaced in every explanation.

**Congestion Score** — how strained the airport is today:

| Signal | Weight |
|---|---|
| `del15_rate` | 30% |
| `nas_delay_per_departure` | 25% |
| `avg_taxi_out_min` | 20% |
| `load_factor` | 15% |
| `cancellation_rate` | 10% |

*Confounders disclosed:* delay minutes also reflect weather, carrier ops,
and upstream late aircraft. `NAS_DELAY` is used as the best available volume
signal, and `weather_delay_per_departure` is reported alongside every
congestion answer so an analyst can discount weather-driven airports (ANC,
BOS). All four delay-derived signals here (`del15_rate`,
`nas_delay_per_departure`, `avg_taxi_out_min`, `cancellation_rate`) are
estimated from the March-2025 sample described in §2 — `explain_score`
carries a one-sentence seasonal caveat for airports with strong seasonal
traffic variation (e.g. `ANC`), noting the score reflects one month, not a
full-year measurement.

**Unmet Demand Score** — demand the airport cannot currently serve:

| Signal | Weight |
|---|---|
| `load_factor` | 35% |
| `pax_growth_yoy` | 30% |
| `nas_delay_per_departure` | 20% |
| `schedule_adherence_gap` | 15% |

**Expansion Opportunity Score** — the headline investment KPI (pressure ×
growth × scale):

| Signal | Weight |
|---|---|
| `congestion_score` | 40% |
| `unmet_demand_score` | 30% |
| `pax_growth_yoy` | 20% |
| `log10(passengers)` (scale) | 10% |

**Spare Capacity Score** = 100 − congestion_score (inverse view, reported
for completeness).

Every score returns a **contribution breakdown** (per-signal normalized
value × weight), a `confidence` field (downgraded on missing inputs or thin
volume), and a `normalization` object (see §4a). The LLM narrates the
breakdown; it never produces it.

**Missing components.** If an airport lacks an input signal (e.g. no
On-Time records for that year), that component is *dropped*, not scored as
0 — scoring a gap as 0 would penalize missing data as if it were poor
performance. The remaining components' weights are renormalized to sum to
1.0 across the signals actually present, via a shared
`renormalizeWeights(present, weights)` helper in `weights.ts`. `confidence`
is reduced in proportion to the dropped weight
(`confidence = dataCompleteness × retainedWeightShare`). Every scored
payload lists which components were dropped.

Two tradeoffs in this formula design — the signal overlap across composed
scores, and the heuristic (not fitted) nature of the weights — are recorded
in full in `docs/architecture.md` under "Key tradeoffs"; only the resulting
design decisions are summarized here:

- **Overlap:** `load_factor` and `nas_delay_per_departure` each feed both
  Congestion and Unmet Demand, which then both feed Expansion Opportunity.
  The hierarchical composition is kept intentionally (it's the reasoning
  story the agent explains), and each raw signal's *compounded* influence on
  the headline score is published via `effectiveRawWeights()` rather than
  left implicit.
- **Weights are heuristics:** no historical labeled dataset (past
  expansions + realized outcomes) exists to fit these weights, so they are
  domain-judgment priors, documented and versioned rather than tuned
  invisibly.

### 4a. Relative-normalization caveat (part of the payload, not just the docs)

Every score object carries:

```
normalization: { basis: "in-scope universe", n: 46, year: 2025 }
```

`explain_score` and `describe_methodology` both return a plain-language
caveat string the agent must surface verbatim in any answer containing a
score:

> "This score is relative to the ~46 major US airports in our dataset, not
> all ~400 US airports. A score of 90 means 'near the top of this set', not
> 'top 10% nationally'."

A response that states a score without this caveat is a spec violation.
Enforced by a unit test asserting the caveat field is present on every
scored payload.

## 5. Supported question types

1. **Single-metric lookup** — "What is the percentage of long-haul flights
   out of Anchorage?"
2. **Ranking** — "Which airports in New England are strong candidates for
   terminal expansion?" (filter by region/state/size → rank by a named KPI →
   top N)
3. **Comparison** — "Compare LA and Santa Ana airport congestion levels."
   (2+ airports, side-by-side on one KPI with driver deltas)
4. **Explanation / why** — "What is the unmet flight demand at SFO and
   why?" (score + contribution breakdown + confounders)
5. **Methodology** — "How do you define congestion?" (returns the
   documented formula, no data access)
6. **Follow-up** — "What about JFK?" resolved against per-session history

**Refusal cases (the agent declines, not improvises):** airports outside the
universe; any year other than **2025** (the only independently queryable
year — 2024 is background-only, loaded per §1 solely to compute
`pax_growth_yoy`, and is never returned by `get_airport_metrics` on its
own); capital cost / ROI / valuation questions; anything requiring gate,
runway, or slot data.

## 6. Agent tool surface (LLM chooses; code computes)

`resolve_airports` · `get_airport_metrics` · `rank_airports(kpi, filter, n)`
· `compare_airports(codes, kpi)` · `explain_score(code, kpi)` ·
`describe_methodology(kpi)`

## 7. Success criteria

All four assignment example questions answered end-to-end from the CLI,
each with a number traceable to a pure function, a stated formula, and a
stated uncertainty. Scoring layer covered by unit tests with no network or
LLM dependency — including tests for `effectiveRawWeights()` summing to 1.0,
for the relative-normalization caveat being present on every scored
payload, for a missing-component case still summing retained weights to 1.0
with strictly lower `confidence` than the complete case, and for
`rankCompare.ts` excluding a sub-threshold airport from `results` while
listing it in `excluded`.
