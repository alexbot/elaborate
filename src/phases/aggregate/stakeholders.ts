/**
 * Stakeholder aggregate mutations — identified → elaborated → confirmed
 * progression with status-driven confidence.
 */

import type { Artifacts, Stakeholder, StakeholderType, StakeholderStatus, Source } from "../schema.js";
import { STAKEHOLDER_CONFIDENCE } from "../schema.js";
import { nextId } from "./shared.js";
import { addWaitingRoomItems } from "./waitingRoom.js";

export function addIdentifiedStakeholders(
  data: Artifacts,
  raws: Array<{ name: string; type: StakeholderType }>,
  source?: Source,
): void {
  for (const raw of raws) {
    data.stakeholders.push({
      id: nextId("stakeholder", data.stakeholders),
      name: raw.name,
      type: raw.type,
      role: "",
      concerns: [],
      isRespondent: false,
      status: "identified",
      confidence: STAKEHOLDER_CONFIDENCE.identified,
      ...(source && { source }),
    });
  }
}

export function updateStakeholder(
  data: Artifacts,
  id: string,
  fields: { role?: string | null; type?: StakeholderType | null },
): boolean {
  const sh = findStakeholder(data, id);
  if (!sh) return false;
  let changed = false;
  if (fields.role) { sh.role = fields.role; changed = true; }
  if (fields.type) { sh.type = fields.type; changed = true; }
  return changed;
}

export function addConcerns(data: Artifacts, id: string, concerns: string[]): number {
  const sh = findStakeholder(data, id);
  if (!sh) return 0;
  const existing = new Set(sh.concerns);
  let added = 0;
  for (const c of concerns) {
    if (!existing.has(c)) {
      sh.concerns.push(c);
      existing.add(c);
      added++;
    }
  }
  return added;
}

export function setRespondent(data: Artifacts, id: string): void {
  const sh = findStakeholder(data, id);
  if (sh) sh.isRespondent = true;
}

export function setStakeholderStatus(data: Artifacts, id: string, status: StakeholderStatus): void {
  const sh = findStakeholder(data, id);
  if (!sh) return;
  sh.status = status;
  sh.confidence = STAKEHOLDER_CONFIDENCE[status];
}

export function removeStakeholders(data: Artifacts, ids: Set<string>): void {
  data.stakeholders = data.stakeholders.filter((s) => !ids.has(s.id));
}

export function confirmElaboratedStakeholders(data: Artifacts): void {
  for (const s of data.stakeholders) {
    if (s.status === "elaborated") {
      s.status = "confirmed";
      s.confidence = STAKEHOLDER_CONFIDENCE.confirmed;
    }
  }
}

export function applyStakeholderElaboration(
  data: Artifacts,
  id: string,
  ext: {
    role?: string | null;
    concerns?: string[];
    waitingRoomItems?: Array<{ content: string }>;
  },
): boolean {
  let advanced = false;
  if (ext.role) {
    advanced = updateStakeholder(data, id, { role: ext.role }) || advanced;
  }
  if (ext.concerns && ext.concerns.length > 0) {
    advanced = addConcerns(data, id, ext.concerns) > 0 || advanced;
  }
  addWaitingRoomItems(data, ext.waitingRoomItems ?? []);
  return advanced;
}

export function findStakeholder(data: Artifacts, id: string): Stakeholder | undefined {
  return data.stakeholders.find((s) => s.id === id);
}
