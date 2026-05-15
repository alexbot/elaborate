/**
 * confidence-monotonicity: Artifact confidence only increases (0.5 → 0.7 → 0.9).
 *
 * Scans infer entries in the state log for artifact-mutating extractions.
 * Tracks confidence per artifact id, verifies non-decreasing progression.
 *
 * Since we inspect final artifacts (not the full timeline), this validator
 * checks a weaker property: confirmed artifacts have valid confidence values,
 * and the status-to-confidence mappings are respected.
 */

import type { ValidatorInput, ValidatorResult } from "./types.js";

const VALID_CONFIDENCE = [0.5, 0.7, 0.9];

interface ConfidenceItem {
  id: string;
  type: string;
  confidence: number;
  status?: string;
}

export function confidenceMonotonicity(input: ValidatorInput): ValidatorResult {
  const { artifacts } = input;
  const violations: string[] = [];

  const items: ConfidenceItem[] = [];

  if (artifacts.purpose?.confidence !== undefined) {
    items.push({ id: "purpose", type: "purpose", confidence: artifacts.purpose.confidence });
  }
  if (artifacts.advantage?.confidence !== undefined) {
    items.push({ id: "advantage", type: "advantage", confidence: artifacts.advantage.confidence });
  }
  if (artifacts.measurement?.confidence !== undefined) {
    items.push({ id: "measurement", type: "measurement", confidence: artifacts.measurement.confidence });
  }
  for (const g of artifacts.goals) {
    items.push({ id: g.id, type: "goal", confidence: g.confidence, status: g.status });
  }
  for (const s of artifacts.stakeholders) {
    items.push({ id: s.id, type: "stakeholder", confidence: s.confidence, status: s.status });
  }
  for (const a of artifacts.assumptions) {
    items.push({ id: a.id, type: "assumption", confidence: a.confidence, status: a.status });
  }

  const statusConfidence: Record<string, Record<string, number>> = {
    goal: { fuzzy: 0.5, elaborated: 0.7, confirmed: 0.9 },
    stakeholder: { identified: 0.5, elaborated: 0.7, confirmed: 0.9 },
    assumption: { unvalidated: 0.5, validated: 0.9, flagged: 0.7 },
  };

  for (const item of items) {
    if (!VALID_CONFIDENCE.includes(item.confidence)) {
      violations.push(`${item.type}:${item.id} has invalid confidence ${item.confidence}`);
      continue;
    }

    if (item.status && statusConfidence[item.type]) {
      const expected = statusConfidence[item.type][item.status];
      if (expected !== undefined && item.confidence !== expected) {
        violations.push(
          `${item.type}:${item.id} status=${item.status} but confidence=${item.confidence} (expected ${expected})`,
        );
      }
    }
  }

  return {
    name: "confidence-monotonicity",
    pass: violations.length === 0,
    details: violations.length > 0
      ? `Confidence violations: ${violations.join("; ")}`
      : undefined,
  };
}
