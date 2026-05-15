/**
 * Assumption aggregate mutations — unvalidated / validated / flagged states
 * with status-driven confidence.
 */

import type { Artifacts, Assumption, AssumptionType, AssumptionStatus, Source } from "../schema.js";
import { ASSUMPTION_CONFIDENCE } from "../schema.js";
import { nextId } from "./shared.js";

export function addAssumptions(
  data: Artifacts,
  items: Array<{ statement: string; type?: AssumptionType; relatedGoals?: string[] }>,
  confidence = ASSUMPTION_CONFIDENCE.unvalidated,
  status: AssumptionStatus = "unvalidated",
  source?: Source,
): void {
  for (const item of items) {
    data.assumptions.push({
      id: nextId("assumption", data.assumptions),
      statement: item.statement,
      type: item.type ?? "hypothesis",
      status,
      relatedGoals: item.relatedGoals ?? [],
      confidence,
      ...(source && { source }),
    });
  }
}

export function setAssumptionStatus(data: Artifacts, id: string, status: AssumptionStatus): void {
  const a = findAssumption(data, id);
  if (!a) return;
  a.status = status;
  a.confidence = ASSUMPTION_CONFIDENCE[status];
}

export function removeAssumptions(data: Artifacts, ids: Set<string>): void {
  data.assumptions = data.assumptions.filter((a) => !ids.has(a.id));
}

export function findAssumption(data: Artifacts, id: string): Assumption | undefined {
  return data.assumptions.find((a) => a.id === id);
}
