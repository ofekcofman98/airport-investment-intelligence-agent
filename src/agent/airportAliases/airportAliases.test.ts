import { describe, it, expect } from "vitest";
import { METRO_ALIASES, normalizeQuery } from "../airportAliases/airportAliases.js";
import { AIRPORT_REGISTRY } from "../../data/airportRegistry.js";

describe("normalizeQuery", () => {
  it("lowercases and trims", () => {
    expect(normalizeQuery("  NYC  ")).toBe("nyc");
  });

  it("collapses internal whitespace", () => {
    expect(normalizeQuery("Washington   DC")).toBe("washington dc");
  });

  it("strips periods so punctuation variants match the same key", () => {
    expect(normalizeQuery("D.C.")).toBe("dc");
    expect(normalizeQuery("L.A.")).toBe("la");
  });
});

describe("METRO_ALIASES", () => {
  const registryCodes = new Set(AIRPORT_REGISTRY.map((a) => a.code));

  it("every alias maps to at least one code", () => {
    for (const [query, codes] of Object.entries(METRO_ALIASES)) {
      expect(codes.length, `alias "${query}" has no codes`).toBeGreaterThan(0);
    }
  });

  // Drift guard: a future SPEC §1 universe edit that drops a code should
  // fail this test, not silently degrade an alias to a subset it never
  // meant to have.
  it("every alias target code exists in the current airport registry", () => {
    for (const [query, codes] of Object.entries(METRO_ALIASES)) {
      for (const code of codes) {
        expect(registryCodes.has(code), `alias "${query}" -> "${code}" not in AIRPORT_REGISTRY`).toBe(
          true
        );
      }
    }
  });

  it("resolves 'la' to LAX only, not Santa Ana", () => {
    expect(METRO_ALIASES["la"]).toEqual(["LAX"]);
  });

  it("resolves 'nyc' to all three New York-area airports", () => {
    expect(METRO_ALIASES["nyc"]).toEqual(["JFK", "LGA", "EWR"]);
  });

  it("resolves 'dc' to both DC-area airports", () => {
    expect(METRO_ALIASES["dc"]).toEqual(["DCA", "IAD"]);
  });
});
