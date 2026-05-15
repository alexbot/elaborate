/**
 * waiting-room-lifecycle: Every WR item is drained or present in final summary.
 *
 * At session end, the waiting room should be empty — all items either drained
 * into a phase (scope, assumptions) or surfaced in findings. Any remaining
 * items represent silently dropped content.
 */

import type { ValidatorInput, ValidatorResult } from "./types.js";

export function waitingRoomLifecycle(input: ValidatorInput): ValidatorResult {
  const { artifacts } = input;
  const remaining = artifacts.waitingRoom;

  if (remaining.length === 0) {
    return { name: "waiting-room-lifecycle", pass: true };
  }

  const findingContent = artifacts.findings.map((f) => f.content.toLowerCase());
  const undrained: string[] = [];

  for (const item of remaining) {
    const inFindings = findingContent.some((f) => f.includes(item.content.toLowerCase().slice(0, 30)));
    if (!inFindings) {
      undrained.push(item.id);
    }
  }

  return {
    name: "waiting-room-lifecycle",
    pass: undrained.length === 0,
    details: undrained.length > 0
      ? `WR items not drained or surfaced: ${undrained.join(", ")} (${undrained.length}/${remaining.length} remaining)`
      : undefined,
  };
}
