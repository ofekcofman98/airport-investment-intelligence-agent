import { describe, it, expect } from "vitest";
import { buildSystemPrompt } from "../systemPrompt/systemPrompt.js";

describe("buildSystemPrompt", () => {
  const prompt = buildSystemPrompt(48, 2025);

  it("interpolates the given count and year rather than hardcoding 46/2025", () => {
    expect(prompt).toContain("48");
    expect(prompt).toContain("2025");

    const other = buildSystemPrompt(46, 2030);
    expect(other).toContain("46");
    expect(other).toContain("2030");
    expect(other).not.toContain("48");
  });

  it("states the never-invent-a-number rule (ADR 0002)", () => {
    expect(prompt).toMatch(/never (compute|invent)/i);
  });

  it("states the SPEC §4a caveat-surfacing rule", () => {
    expect(prompt).toMatch(/caveat/i);
    expect(prompt).toMatch(/normalization/i);
  });

  it("states the SPEC §1 excluded-airports rule", () => {
    expect(prompt).toMatch(/excluded/i);
    expect(prompt).toMatch(/below_min_volume/);
  });

  it("states every SPEC §5 refusal case", () => {
    expect(prompt).toMatch(/outside the.*universe/i);
    expect(prompt).toMatch(/year other than/i);
    expect(prompt).toMatch(/roi|valuation/i);
    expect(prompt).toMatch(/gate, runway, or slot/i);
  });

  it("gives tool-selection guidance for resolve_airports and describe_methodology", () => {
    expect(prompt).toMatch(/resolve_airports/);
    expect(prompt).toMatch(/describe_methodology/);
  });
});
