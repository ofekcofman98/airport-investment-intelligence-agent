import { describe, it, expect } from "vitest";
import { auditNarration, templatedAnswer } from "./narrationAudit.js";

describe("narrationAudit", () => {
  it("passes narration that quotes an exact tool value", () => {
    const result = auditNarration("The score is 63.8.", [{ score: 63.8 }]);
    expect(result.ok).toBe(true);
  });

  it("passes narration within the ±0.5 tolerance", () => {
    const result = auditNarration("The score is 63.9.", [{ score: 63.6 }]);
    expect(result.ok).toBe(true);
  });

  it("fails narration outside the ±0.5 tolerance", () => {
    const result = auditNarration("The score is 70.0.", [{ score: 63.6 }]);
    expect(result.ok).toBe(false);
    expect(result.mismatches).toContain(70);
  });

  it("ignores a bare year and passes trivially with no tool results", () => {
    expect(auditNarration("This is the 2025 analysis year.", [{ score: 63.6 }]).ok).toBe(true);
    expect(auditNarration("Anything at all, 12345.", []).ok).toBe(true);
  });

  it("passes a required caveat's numbers even though they live inside a string field", () => {
    const caveat =
      'This score is relative to the ~400 major US airports in our dataset. ' +
      'A score of 90 means "near the top of this set".';
    const result = auditNarration(
      `PWM scores 66.8. ${caveat}`,
      [{ score: 66.8, normalization: { caveat } }]
    );
    expect(result.ok).toBe(true);
  });

  it("matches a thousands-separated count against the unformatted truth value", () => {
    const result = auditNarration(
      "MHT was excluded with 686,314 passengers.",
      [{ code: "MHT", passengers: 686314 }]
    );
    expect(result.ok).toBe(true);
  });

  it("matches a percent-form claim against a raw fraction", () => {
    const result = auditNarration(
      "PWM grew 5.3% year over year.",
      [{ paxGrowthYoy: 0.0532 }]
    );
    expect(result.ok).toBe(true);
  });

  it("matches a rounded large count within 1% relative tolerance", () => {
    const result = auditNarration(
      "MHT had roughly 690,000 passengers.",
      [{ passengers: 686314 }]
    );
    expect(result.ok).toBe(true);
  });

  it("still fails a large-magnitude claim outside 1% relative tolerance", () => {
    const result = auditNarration(
      "MHT had roughly 750,000 passengers.",
      [{ passengers: 686314 }]
    );
    expect(result.ok).toBe(false);
  });

  it("does not misread a hyphenated range as a negative number", () => {
    // Regression: "~25-29" for load factor (DCA 29.4, BWI 25.0) was
    // previously parsed as "25" then the negative number "-29", which
    // matches nothing in the truth set. docs/fixes/fixes.md.
    const result = auditNarration(
      "DCA and BWI both run lower (~25-29).",
      [{ dca: 29.4 }, { bwi: 25.0 }]
    );
    expect(result.ok).toBe(true);
  });

  it("still catches a genuine negative-number mismatch (not glued to a preceding digit)", () => {
    // truth is 0.6 (60%), not 0.03, so this isn't just the existing
    // percent<->fraction check finding an incidental match.
    const result = auditNarration("Growth was -12.0% year over year.", [{ paxGrowthYoy: 0.6 }]);
    expect(result.ok).toBe(false);
  });

  it("treats a bare 0 or 100 as scale language, not a claimed figure", () => {
    const result = auditNarration(
      "Scores run on a 0-100 scale; DCA is 62.1.",
      [{ score: 62.1 }]
    );
    expect(result.ok).toBe(true);
  });

  it("templatedAnswer with no tool results says it could not verify", () => {
    expect(templatedAnswer([])).toMatch(/unable to produce/i);
  });
});
