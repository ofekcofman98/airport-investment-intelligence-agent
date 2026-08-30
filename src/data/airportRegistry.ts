/**
 * src/data/airportRegistry.ts — the fixed ~46-airport universe (SPEC §1,
 * ADR 0005). Source of truth for "in scope or not" and for the static
 * reference metadata (name/city/state/region/lat-lon) that BTS T-100 does
 * not carry.
 *
 * This is a hand-authored list, not derived from BTS. Top ~40 US airports
 * by 2025 enplanements, plus the forced-include list from SPEC §1
 * (example-question airports + New England completeness).
 */

import type { AirportRef, AirportCode, Region } from "./types.js";

export const AIRPORT_REGISTRY: AirportRef[] = [
  // --- Top enplanement tier ---
  { code: "ATL", name: "Hartsfield-Jackson Atlanta International", city: "Atlanta", state: "GA", region: "Southeast", lat: 33.6407, lon: -84.4277 },
  { code: "DFW", name: "Dallas/Fort Worth International", city: "Dallas-Fort Worth", state: "TX", region: "South Central", lat: 32.8998, lon: -97.0403 },
  { code: "DEN", name: "Denver International", city: "Denver", state: "CO", region: "Mountain", lat: 39.8561, lon: -104.6737 },
  { code: "ORD", name: "Chicago O'Hare International", city: "Chicago", state: "IL", region: "Midwest", lat: 41.9742, lon: -87.9073 },
  { code: "LAX", name: "Los Angeles International", city: "Los Angeles", state: "CA", region: "Pacific", lat: 33.9416, lon: -118.4085 },
  { code: "JFK", name: "John F. Kennedy International", city: "New York", state: "NY", region: "Mid-Atlantic", lat: 40.6413, lon: -73.7781 },
  { code: "LAS", name: "Harry Reid International", city: "Las Vegas", state: "NV", region: "Mountain", lat: 36.0840, lon: -115.1537 },
  { code: "MCO", name: "Orlando International", city: "Orlando", state: "FL", region: "Southeast", lat: 28.4312, lon: -81.3081 },
  { code: "MIA", name: "Miami International", city: "Miami", state: "FL", region: "Southeast", lat: 25.7959, lon: -80.2870 },
  { code: "CLT", name: "Charlotte Douglas International", city: "Charlotte", state: "NC", region: "Southeast", lat: 35.2144, lon: -80.9473 },
  { code: "SEA", name: "Seattle-Tacoma International", city: "Seattle", state: "WA", region: "Pacific", lat: 47.4502, lon: -122.3088 },
  { code: "EWR", name: "Newark Liberty International", city: "Newark", state: "NJ", region: "Mid-Atlantic", lat: 40.6895, lon: -74.1745 },
  { code: "PHX", name: "Phoenix Sky Harbor International", city: "Phoenix", state: "AZ", region: "Mountain", lat: 33.4373, lon: -112.0078 },
  { code: "SFO", name: "San Francisco International", city: "San Francisco", state: "CA", region: "Pacific", lat: 37.6213, lon: -122.3790 },
  { code: "IAH", name: "George Bush Intercontinental", city: "Houston", state: "TX", region: "South Central", lat: 29.9902, lon: -95.3368 },
  { code: "FLL", name: "Fort Lauderdale-Hollywood International", city: "Fort Lauderdale", state: "FL", region: "Southeast", lat: 26.0726, lon: -80.1527 },
  { code: "MCI", name: "Kansas City International", city: "Kansas City", state: "MO", region: "Midwest", lat: 39.2976, lon: -94.7139 },
  { code: "BOS", name: "Logan International", city: "Boston", state: "MA", region: "New England", lat: 42.3656, lon: -71.0096 },
  { code: "MSP", name: "Minneapolis-St. Paul International", city: "Minneapolis", state: "MN", region: "Midwest", lat: 44.8848, lon: -93.2223 },
  { code: "DTW", name: "Detroit Metropolitan Wayne County", city: "Detroit", state: "MI", region: "Midwest", lat: 42.2124, lon: -83.3534 },
  { code: "PHL", name: "Philadelphia International", city: "Philadelphia", state: "PA", region: "Mid-Atlantic", lat: 39.8744, lon: -75.2424 },
  { code: "LGA", name: "LaGuardia", city: "New York", state: "NY", region: "Mid-Atlantic", lat: 40.7769, lon: -73.8740 },
  { code: "SLC", name: "Salt Lake City International", city: "Salt Lake City", state: "UT", region: "Mountain", lat: 40.7899, lon: -111.9791 },
  { code: "DCA", name: "Ronald Reagan Washington National", city: "Washington", state: "DC", region: "Mid-Atlantic", lat: 38.8512, lon: -77.0402 },
  { code: "IAD", name: "Washington Dulles International", city: "Washington", state: "DC", region: "Mid-Atlantic", lat: 38.9531, lon: -77.4565 },
  { code: "BWI", name: "Baltimore/Washington International", city: "Baltimore", state: "MD", region: "Mid-Atlantic", lat: 39.1774, lon: -76.6684 },
  { code: "SAN", name: "San Diego International", city: "San Diego", state: "CA", region: "Pacific", lat: 32.7338, lon: -117.1933 },
  { code: "TPA", name: "Tampa International", city: "Tampa", state: "FL", region: "Southeast", lat: 27.9755, lon: -82.5332 },
  { code: "AUS", name: "Austin-Bergstrom International", city: "Austin", state: "TX", region: "South Central", lat: 30.1975, lon: -97.6664 },
  { code: "HNL", name: "Daniel K. Inouye International", city: "Honolulu", state: "HI", region: "Hawaii", lat: 21.3245, lon: -157.9251 },
  { code: "BNA", name: "Nashville International", city: "Nashville", state: "TN", region: "Southeast", lat: 36.1263, lon: -86.6774 },
  { code: "PDX", name: "Portland International", city: "Portland", state: "OR", region: "Pacific", lat: 45.5898, lon: -122.5951 },
  { code: "STL", name: "St. Louis Lambert International", city: "St. Louis", state: "MO", region: "Midwest", lat: 38.7487, lon: -90.3700 },
  { code: "RDU", name: "Raleigh-Durham International", city: "Raleigh-Durham", state: "NC", region: "Southeast", lat: 35.8801, lon: -78.7880 },
  { code: "HOU", name: "William P. Hobby", city: "Houston", state: "TX", region: "South Central", lat: 29.6454, lon: -95.2789 },
  { code: "SMF", name: "Sacramento International", city: "Sacramento", state: "CA", region: "Pacific", lat: 38.6954, lon: -121.5908 },
  { code: "MSY", name: "Louis Armstrong New Orleans International", city: "New Orleans", state: "LA", region: "South Central", lat: 29.9934, lon: -90.2580 },
  { code: "SJC", name: "San Jose International", city: "San Jose", state: "CA", region: "Pacific", lat: 37.3639, lon: -121.9289 },
  { code: "DAL", name: "Dallas Love Field", city: "Dallas", state: "TX", region: "South Central", lat: 32.8471, lon: -96.8518 },
  { code: "OAK", name: "Oakland International", city: "Oakland", state: "CA", region: "Pacific", lat: 37.7126, lon: -122.2197 },
  { code: "MDW", name: "Chicago Midway International", city: "Chicago", state: "IL", region: "Midwest", lat: 41.7868, lon: -87.7522 },

  // --- Forced-include: example-question airports (SPEC §1) ---
  { code: "SNA", name: "John Wayne (Santa Ana)", city: "Santa Ana", state: "CA", region: "Pacific", lat: 33.6757, lon: -117.8682 },
  { code: "ANC", name: "Ted Stevens Anchorage International", city: "Anchorage", state: "AK", region: "Alaska", lat: 61.1743, lon: -149.9962 },

  // --- Forced-include: New England completeness (SPEC §1) ---
  { code: "BDL", name: "Bradley International", city: "Windsor Locks", state: "CT", region: "New England", lat: 41.9389, lon: -72.6832 },
  { code: "PVD", name: "T.F. Green International", city: "Providence", state: "RI", region: "New England", lat: 41.7240, lon: -71.4283 },
  { code: "MHT", name: "Manchester-Boston Regional", city: "Manchester", state: "NH", region: "New England", lat: 42.9326, lon: -71.4357 },
  { code: "PWM", name: "Portland International Jetport", city: "Portland", state: "ME", region: "New England", lat: 43.6462, lon: -70.3093 },
  { code: "BTV", name: "Burlington International", city: "Burlington", state: "VT", region: "New England", lat: 44.4719, lon: -73.1533 },
];

const BY_CODE: Map<AirportCode, AirportRef> = new Map(
  AIRPORT_REGISTRY.map((a) => [a.code, a])
);

/** True if `code` is in the declared ~46-airport universe (SPEC §1, ADR 0005). */
export function isInScope(code: AirportCode): boolean {
  return BY_CODE.has(code.toUpperCase());
}

/** Reference metadata for one code, or null if out of scope. */
export function getAirportRef(code: AirportCode): AirportRef | null {
  return BY_CODE.get(code.toUpperCase()) ?? null;
}

/** Distinct regions actually present in the registry. */
export function listRegions(): Region[] {
  return [...new Set(AIRPORT_REGISTRY.map((a) => a.region))];
}
