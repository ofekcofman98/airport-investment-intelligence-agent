/**
 * src/agent/toolHandlers/roundResult.ts — rounding at the tool boundary
 * (decision 3): structure unchanged, so the KPI audit layer
 * (narrationAudit.ts) compares narration against the same precision the LLM
 * was shown.
 */

import type { ScoreResult } from "../../scoring/types.js";

export function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

export function roundScoreResult(result: ScoreResult): ScoreResult {
  return {
    ...result,
    score: round(result.score, 1),
    confidence: round(result.confidence, 2),
    breakdown: result.breakdown.map((entry) => ({
      ...entry,
      normalized: round(entry.normalized, 1),
      contribution: round(entry.contribution, 1),
    })),
  };
}
