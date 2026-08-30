/**
 * src/agent/toolHandlers/disclosedNotes.ts — disclosed notes (SPEC §2, §3,
 * §4) attached to the payloads that carry the facts they describe, per
 * decision 5 (root CLAUDE.md "Independent decisions"): systemPrompt.ts
 * states the rule that these must be surfaced; the note text itself lives
 * here, next to the data it's about.
 */

import type { AirportCode, AirportYearMetrics } from "../../data/types.js";

/** SPEC §2 — del15Rate/avgTaxiOutMin/nasDelayPerDeparture/cancellationRate
 * are estimated from a single representative month, not measured year-round. */
export const SAMPLE_MONTH_NOTE =
  "Delay and cancellation figures (del15_rate, avg_taxi_out_min, " +
  "nas_delay_per_departure, cancellation_rate) are estimated from a single " +
  "representative month — March 2025 — not measured across the full year.";

/** SPEC §4 — NAS_DELAY is the best available volume signal, but delay
 * minutes also reflect weather, carrier ops, and upstream late aircraft. */
export const WEATHER_CONFOUNDER_NOTE =
  "Delay minutes also reflect weather, carrier operations, and upstream " +
  "late aircraft, not congestion alone; weather_delay_per_departure is " +
  "reported alongside this score so an analyst can discount weather-driven " +
  "airports.";

/** SPEC §3 — a negative schedule_adherence_gap is a known T-100 quirk
 * (non-scheduled/charter operations counted as performed), not a data error. */
export const NEGATIVE_GAP_NOTE =
  "This airport's schedule_adherence_gap is negative: departures_performed " +
  "exceeded departures_scheduled, likely due to non-scheduled (charter, " +
  "extra-section) operations BTS counts as performed. This is not a data " +
  "error and can indicate an airport adding capacity beyond its published " +
  "schedule, rather than under-delivering on it.";

/**
 * Hand-authored, not derived: the snapshot has only a single-month On-Time
 * sample (see SAMPLE_MONTH_NOTE), so there is no data-driven seasonality
 * measure to test against. This list flags airports with well-known strong
 * seasonal/weather traffic variation for extra emphasis on top of the
 * universal SAMPLE_MONTH_NOTE. If the snapshot ever gains multi-month
 * On-Time data, replace this with a computed measure instead of extending
 * it by hand.
 */
export const HIGH_SEASONALITY_CODES: ReadonlySet<AirportCode> = new Set([
  "ANC", // SPEC §2 named example: strong seasonal/weather traffic variation
  "HNL",
  "BTV",
  "PWM",
]);

export function highSeasonalityNote(code: AirportCode): string {
  return (
    `${code} has strong seasonal traffic variation; a one-month sample is ` +
    `a weaker proxy for its typical congestion/delay levels than for a ` +
    `less seasonal airport.`
  );
}

export function weatherNoteFor(m: AirportYearMetrics): string {
  return m.weatherDelayPerDeparture === null
    ? WEATHER_CONFOUNDER_NOTE + " (No weather-delay figure is available for this airport.)"
    : `${WEATHER_CONFOUNDER_NOTE} This airport's weather_delay_per_departure is ${m.weatherDelayPerDeparture} minutes.`;
}

export function notesFor(m: AirportYearMetrics): string[] {
  const notes = [SAMPLE_MONTH_NOTE];
  if (m.scheduleAdherenceGap < 0) notes.push(NEGATIVE_GAP_NOTE);
  if (HIGH_SEASONALITY_CODES.has(m.code)) notes.push(highSeasonalityNote(m.code));
  return notes;
}
