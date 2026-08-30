/**
 * src/data/build.ts — one-time (or manually re-run) build step.
 *
 * Reads data/raw/ (BTS T-100 Segment CSVs for 2025 + 2024, and a March-2025
 * On-Time Performance sample), cleans + aggregates per
 * docs/architecture.md "Data quality & cleaning", scopes to the ~46-airport
 * universe (src/data/airportRegistry.ts), and writes data/processed/*.json
 * + manifest.json.
 *
 * Not part of the runtime path (src/data/CLAUDE.md) — snapshotDataSource.ts
 * is what the rest of the app reads.
 *
 * SOURCES AND WHAT EACH ONE PRODUCES:
 *   - T-100 Segment 2025 (full year): passengers, seats, departures,
 *     load_factor, schedule_adherence_gap, long_haul_share.
 *   - T-100 Segment 2024 (full year): prior-year passengers only, for
 *     pax_growth_yoy, folded directly into the same per-airport record.
 *   - On-Time Performance, March 2025 ONLY (single-month sample — see
 *     SPEC.md §2 "On-Time Performance sampling"): del15Rate,
 *     avgTaxiOutMin, nasDelayPerDeparture, weatherDelayPerDeparture,
 *     cancellationRate. This is a stated approximation, not a full-year
 *     measurement — reflected in dataCompleteness below and in the
 *     manifest, not just in prose.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { AIRPORT_REGISTRY } from "./airportRegistry.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..");
const RAW_DIR = join(ROOT, "data", "raw");
const PROCESSED_DIR = join(ROOT, "data", "processed");

const ANALYSIS_YEAR = 2025;
const PRIOR_YEAR = 2024;

const T100_2025_FILE = join(RAW_DIR, "T100_Segment_AllCarriers_2025.csv");
const T100_2024_FILE = join(RAW_DIR, "T100_Segment_AllCarriers_2024.csv");
const OTP_MARCH_FILE = join(
  RAW_DIR,
  "On_Time_Reporting_Carrier_On_Time_Performance_(1987_present)_2025_3.csv"
);
const OTP_SAMPLE_MONTH = "March 2025";

const LONG_HAUL_MIN_DISTANCE = 2500;
const MEDIUM_HAUL_MIN_DISTANCE = 1000;

// T-100 fields are full-year and measured directly: 0.5 completeness weight.
// On-Time fields are present but estimated from one sample month, not
// measured across the full year: also 0.5, so a record with every signal
// present (current state, once both sources exist) is 1.0, while a record
// missing the On-Time side entirely (as in the first build pass) is 0.5 —
// consistent with src/scoring/CLAUDE.md's renormalization design.
const T100_COMPLETENESS_WEIGHT = 0.5;
const OTP_SAMPLE_COMPLETENESS_WEIGHT = 0.5;

// --- minimal RFC4180 CSV line splitter (handles quoted fields with embedded commas) ---
function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += c;
      }
    } else {
      if (c === '"') {
        inQuotes = true;
      } else if (c === ",") {
        fields.push(cur);
        cur = "";
      } else {
        cur += c;
      }
    }
  }
  fields.push(cur);
  return fields;
}

function readLines(filePath: string): string[] {
  const raw = readFileSync(filePath, "utf-8");
  return raw.split(/\r?\n/).filter((l) => l.length > 0);
}

function headerIndex(header: string[], name: string, filePath: string): number {
  const i = header.indexOf(name);
  if (i === -1) throw new Error(`build.ts: expected column "${name}" not found in ${filePath}`);
  return i;
}

// ============================================================
// T-100 Segment: route-level -> airport-level (rules 1-5, see
// docs/architecture.md "Data quality & cleaning")
// ============================================================

interface T100Row {
  departuresScheduled: number;
  departuresPerformed: number;
  seats: number;
  passengers: number;
  distance: number;
  distanceRaw: string;
  origin: string;
  dest: string;
  month: string;
}

interface T100Agg {
  passengers: number;
  seats: number;
  departuresPerformed: number;
  departuresScheduled: number;
  departuresByBucket: { short: number; medium: number; long: number };
}

interface T100LoadResult {
  rows: T100Row[];
  malformedRowCount: number;
  badDistanceCount: number;
}

function loadT100(filePath: string): T100LoadResult {
  const lines = readLines(filePath);
  const header = parseCsvLine(lines[0] ?? "").map((h) => h.trim());

  const iSched = headerIndex(header, "DEPARTURES_SCHEDULED", filePath);
  const iPerf = headerIndex(header, "DEPARTURES_PERFORMED", filePath);
  const iSeats = headerIndex(header, "SEATS", filePath);
  const iPax = headerIndex(header, "PASSENGERS", filePath);
  const iDist = headerIndex(header, "DISTANCE", filePath);
  const iOrigin = headerIndex(header, "ORIGIN", filePath);
  const iDest = headerIndex(header, "DEST", filePath);
  const iMonth = headerIndex(header, "MONTH", filePath);
  const expectedCols = header.length;

  const rows: T100Row[] = [];
  let malformedRowCount = 0;
  let badDistanceCount = 0;

  for (let li = 1; li < lines.length; li++) {
    const f = parseCsvLine(lines[li] ?? "");
    if (f.length !== expectedCols) {
      malformedRowCount++;
      // Still attempt to use the row if the fields we need are in range;
      // skip only if we can't safely index into it.
      if (f.length <= Math.max(iSched, iPerf, iSeats, iPax, iDist, iOrigin, iDest, iMonth)) continue;
    }

    const distanceRaw = f[iDist] ?? "";
    const distance = Number(distanceRaw);
    const distanceValid = distanceRaw !== "" && !Number.isNaN(distance);
    if (!distanceValid) badDistanceCount++;

    rows.push({
      departuresScheduled: Number(f[iSched]) || 0,
      departuresPerformed: Number(f[iPerf]) || 0,
      seats: Number(f[iSeats]) || 0,
      passengers: Number(f[iPax]) || 0,
      distance: distanceValid ? distance : 0,
      distanceRaw,
      origin: (f[iOrigin] ?? "").trim().toUpperCase(),
      dest: (f[iDest] ?? "").trim().toUpperCase(),
      month: (f[iMonth] ?? "").trim(),
    });
  }

  return { rows, malformedRowCount, badDistanceCount };
}

/**
 * pax_growth_yoy compares annual sums across two files (SPEC.md §3
 * "Coverage-parity check"). Before trusting that comparison, verify both
 * years actually cover the same 12 months rather than assuming it — a
 * silent gap (e.g. the domestic/international uniform-cutoff trim, SPEC §1)
 * would otherwise bias growth without any visible symptom besides an
 * odd-looking number. Throws rather than silently proceeding if coverage
 * differs, since a biased pax_growth_yoy is worse than a failed build.
 */
function assertMonthCoverageParity(
  rows2025: T100Row[],
  rows2024: T100Row[],
  file2025: string,
  file2024: string
): void {
  const months2025 = new Set(rows2025.map((r) => r.month));
  const months2024 = new Set(rows2024.map((r) => r.month));
  const sorted = (s: Set<string>) => [...s].sort((a, b) => Number(a) - Number(b));

  const only2025 = [...months2025].filter((m) => !months2024.has(m));
  const only2024 = [...months2024].filter((m) => !months2025.has(m));

  console.log(`Month coverage — ${file2025}: [${sorted(months2025).join(", ")}] (${months2025.size} distinct)`);
  console.log(`Month coverage — ${file2024}: [${sorted(months2024).join(", ")}] (${months2024.size} distinct)`);

  if (only2025.length > 0 || only2024.length > 0) {
    throw new Error(
      `build.ts: month coverage mismatch between analysis and prior year — ` +
        `2025-only months [${only2025.join(", ")}], 2024-only months [${only2024.join(", ")}]. ` +
        `pax_growth_yoy would compare unequal periods. Fix the raw file coverage before re-running ` +
        `(see SPEC.md §3 "Coverage-parity check").`
    );
  }
}

/** Rules 1-4: drop never-operated / same-airport rows, sum, bucket by distance. */
function aggregateT100ByOrigin(rows: T100Row[]): Map<string, T100Agg> {
  const byOrigin = new Map<string, T100Agg>();

  for (const row of rows) {
    // Rule 1: drop never-operated segments.
    if (row.departuresPerformed === 0) continue;
    // Rule 2: drop same-airport ferry/positioning rows.
    if (row.origin === row.dest) continue;

    let agg = byOrigin.get(row.origin);
    if (!agg) {
      agg = {
        passengers: 0,
        seats: 0,
        departuresPerformed: 0,
        departuresScheduled: 0,
        departuresByBucket: { short: 0, medium: 0, long: 0 },
      };
      byOrigin.set(row.origin, agg);
    }

    // Rule 3: sum core volume fields.
    agg.passengers += row.passengers;
    agg.seats += row.seats;
    agg.departuresPerformed += row.departuresPerformed;
    agg.departuresScheduled += row.departuresScheduled;

    // Rule 4: bucket by distance, weight by departures performed.
    if (row.distance >= LONG_HAUL_MIN_DISTANCE) {
      agg.departuresByBucket.long += row.departuresPerformed;
    } else if (row.distance >= MEDIUM_HAUL_MIN_DISTANCE) {
      agg.departuresByBucket.medium += row.departuresPerformed;
    } else {
      agg.departuresByBucket.short += row.departuresPerformed;
    }
  }

  return byOrigin;
}

// ============================================================
// On-Time Performance: flight-level -> airport-level (March 2025 sample)
// ============================================================

interface OtpAgg {
  totalFlights: number; // all scheduled rows, including cancelled
  cancelledFlights: number;
  del15Count: number; // DepDel15 == 1
  del15Denominator: number; // non-cancelled flights with a valid DepDel15
  taxiOutSumMin: number;
  taxiOutDenominator: number;
  nasDelaySumMin: number;
  weatherDelaySumMin: number;
  delayDenominator: number; // non-cancelled departures, for per-departure rates
}

function loadOtpAggByOrigin(filePath: string): {
  byOrigin: Map<string, OtpAgg>;
  malformedRowCount: number;
} {
  const lines = readLines(filePath);
  const header = parseCsvLine(lines[0] ?? "").map((h) => h.trim());

  const iOrigin = headerIndex(header, "Origin", filePath);
  const iDepDel15 = headerIndex(header, "DepDel15", filePath);
  const iTaxiOut = headerIndex(header, "TaxiOut", filePath);
  const iCancelled = headerIndex(header, "Cancelled", filePath);
  const iNasDelay = headerIndex(header, "NASDelay", filePath);
  const iWeatherDelay = headerIndex(header, "WeatherDelay", filePath);
  const expectedCols = header.length;

  const byOrigin = new Map<string, OtpAgg>();
  let malformedRowCount = 0;

  for (let li = 1; li < lines.length; li++) {
    const f = parseCsvLine(lines[li] ?? "");
    if (f.length < expectedCols) {
      malformedRowCount++;
      if (f.length <= Math.max(iOrigin, iDepDel15, iTaxiOut, iCancelled, iNasDelay, iWeatherDelay)) {
        continue;
      }
    }

    const origin = (f[iOrigin] ?? "").trim().toUpperCase();
    if (!origin) continue;

    let agg = byOrigin.get(origin);
    if (!agg) {
      agg = {
        totalFlights: 0,
        cancelledFlights: 0,
        del15Count: 0,
        del15Denominator: 0,
        taxiOutSumMin: 0,
        taxiOutDenominator: 0,
        nasDelaySumMin: 0,
        weatherDelaySumMin: 0,
        delayDenominator: 0,
      };
      byOrigin.set(origin, agg);
    }

    agg.totalFlights += 1;

    const cancelled = Number(f[iCancelled]) === 1;
    if (cancelled) {
      agg.cancelledFlights += 1;
      continue; // a cancelled flight never departed: excluded from delay/taxi denominators
    }

    agg.delayDenominator += 1;

    const del15Raw = f[iDepDel15];
    if (del15Raw !== "" && del15Raw !== undefined) {
      agg.del15Denominator += 1;
      if (Number(del15Raw) === 1) agg.del15Count += 1;
    }

    const taxiOutRaw = f[iTaxiOut];
    if (taxiOutRaw !== "" && taxiOutRaw !== undefined && !Number.isNaN(Number(taxiOutRaw))) {
      agg.taxiOutSumMin += Number(taxiOutRaw);
      agg.taxiOutDenominator += 1;
    }

    const nasRaw = f[iNasDelay];
    agg.nasDelaySumMin += nasRaw && !Number.isNaN(Number(nasRaw)) ? Number(nasRaw) : 0;

    const weatherRaw = f[iWeatherDelay];
    agg.weatherDelaySumMin += weatherRaw && !Number.isNaN(Number(weatherRaw)) ? Number(weatherRaw) : 0;
  }

  return { byOrigin, malformedRowCount };
}

// ============================================================
// Merge into per-airport records
// ============================================================

interface YearMetricsRecord {
  code: string;
  year: number;
  passengers: number;
  seats: number;
  departuresScheduled: number;
  departuresPerformed: number;
  loadFactor: number;
  scheduleAdherenceGap: number;
  longHaulShare: number;
  del15Rate: number | null;
  avgTaxiOutMin: number | null;
  nasDelayPerDeparture: number | null;
  weatherDelayPerDeparture: number | null;
  cancellationRate: number | null;
  paxGrowthYoy: number | null;
  dataCompleteness: number;
}

function buildT100Metrics(code: string, agg: T100Agg, year: number) {
  const totalDepartures =
    agg.departuresByBucket.short + agg.departuresByBucket.medium + agg.departuresByBucket.long;

  return {
    code,
    year,
    passengers: agg.passengers,
    seats: agg.seats,
    departuresScheduled: agg.departuresScheduled,
    departuresPerformed: agg.departuresPerformed,
    loadFactor: agg.seats > 0 ? agg.passengers / agg.seats : 0,
    // Signed on purpose: DEPARTURES_PERFORMED can exceed DEPARTURES_SCHEDULED
    // (non-scheduled/charter/extra-section ops BTS still counts as
    // performed) — see SPEC.md §3 "Known T-100 quirk". Never clamped.
    scheduleAdherenceGap:
      agg.departuresScheduled > 0 ? 1 - agg.departuresPerformed / agg.departuresScheduled : 0,
    longHaulShare: totalDepartures > 0 ? agg.departuresByBucket.long / totalDepartures : 0,
  };
}

function buildOtpMetrics(agg: OtpAgg | undefined) {
  if (!agg) {
    return {
      del15Rate: null,
      avgTaxiOutMin: null,
      nasDelayPerDeparture: null,
      weatherDelayPerDeparture: null,
      cancellationRate: null,
    };
  }
  return {
    del15Rate: agg.del15Denominator > 0 ? agg.del15Count / agg.del15Denominator : null,
    avgTaxiOutMin: agg.taxiOutDenominator > 0 ? agg.taxiOutSumMin / agg.taxiOutDenominator : null,
    nasDelayPerDeparture: agg.delayDenominator > 0 ? agg.nasDelaySumMin / agg.delayDenominator : null,
    weatherDelayPerDeparture:
      agg.delayDenominator > 0 ? agg.weatherDelaySumMin / agg.delayDenominator : null,
    cancellationRate: agg.totalFlights > 0 ? agg.cancelledFlights / agg.totalFlights : null,
  };
}

function main() {
  for (const f of [T100_2025_FILE, T100_2024_FILE, OTP_MARCH_FILE]) {
    if (!existsSync(f)) {
      throw new Error(`build.ts: expected raw file not found at ${f}. See SPEC.md §2 — manual pull required, not synthetic data.`);
    }
  }

  console.log(`Reading ${T100_2025_FILE} ...`);
  const t100_2025_stat = statSync(T100_2025_FILE);
  const t100_2025 = loadT100(T100_2025_FILE);
  console.log(
    `  ${t100_2025.rows.length} rows parsed; ${t100_2025.malformedRowCount} malformed (column-count mismatch); ${t100_2025.badDistanceCount} with missing/non-numeric DISTANCE.`
  );

  console.log(`Reading ${T100_2024_FILE} ...`);
  const t100_2024_stat = statSync(T100_2024_FILE);
  const t100_2024 = loadT100(T100_2024_FILE);
  console.log(
    `  ${t100_2024.rows.length} rows parsed; ${t100_2024.malformedRowCount} malformed (column-count mismatch); ${t100_2024.badDistanceCount} with missing/non-numeric DISTANCE.`
  );

  console.log(`Reading ${OTP_MARCH_FILE} ...`);
  const otpStat = statSync(OTP_MARCH_FILE);
  const otp = loadOtpAggByOrigin(OTP_MARCH_FILE);
  console.log(
    `  On-Time rows parsed for ${otp.byOrigin.size} origin airports; ${otp.malformedRowCount} malformed (column-count mismatch).`
  );

  assertMonthCoverageParity(t100_2025.rows, t100_2024.rows, T100_2025_FILE, T100_2024_FILE);

  const aggT100_2025 = aggregateT100ByOrigin(t100_2025.rows);
  const aggT100_2024 = aggregateT100ByOrigin(t100_2024.rows);
  console.log(`Aggregated 2025 T-100 to ${aggT100_2025.size} origin airports (pre-scope-filter).`);
  console.log(`Aggregated 2024 T-100 to ${aggT100_2024.size} origin airports (pre-scope-filter).`);

  const inScopeCodes = new Set(AIRPORT_REGISTRY.map((a) => a.code));
  const results: YearMetricsRecord[] = [];
  const missingT100_2025: string[] = [];
  const missingT100_2024: string[] = [];
  const missingOtp: string[] = [];

  for (const code of inScopeCodes) {
    const agg2025 = aggT100_2025.get(code);
    if (!agg2025) {
      missingT100_2025.push(code);
      continue;
    }

    const t100Metrics = buildT100Metrics(code, agg2025, ANALYSIS_YEAR);
    const otpAgg = otp.byOrigin.get(code);
    if (!otpAgg) missingOtp.push(code);
    const otpMetrics = buildOtpMetrics(otpAgg);

    const completeness =
      T100_COMPLETENESS_WEIGHT + (otpAgg ? OTP_SAMPLE_COMPLETENESS_WEIGHT : 0);

    const agg2024 = aggT100_2024.get(code);
    let paxGrowthYoy: number | null = null;
    if (!agg2024 || agg2024.passengers === 0) {
      missingT100_2024.push(code);
    } else {
      paxGrowthYoy = agg2025.passengers / agg2024.passengers - 1;
    }

    results.push({
      ...t100Metrics,
      ...otpMetrics,
      paxGrowthYoy,
      dataCompleteness: completeness,
    });
  }

  if (missingT100_2025.length > 0) {
    console.warn(`WARNING: ${missingT100_2025.length} in-scope airport(s) missing from 2025 T-100: ${missingT100_2025.join(", ")}`);
  }
  if (missingT100_2024.length > 0) {
    console.warn(`WARNING: ${missingT100_2024.length} in-scope airport(s) missing from 2024 T-100 (no pax_growth_yoy): ${missingT100_2024.join(", ")}`);
  }
  if (missingOtp.length > 0) {
    console.warn(`WARNING: ${missingOtp.length} in-scope airport(s) missing from March-2025 On-Time sample: ${missingOtp.join(", ")}`);
  }

  mkdirSync(PROCESSED_DIR, { recursive: true });

  for (const rec of results) {
    writeFileSync(
      join(PROCESSED_DIR, `${rec.code}.${ANALYSIS_YEAR}.json`),
      JSON.stringify(rec, null, 2) + "\n"
    );
  }

  const manifest = {
    builtAt: new Date().toISOString(),
    sources: [
      {
        name: "BTS TranStats T-100 Segment (All Carriers), full year 2025",
        url: "https://www.transtats.bts.gov/DL_SelectFields.aspx?gnoyr_VQ=FMF",
        downloadedAt: new Date(t100_2025_stat.mtime).toISOString(),
        btsRevisionStamp: null as string | null,
      },
      {
        name: "BTS TranStats T-100 Segment (All Carriers), full year 2024 (prior-year growth basis)",
        url: "https://www.transtats.bts.gov/DL_SelectFields.aspx?gnoyr_VQ=FMF",
        downloadedAt: new Date(t100_2024_stat.mtime).toISOString(),
        btsRevisionStamp: null as string | null,
      },
      {
        name: "BTS TranStats On-Time Performance, single-month sample (March 2025)",
        url: "https://www.transtats.bts.gov/DL_SelectFields.aspx?gnoyr_VQ=FGJ",
        downloadedAt: new Date(otpStat.mtime).toISOString(),
        btsRevisionStamp: null as string | null,
      },
    ],
    analysisYear: ANALYSIS_YEAR,
    priorYear: PRIOR_YEAR,
    airportCount: results.length,
    onTimeSampleMonth: OTP_SAMPLE_MONTH,
    dataQualityNotes: [
      "Combined domestic+international T-100 release trims the last few months " +
        "of pure-domestic data to keep a uniform end date across sources (SPEC.md §1). " +
        "Verify full-year 2025 totals are not silently undercounting a recent quarter.",
      `Delay-derived metrics (del15Rate, avgTaxiOutMin, nasDelayPerDeparture, ` +
        `weatherDelayPerDeparture, cancellationRate) are estimated from a single ` +
        `representative month (${OTP_SAMPLE_MONTH}), not measured across the full year ` +
        `(SPEC.md §2 "On-Time Performance sampling"). dataCompleteness reflects this: ` +
        `${T100_COMPLETENESS_WEIGHT} for full-year T-100 fields + ${OTP_SAMPLE_COMPLETENESS_WEIGHT} ` +
        `for the sampled On-Time fields, so a fully-present record is ${T100_COMPLETENESS_WEIGHT + OTP_SAMPLE_COMPLETENESS_WEIGHT}, not 1.0.`,
      "scheduleAdherenceGap can be negative (DEPARTURES_PERFORMED > DEPARTURES_SCHEDULED " +
        "for some airports) — a known T-100 quirk, not an error; left signed, not clamped " +
        "(SPEC.md §3).",
      `Row-parse robustness: 2025 T-100 had ${t100_2025.malformedRowCount} malformed rows ` +
        `(column-count mismatch) and ${t100_2025.badDistanceCount} rows with missing/non-numeric ` +
        `DISTANCE; 2024 T-100 had ${t100_2024.malformedRowCount} malformed and ${t100_2024.badDistanceCount} ` +
        `bad-DISTANCE rows; On-Time sample had ${otp.malformedRowCount} malformed rows. ` +
        "Malformed rows were skipped when unsafe to index into; bad-DISTANCE rows were bucketed as short-haul (distance treated as 0).",
    ],
  };

  writeFileSync(join(PROCESSED_DIR, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

  console.log(`Wrote ${results.length} per-airport files + manifest.json to ${PROCESSED_DIR}`);
}

main();
