/**
 * src/agent/narrationAudit/narrationAudit.ts — the KPI audit layer
 * (src/agent/CLAUDE.md "Required follow-ups") — defense in depth on top of
 * ADR 0002: catches the LLM misquoting/mis-rounding a number a tool already
 * returned correctly, distinct from the LLM computing a number itself
 * (already prevented structurally).
 */

const AUDIT_TOLERANCE = 0.5;

/** A bare 4-digit integer in this range is treated as a stated year
 * (e.g. "2025", "2024"), not a claimed metric — narrations legitimately
 * restate the analysis year with no tool number to match it against. */
function looksLikeYear(n: number): boolean {
  return Number.isInteger(n) && n >= 1900 && n <= 2100;
}

/** Every normalized score/confidence value in this system is fixed to the
 * 0-100 (or 0-1) scale by construction (src/scoring/), so a bare 0 or 100 in
 * narration is routinely scale language ("a 0-100 scale", "confidence of
 * 1.0" narrated as "100%") rather than a specific claimed figure — exempted
 * the same way looksLikeYear exempts a stated analysis year. */
function looksLikeScaleBound(n: number): boolean {
  return n === 0 || n === 100;
}

// Shared between claim-side and truth-side extraction so the two can never
// drift apart (e.g. one normalizing thousands separators and the other not).
// The negative lookbehind keeps a hyphenated range ("25-29") from being
// misread as "25" followed by the negative number "-29" — a real narration
// bug hit in practice (docs/fixes/fixes.md) since a genuine negative number
// is never written glued to a preceding digit with no separator.
const NUMBER_PATTERN = /(?<!\d)-?\d+(?:\.\d+)?/g;

/** A claim as stated in the narration: the numeric value plus whether it was
 * written with a trailing `%` (matters for the fraction<->percent check
 * below — `"5.3%"` and `"0.053"` are the same claim, `"5.3"` alone is not). */
interface Claim {
  value: number;
  isPercent: boolean;
}

function extractNumbers(text: string): Claim[] {
  // Strip thousands separators ("686,314" -> "686314") before matching, so
  // a large count isn't misread as two smaller numbers.
  const normalized = text.replace(/(\d),(?=\d{3}\b)/g, "$1");
  const matches = normalized.matchAll(NUMBER_PATTERN);
  const claims: Claim[] = [];
  for (const m of matches) {
    const value = Number(m[0]);
    if (looksLikeYear(value) || looksLikeScaleBound(value)) continue;
    const isPercent = normalized[m.index + m[0].length] === "%";
    claims.push({ value, isPercent });
  }
  return claims;
}

/** Large-magnitude truth values (e.g. passenger counts) tolerate a relative
 * match — ±0.5 absolute is right for a 0-100 score but unusably tight for a
 * count in the hundreds of thousands, where an honest narration rounds
 * ("roughly 690,000" for 686,314). Kept out of AUDIT_TOLERANCE's range so
 * scores stay governed by the strict absolute check. */
const RELATIVE_TOLERANCE_MIN_MAGNITUDE = 10_000;
const RELATIVE_TOLERANCE = 0.01;

function matchesTruth(claim: number, truth: number): boolean {
  if (Math.abs(truth - claim) <= AUDIT_TOLERANCE) return true;
  if (Math.abs(truth) >= RELATIVE_TOLERANCE_MIN_MAGNITUDE) {
    return Math.abs(truth - claim) <= Math.abs(truth) * RELATIVE_TOLERANCE;
  }
  return false;
}

function extractNumbersFromResults(results: readonly unknown[]): number[] {
  const nums: number[] = [];
  const visit = (value: unknown): void => {
    if (typeof value === "number" && Number.isFinite(value)) {
      nums.push(value);
    } else if (typeof value === "string") {
      // Required narration content (SPEC §4a caveat, disclosed confounders)
      // is delivered to the LLM as strings embedded in tool results — those
      // numbers are just as much "truth" as a bare numeric field.
      for (const m of value.matchAll(NUMBER_PATTERN)) {
        const n = Number(m[0]);
        if (!looksLikeYear(n)) nums.push(n);
      }
    } else if (Array.isArray(value)) {
      value.forEach(visit);
    } else if (value !== null && typeof value === "object") {
      Object.values(value).forEach(visit);
    }
  };
  results.forEach(visit);
  return nums;
}

export interface AuditResult {
  ok: boolean;
  mismatches: number[];
}

/**
 * Extracts every number claimed in `text` and requires each to match some
 * number appearing in this turn's tool results within AUDIT_TOLERANCE (or,
 * for large magnitudes, RELATIVE_TOLERANCE — see matchesTruth). A claim
 * written as "N%" also passes if N/100 matches a truth value, since a tool
 * result's fraction (0.053) is routinely narrated as a percentage (5.3%).
 * With no tool results to check against (a purely conversational turn, or
 * a refusal with no numeric content), there is nothing to audit — passes
 * trivially rather than flagging incidental numbers as mismatches.
 */
export function auditNarration(text: string, toolResults: readonly unknown[]): AuditResult {
  if (toolResults.length === 0) return { ok: true, mismatches: [] };

  const truth = extractNumbersFromResults(toolResults);
  if (truth.length === 0) return { ok: true, mismatches: [] };

  const claimed = extractNumbers(text);
  const mismatches = claimed
    .filter((c) => {
      if (truth.some((t) => matchesTruth(c.value, t))) return false;
      if (c.isPercent && truth.some((t) => matchesTruth(c.value / 100, t))) return false;
      return true;
    })
    .map((c) => c.value);
  return { ok: mismatches.length === 0, mismatches };
}

/** Correct-by-construction fallback when the LLM can't produce narration
 * that survives the audit even after one retry — built directly from the
 * tool's exact values, deliberately blunt rather than wrong. */
export function templatedAnswer(toolResults: readonly unknown[]): string {
  if (toolResults.length === 0) {
    return "I was unable to produce a verified answer for this question.";
  }
  return (
    "I couldn't verify my narration against the exact tool results, so " +
    "here are those results directly:\n\n" +
    toolResults.map((r) => JSON.stringify(r, null, 2)).join("\n\n")
  );
}
