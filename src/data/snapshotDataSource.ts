/**
 * src/data/snapshotDataSource.ts — the runtime AirportDataSource
 * implementation (ADR 0004: static snapshot, not live).
 *
 * Reads only from data/processed/ (never data/raw/ — that's build.ts's
 * job). Loaded once, held in memory; no per-call file I/O.
 */

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  AirportCode,
  AirportRef,
  AirportYearMetrics,
  SnapshotManifest,
  AirportDataSource,
} from "./types.js";
import { AIRPORT_REGISTRY, getAirportRef as lookupRef } from "./airportRegistry.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_PROCESSED_DIR = join(__dirname, "..", "..", "data", "processed");

function loadManifest(processedDir: string): SnapshotManifest {
  const manifestPath = join(processedDir, "manifest.json");
  if (!existsSync(manifestPath)) {
    throw new Error(
      `snapshotDataSource: manifest.json not found at ${manifestPath}. Run \`npm run build:data\` first.`
    );
  }
  return JSON.parse(readFileSync(manifestPath, "utf-8")) as SnapshotManifest;
}

function loadYearMetrics(
  processedDir: string,
  code: AirportCode,
  year: number
): AirportYearMetrics | null {
  const filePath = join(processedDir, `${code}.${year}.json`);
  if (!existsSync(filePath)) return null;
  return JSON.parse(readFileSync(filePath, "utf-8")) as AirportYearMetrics;
}

/**
 * Creates an AirportDataSource backed by data/processed/. Everything is
 * read eagerly at construction so a bad snapshot fails fast at startup,
 * not on the first user query.
 */
export function createSnapshotDataSource(
  processedDir: string = DEFAULT_PROCESSED_DIR
): AirportDataSource {
  const manifest = loadManifest(processedDir);

  // Eagerly load every in-scope airport's analysis-year metrics so a bad
  // or missing per-airport file surfaces at startup, not mid-conversation.
  const metricsByCode = new Map<AirportCode, AirportYearMetrics>();
  const missing: AirportCode[] = [];
  for (const ref of AIRPORT_REGISTRY) {
    const metrics = loadYearMetrics(processedDir, ref.code, manifest.analysisYear);
    if (metrics) {
      metricsByCode.set(ref.code, metrics);
    } else {
      missing.push(ref.code);
    }
  }
  if (missing.length > 0) {
    // Not fatal: an in-scope airport can be legitimately absent from the raw
    // BTS extract (e.g. no service that year). Surfaced so it's visible at
    // startup rather than discovered as a silent null deep in a scoring call.
    console.warn(
      `snapshotDataSource: ${missing.length} in-scope airport(s) have no ${manifest.analysisYear} metrics file: ${missing.join(", ")}`
    );
  }

  return {
    listAirports(): AirportRef[] {
      return AIRPORT_REGISTRY;
    },

    getAirportRef(code: AirportCode): AirportRef | null {
      return lookupRef(code);
    },

    getYearMetrics(code: AirportCode, year: number): AirportYearMetrics | null {
      const upper = code.toUpperCase();
      if (year === manifest.analysisYear) {
        return metricsByCode.get(upper) ?? null;
      }
      // Any other year (e.g. the prior year used only for pax_growth_yoy at
      // build time) is not retained as a standalone queryable record —
      // build.ts already folded that comparison into paxGrowthYoy on the
      // analysis-year record. See SPEC.md §1 refusal case: "years outside
      // 2024-2025" — 2024 itself is intentionally not independently queryable.
      return null;
    },

    getManifest(): SnapshotManifest {
      return manifest;
    },
  };
}
