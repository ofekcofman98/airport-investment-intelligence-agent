# Architecture & Methodology

Companion to `SPEC.md` (exact scope) and `docs/decisions/` (ADRs for
standalone architectural choices). This document covers scoring
methodology, key tradeoffs, and where/how AI is used — the three things the
assignment asks the design doc to explain.

_Status: drafted alongside SPEC.md approval, 2026-08-30. Sections below will
be filled in further as implementation proceeds; the tradeoffs section is
final as approved._

## Scoring methodology

See `SPEC.md` §3–§4a for the full metric and KPI definitions. Summary: raw
metrics are computed once from the BTS snapshot, min-max normalized to 0–100
across the in-scope ~46-airport universe, and combined into three named
proxy scores (Congestion, Unmet Demand, Expansion Opportunity) plus one
derived inverse (Spare Capacity) via fixed, versioned weights. All of this
lives in a pure, unit-tested scoring module with no LLM or network
dependency — the LLM never computes a number, it only calls these functions
and narrates the result.

Although every operation in this assignment is read-only, the same
separation is what makes a safe write-confirmation guardrail possible in a
context that does involve writes (e.g. banking, enterprise customer data):
if deterministic code always decides and computes, and the LLM only
interprets and narrates, then the text shown to a user for confirmation
before a write can be generated from the same deterministic call that would
perform it — not from the model's account of what it intends to do.

## Effective weights: what actually drives the headline score

`load_factor` and `nas_delay_per_departure` each feed **both** the
Congestion Score and the Unmet Demand Score, and Expansion Opportunity then
composes those two scores — so their influence on the headline number
**compounds across two channels** and exceeds what either score's nominal
weight suggests on its own (see "Signal overlap" below for why this
composition is kept). The scoring module makes this compounding a stated
number rather than a reader's mental arithmetic: `effectiveRawWeights()` is
a pure function that multiplies the composition through and reports each
raw signal's *total* compounded contribution to Expansion Opportunity:

| Raw signal | Compounded influence |
|---|---|
| `load_factor` | 0.40×0.15 + 0.30×0.35 ≈ **16.5%** |
| `nas_delay_per_departure` | 0.40×0.25 + 0.30×0.20 ≈ **16.0%** |
| `del15_rate` | 0.40×0.30 ≈ 12.0% |
| `avg_taxi_out_min` | 0.40×0.20 ≈ 8.0% |
| `cancellation_rate` | 0.40×0.10 ≈ 4.0% |
| `pax_growth_yoy` (direct + via Unmet Demand) | 0.20 + 0.30×0.30 ≈ **29.0%** |
| `schedule_adherence_gap` | 0.30×0.15 ≈ 4.5% |
| `log10(passengers)` (scale) | 0.10 |

This table is returned by `describe_methodology` and asserted by a unit
test (all compounded weights sum to 1.0).

**With more time:** a sensitivity analysis — perturb each raw signal ±10%
and measure rank churn in the top-10 — would empirically quantify which
signals actually drive the ranking versus which are decorative, and would
be the basis for either pruning a signal or restructuring the composition
to remove the overlap.

## Data quality & cleaning (`src/data/build.ts`)

The BTS T-100 Segment table is **route-level** (carrier × origin × dest ×
aircraft type × month), not airport-level, and requires cleaning +
aggregation before it matches the per-airport shape in `types.ts`. These
rules were identified from manual inspection of the downloaded 2025
file, not assumed from BTS documentation alone:

1. **Drop rows with `DEPARTURES_PERFORMED == 0`.** These are
   scheduled-but-never-operated segments — no actual traffic that month,
   irrelevant to congestion/demand metrics.
2. **Drop rows where `ORIGIN == DEST`.** Same-airport rows represent
   ferry/positioning flights, not passenger service, and would distort
   airport traffic totals if included.
3. **Aggregate by summing `ORIGIN`** across all `DEST`, `UNIQUE_CARRIER`,
   `AIRCRAFT_TYPE`, and all 12 months of the analysis year, for
   `PASSENGERS`, `SEATS`, `DEPARTURES_PERFORMED`, `DEPARTURES_SCHEDULED`.
4. **`DISTANCE` is never averaged directly.** For `long_haul_share`, each
   row is bucketed by `DISTANCE` (short < 1,000 mi / medium
   1,000–2,499 mi / long ≥ 2,500 mi, per SPEC §3), weighted by that row's
   `DEPARTURES_PERFORMED`, then `long_haul_share = sum(departures in the
   long bucket) / sum(all departures)`. A simple row-count average would
   misweight a low-frequency long-haul route against a high-frequency
   short-haul one.
5. **Scope filtering to the ~46-airport universe happens after
   aggregation, not before** — applying `airportRegistry.ts`'s scope
   check as the last step means a later change to the universe (SPEC §1)
   never requires re-deriving the cleaning/aggregation logic above.

**Known coverage caveat (per SPEC §1):** BTS's combined domestic +
international T-100 release trims the last few months of pure-domestic
data to keep a uniform end date across the two sources. `build.ts`
records the exact download date and this caveat in
`data/processed/manifest.json` so a reader can tell whether a given
snapshot's full-year totals might be undercounting a recent quarter,
rather than discovering it silently in a downstream number.

## Key tradeoffs

### Signal overlap across composed scores

`load_factor` and `nas_delay_per_departure` each feed **both** the
Congestion Score (15% / 25% respectively) and the Unmet Demand Score (35% /
20%), and Expansion Opportunity then composes those two scores (40% / 30%).
Their influence on the headline number therefore **compounds across two
channels** and exceeds what either score's nominal weight suggests on its
own.

**Decision: keep the hierarchical composition; make the compounding
visible rather than silent.** Congestion and unmet demand are genuinely
causally linked — a full, delayed airport is the same underlying phenomenon
viewed as *strain* (congestion) and as *unserved demand*. The two-level
structure is also what makes the score legible: "high pressure, growing, at
scale" is a reasoning chain an analyst can follow, whereas flattening
everything into one 8-signal weight vector would remove the double-count
but also remove that reasoning story — which is exactly what the assignment
asks the agent to be able to explain.

**Mitigation implemented, not just documented:** see "Effective weights:
what actually drives the headline score" above — `effectiveRawWeights()`
publishes each raw signal's true compounded contribution rather than
leaving the overlap implicit.

### Weights are heuristics, not fitted parameters

All three weight vectors (Congestion 30/25/20/15/10, Unmet Demand
35/30/20/15, Expansion Opportunity 40/30/20/10) are **domain-judgment
heuristics, not statistically calibrated**. Calibration would require a
labeled historical dataset — airports that underwent terminal expansion,
paired with realized post-expansion traffic and returns — which does not
exist publicly at usable scale, and certainly not within a one-day build.
The weights are an explicit, auditable prior: they live in one named
constants file, are versioned, and are surfaced in every explanation
instead of being tuned invisibly.

Qualitative reasoning for the top-ranked signal in each score:

- **Congestion — `del15_rate` (30%) over `nas_delay_per_departure` (25%)
  over `avg_taxi_out_min` (20%).** `del15_rate` is the broadest observable
  symptom of strain and the least sensitive to any single bad month.
  `NAS_DELAY` is the *most causally specific* to airspace/airport volume,
  but it's a narrower, noisier BTS attribution field, so it ranks just below
  the broad symptom rather than above it. `avg_taxi_out_min` ranks third
  because it captures ground/taxiway congestion specifically — real, but a
  subset of overall strain and heavily airport-layout-dependent (a long taxi
  at DFW is geometry, not congestion).
- **Unmet Demand — `load_factor` (35%) over `nas_delay_per_departure`
  (20%).** Load factor is the most direct evidence that demand exceeded
  supplied seats — it's measured on the demand side and needs no causal
  attribution. NAS delay is only an *indirect* proxy for suppressed demand
  (capacity constraints discouraging schedule growth), so it carries
  roughly half the weight. `pax_growth_yoy` at 30% ranks second because a
  full airport that is also growing is where demand is still accumulating.
- **Expansion Opportunity — `congestion_score` (40%) over
  `unmet_demand_score` (30%).** Congestion leads because it's the condition
  renovation directly relieves — the closest thing in the data to "this
  facility is the binding constraint." Unmet demand follows as the
  size-of-the-prize term. `log10(passengers)` is deliberately smallest
  (10%) and log-scaled: absolute scale matters to an investor, but on a
  linear scale it would swamp every other signal and reduce the ranking to
  "biggest airports first."

**With more time / data:** calibrate against real historical expansion
outcomes (e.g. FAA AIP grant records paired with post-project enplanement
growth), turning these priors into fitted coefficients with confidence
intervals — letting us report *why* a weight is what it is empirically,
rather than defending it as judgment.

## Reasoning transparency (src/obs/)

`src/obs/trace.ts` records every tool call and result made during a turn
(`{ tool, args, result, timestamp }`), surfaced by the CLI on request (e.g.
`--trace` or a `/why` follow-up). This was an addition made independently
during implementation, not part of the originally approved folder
structure — flagged and recorded as ADR 0008. It directly serves the
assignment's "explain its reasoning clearly" requirement and doubles as
evidence, not just an assertion, of the LLM/deterministic split (ADR 0002):
a user can see exactly which deterministic tool call produced any number in
an answer.

## Cost awareness

Two cost/latency-relevant decisions, kept distinct from each other:

- **Prompt caching.** The system prompt and tool schemas (`systemPrompt.ts`,
  `tools.ts`) are stable across every turn within a session, so they are
  sent as cached prompt blocks (Anthropic prompt caching). This reduces
  latency and per-token cost on every turn after the first in a session.
  This is a **separate concern from rate limiting** — prompt caching does
  nothing to protect against hitting a requests/tokens-per-minute limit; a
  production deployment would still need its own semaphore/backoff/queuing
  in front of the Anthropic SDK calls. The two should not be conflated: this
  build addresses caching (cheap, in scope for a demo) and explicitly does
  not implement rate-limiting infrastructure (out of scope for a one-day,
  single-user CLI demo).
- **LLM bypass for `describe_methodology`.** The content this tool returns
  (a proxy KPI's formula, weights, and confounders) is static text already
  fully documented in `SPEC.md`/`weights.ts` — there is nothing for the LLM
  to compute or narrate beyond what's already written. When no additional
  narration is requested, this tool returns its formatted text directly to
  the user, skipping a full LLM synthesis round-trip. This saves a model
  call on a purely-static answer without weakening the LLM/deterministic
  split (the text still originates entirely from the deterministic
  constants file, never from the LLM).

## Where/how AI is used

_To be completed once the agent layer is implemented — will cover: tool
selection loop, natural-language synthesis of deterministic results,
session/follow-up handling, and the explicit LLM/deterministic boundary per
ADR._
