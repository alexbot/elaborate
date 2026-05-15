/**
 * trace-provenance: Every confirmed artifact has source: { promptId }.
 *
 * Checks that artifacts at confidence ≥ 0.9 have a non-null source with a
 * promptId, ensuring traceability to the prompt that produced them.
 */

import type { ValidatorInput, ValidatorResult } from "./types.js";

interface Traceable {
  id?: string;
  confidence?: number;
  source?: { promptId: string };
}

function label(item: Traceable, type: string): string {
  return item.id ? `${type}:${item.id}` : type;
}

export function traceProvenance(input: ValidatorInput): ValidatorResult {
  const { artifacts } = input;
  const missing: string[] = [];

  function check(item: Traceable, type: string): void {
    if ((item.confidence ?? 0) >= 0.9 && !item.source?.promptId) {
      missing.push(label(item, type));
    }
  }

  if (artifacts.purpose) check({ ...artifacts.purpose, id: undefined }, "purpose");
  if (artifacts.advantage) check({ ...artifacts.advantage, id: undefined }, "advantage");
  if (artifacts.measurement) check({ ...artifacts.measurement, id: undefined }, "measurement");
  for (const g of artifacts.goals) check(g, "goal");
  for (const s of artifacts.stakeholders) check(s, "stakeholder");
  for (const item of artifacts.inScope) check(item, "inScope");
  for (const item of artifacts.outOfScope) check(item, "outOfScope");
  for (const a of artifacts.assumptions) check(a, "assumption");

  return {
    name: "trace-provenance",
    pass: missing.length === 0,
    details: missing.length > 0
      ? `Confirmed artifacts missing source.promptId: ${missing.join(", ")}`
      : undefined,
  };
}
