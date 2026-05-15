/**
 * no-self-resolution: No infer call produces a decision that should be a user choice.
 *
 * Operationalized as: every confirmed artifact (confidence ≥ 0.9) must have been
 * preceded by a user prompt (confirmation) in the same phase. If a phase has
 * confirmed artifacts but no confirmation prompt, Elaborate self-resolved.
 */

import type { ValidatorInput, ValidatorResult } from "./types.js";

const PHASES_WITH_CONFIRMATION = [
  "purpose",
  "goal",
  "goals",
  "stakeholder",
  "stakeholders",
  "scope",
  "assumption",
  "assumptions",
  "validation",
];

function phaseOf(id: string): string | undefined {
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

function isConfirmationPrompt(id: string): boolean {
  return id.includes("confirmation") || id.includes("confirm") || id.includes("summary");
}

export function noSelfResolution(input: ValidatorInput): ValidatorResult {
  const { entries, artifacts } = input;

  const phasesWithConfirmedArtifacts = new Set<string>();

  if (artifacts.purpose?.confidence === 0.9) phasesWithConfirmedArtifacts.add("purpose");
  for (const g of artifacts.goals) {
    if (g.confidence === 0.9) { phasesWithConfirmedArtifacts.add("goals"); break; }
  }
  for (const s of artifacts.stakeholders) {
    if (s.confidence === 0.9) { phasesWithConfirmedArtifacts.add("stakeholders"); break; }
  }
  for (const item of [...artifacts.inScope, ...artifacts.outOfScope]) {
    if (item.confidence === 0.9) { phasesWithConfirmedArtifacts.add("scope"); break; }
  }
  for (const a of artifacts.assumptions) {
    if (a.confidence === 0.9) { phasesWithConfirmedArtifacts.add("assumptions"); break; }
  }

  const phasesWithConfirmationPrompt = new Set<string>();
  for (const entry of entries) {
    if (!isPromptEntry(entry)) continue;
    if (!isConfirmationPrompt(entry.id)) continue;
    const phase = phaseOf(entry.id);
    if (phase) phasesWithConfirmationPrompt.add(phase);
  }

  const violations: string[] = [];
  for (const phase of phasesWithConfirmedArtifacts) {
    if (!phasesWithConfirmationPrompt.has(phase)) {
      violations.push(phase);
    }
  }

  return {
    name: "no-self-resolution",
    pass: violations.length === 0,
    details: violations.length > 0
      ? `Confirmed artifacts without user confirmation in: ${violations.join(", ")}`
      : undefined,
  };
}
