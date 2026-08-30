/**
 * src/data/ — shared types and the AirportDataSource interface.
 *
 * This is the ONLY shape the rest of the app (scoring, agent, interface)
 * is allowed to depend on. No other layer should import from
 * snapshotDataSource.ts, build.ts, or reach into data/processed/ directly.
 * See src/data/CLAUDE.md.
 */

/** IATA airport code, e.g. "SFO". Always uppercase, 3 letters. */
export type AirportCode = string;

export type Region =
  | "New England"
  | "Mid-Atlantic"
  | "Southeast"
  | "Midwest"
  | "South Central"
  | "Mountain"
  | "Pacific"
  | "Alaska"
  | "Hawaii";

/** Static reference metadata — hand-authored, not derived from BTS. */
export interface AirportRef {
  code: AirportCode;
  name: string;
  city: string;
  state: string; // USPS 2-letter code
  region: Region;
  lat: number;
  lon: number;
}

/** One calendar year of raw, measured metrics for one airport (SPEC §3). */
export interface AirportYearMetrics {
  code: AirportCode;
  year: number;
  passengers: number;
  seats: number;
  departuresScheduled: number;
  departuresPerformed: number;
  loadFactor: number; // passengers / seats
  scheduleAdherenceGap: number; // 1 - departuresPerformed / departuresScheduled
  /**
   * del15Rate, avgTaxiOutMin, nasDelayPerDeparture, weatherDelayPerDeparture,
   * and cancellationRate are all On-Time-Performance-derived and nullable:
   * null means the build step had no On-Time sample for this airport (a
   * missing component per src/scoring/CLAUDE.md "Missing-component
   * renormalization" — dropped and renormalized, never scored as 0).
   */
  del15Rate: number | null; // share of departures delayed >= 15 min
  avgTaxiOutMin: number | null;
  nasDelayPerDeparture: number | null;
  weatherDelayPerDeparture: number | null; // confounder control, not a scoring input
  cancellationRate: number | null;
  longHaulShare: number; // departures with distance >= 2500mi / total
  /**
   * passengers(year) / passengers(year-1) - 1. Requires the prior year's
   * T-100 file at build time (see src/data/build.ts); null if that file
   * was unavailable or reported zero passengers for this airport. Folded
   * directly into this record rather than a separate growth type/call —
   * the on-disk snapshot already merges it per-airport (see
   * data/processed/{CODE}.{year}.json), so a separate abstraction here
   * would be a distinction the data itself doesn't make.
   */
  paxGrowthYoy: number | null;
  /**
   * Data completeness signal carried from the build step (e.g. a month of
   * On-Time records missing for this airport). Consumed by scoring to set
   * `confidence` — never causes a crash on its own. See
   * src/scoring/CLAUDE.md "Error handling".
   */
  dataCompleteness: number; // 0-1
}

export interface SnapshotManifest {
  builtAt: string; // ISO timestamp of the build run
  sources: {
    name: string;
    url: string;
    downloadedAt: string; // ISO timestamp
    btsRevisionStamp: string | null; // as published by BTS, if available
  }[];
  analysisYear: number;
  priorYear: number;
  airportCount: number;
}

/**
 * The single interface every other layer depends on. Today's only
 * implementation reads the static snapshot (snapshotDataSource.ts, per
 * ADR 0004). A future implementation (different API, a cache layer) is a
 * new file implementing this same interface.
 */
export interface AirportDataSource {
  /** All airports in the declared universe (SPEC §1, ADR 0005). */
  listAirports(): AirportRef[];

  /** Reference metadata for one code, or null if out of scope. */
  getAirportRef(code: AirportCode): AirportRef | null;

  /**
   * Measured metrics for one code/year, or null if unavailable. Includes
   * `paxGrowthYoy` directly (see AirportYearMetrics) — there is no separate
   * growth lookup.
   */
  getYearMetrics(code: AirportCode, year: number): AirportYearMetrics | null;

  /** Provenance/versioning info for the loaded snapshot. */
  getManifest(): SnapshotManifest;
}
