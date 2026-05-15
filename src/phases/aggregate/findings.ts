/**
 * Findings aggregate mutations — observations surfaced during any phase
 * (typically validation / contradiction checks), tagged with their originating
 * phase for later display.
 */

import type { Artifacts, Finding } from "../schema.js";
import { nextId } from "./shared.js";

export function addDomainHints(data: Artifacts, hints: string[]): void {
  data.domainHints.push(...hints);
}

export function addFinding(data: Artifacts, content: string, phase: string): void {
  data.findings.push({
    id: nextId("finding", data.findings),
    content,
    phase,
  });
}

export function findingsByPhase(data: Artifacts, phase: string): Finding[] {
  return data.findings.filter((f) => f.phase === phase);
}
