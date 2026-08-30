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

**Mitigation implemented, not just documented:** the scoring module exports
`effectiveRawWeights()`, a pure function that multiplies the composition
through and reports each raw signal's *total* compounded contribution to
Expansion Opportunity:

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
test (all compounded weights sum to 1.0), so the real influence of every
signal is a stated number, not a reader's mental arithmetic.

**With more time:** a sensitivity analysis — perturb each raw signal ±10%
and measure rank churn in the top-10 — would empirically quantify which
signals actually drive the ranking versus which are decorative, and would
be the basis for either pruning a signal or restructuring the composition
to remove the overlap.

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

## Where/how AI is used

_To be completed once the agent layer is implemented — will cover: tool
selection loop, natural-language synthesis of deterministic results,
session/follow-up handling, and the explicit LLM/deterministic boundary per
ADR._
