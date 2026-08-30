/**
 * src/agent/methodologyText.ts — pure formatter for describe_methodology's
 * deterministic payload (architecture.md "Cost awareness": this content is
 * static text already fully documented in SPEC.md/weights.ts, so
 * orchestrator.ts can return it directly without a full LLM synthesis
 * round-trip). The text still originates entirely from
 * src/scoring/weights.ts constants, never from the LLM (ADR 0002).
 */

import type { MethodologyPayload } from "./toolHandlers.js";

const KPI_LABELS: Record<string, string> = {
  congestion: "Congestion Score",
  unmet_demand: "Unmet Demand Score",
  expansion_opportunity: "Expansion Opportunity Score",
  spare_capacity: "Spare Capacity Score",
};

function formatWeights(weights: Record<string, number>): string {
  return Object.entries(weights)
    .map(([signal, weight]) => `  - ${signal}: ${Math.round(weight * 100)}%`)
    .join("\n");
}

export function formatMethodology(payload: MethodologyPayload): string {
  const sections = payload.entries.map((entry) => {
    const label = KPI_LABELS[entry.kpi] ?? entry.kpi;
    return `${label} (${entry.kpi})\n${formatWeights(entry.weights)}`;
  });

  const effective = Object.entries(payload.effectiveWeights)
    .map(([signal, weight]) => `  - ${signal}: ${(weight * 100).toFixed(1)}%`)
    .join("\n");

  return [
    sections.join("\n\n"),
    `\nEffective (compounded) contribution to Expansion Opportunity:\n${effective}`,
    `\nWeights version: ${payload.weightsVersion}`,
    `Minimum annual passengers to be ranked: ${payload.minAnnualPassengers.toLocaleString()}`,
    `\n${payload.caveat}`,
  ].join("\n");
}
