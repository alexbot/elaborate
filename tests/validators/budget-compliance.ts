/**
 * budget-compliance: Per-phase prompt counts within documented caps.
 *
 * Counts user-facing prompt entries (type: "prompt", identified by string values)
 * per phase, compares against the budget targets from interview-prompt-budgets.
 */

import type { ValidatorInput, ValidatorResult } from "./types.js";

const PHASE_BUDGET: Record<string, number> = {
  opening: 3,
  purpose: 3,
  goals: 6,
  stakeholders: 13,
  scope: 5,
  assumptions: 4,
  validation: 1,
};

function phaseOf(id: string): string | undefined {
  if (id.startsWith("opening-")) return "opening";
  if (id.startsWith("purpose-")) return "purpose";
  if (id.startsWith("goal-") || id.startsWith("goals-")) return "goals";
  if (id.startsWith("stakeholder-") || id.startsWith("stakeholders-")) return "stakeholders";
  if (id.startsWith("scope-")) return "scope";
  if (id.startsWith("assumption-") || id.startsWith("assumptions-")) return "assumptions";
  if (id.startsWith("validation-")) return "validation";
  return undefined;
}

function isPromptEntry(entry: { id: string; value: unknown }): boolean {
  return typeof entry.value === "string";
}

export function budgetCompliance(input: ValidatorInput): ValidatorResult {
  const counts: Record<string, number> = {};

  for (const entry of input.entries) {
    if (entry.suspended) continue;
    if (!isPromptEntry(entry)) continue;
    const phase = phaseOf(entry.id);
    if (phase) counts[phase] = (counts[phase] ?? 0) + 1;
  }

  const violations: string[] = [];
  for (const [phase, budget] of Object.entries(PHASE_BUDGET)) {
    const actual = counts[phase] ?? 0;
    if (actual > budget) {
      violations.push(`${phase}: ${actual}/${budget}`);
    }
  }

  return {
    name: "budget-compliance",
    pass: violations.length === 0,
    details: violations.length > 0
      ? `Phases over budget: ${violations.join(", ")}`
      : undefined,
  };
}
