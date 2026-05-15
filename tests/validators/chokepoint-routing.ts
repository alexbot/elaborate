/**
 * chokepoint-routing: All LLM interactions go through designated chokepoints.
 *
 * Verifies id naming conventions in state entries. Infer entries should follow
 * the naming pattern established by the interview macros:
 * - Composition infers: contain "composition"
 * - Extraction infers: contain "extraction"
 * - Classification infers: contain "classification" or "confirmation"
 * - Sort/rank infers: contain "sort" (allowed raw ctx.infer exceptions)
 *
 * Raw infer calls outside these patterns indicate chokepoint bypass.
 * Known exceptions per ADR: goals-sort, stakeholders-sort, scope-sort,
 * scope-contradiction-check, validation-summary.
 */

import type { ValidatorInput, ValidatorResult } from "./types.js";

const KNOWN_PATTERNS = [
  "composition",
  "extraction",
  "classification",
  "confirmation",
  "sort",
  "contradiction",
  "brownfield",
  "revision",
];

const KNOWN_RAW_EXCEPTIONS = new Set([
  "goals-sort",
  "stakeholders-sort",
  "scope-ambiguous-sort",
  "scope-contradiction-check",
  "validation-consistency-check",
  "stakeholder-followup-assessment",
  "scope-dedup",
]);

function isInferEntry(entry: { id: string; value: unknown }): boolean {
  return typeof entry.value === "object" && entry.value !== null;
}

function isPromptEntry(entry: { id: string; value: unknown }): boolean {
  return typeof entry.value === "string";
}

function matchesKnownPattern(id: string): boolean {
  return KNOWN_PATTERNS.some((p) => id.includes(p));
}

function isKnownException(id: string): boolean {
  for (const exc of KNOWN_RAW_EXCEPTIONS) {
    if (id.includes(exc)) return true;
  }
  return false;
}

export function chokepointRouting(input: ValidatorInput): ValidatorResult {
  const unrouted: string[] = [];

  for (const entry of input.entries) {
    if (entry.suspended) continue;
    if (isPromptEntry(entry)) continue;
    if (!isInferEntry(entry)) continue;

    if (!matchesKnownPattern(entry.id) && !isKnownException(entry.id)) {
      unrouted.push(entry.id);
    }
  }

  return {
    name: "chokepoint-routing",
    pass: unrouted.length === 0,
    details: unrouted.length > 0
      ? `Infer entries bypassing chokepoints: ${unrouted.join(", ")}`
      : undefined,
  };
}
