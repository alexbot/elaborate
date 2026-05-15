/**
 * Waiting room — parked-item sink filled by deviation-resilient extraction
 * and drained by later phases (purpose pulls PAM hints, scope pulls scope
 * items, assumptions pulls the rest).
 */

import type { Artifacts } from "../schema.js";
import { nextId } from "./shared.js";

export function addWaitingRoomItems(data: Artifacts, items: Array<{ content: string }>): void {
  for (const item of items) {
    data.waitingRoom.push({
      id: nextId("waiting", data.waitingRoom),
      content: item.content,
    });
  }
}

export function drainWaitingRoom(data: Artifacts, ids: Set<string>): void {
  if (ids.size === 0) return;
  data.waitingRoom = data.waitingRoom.filter((w) => !ids.has(w.id));
}

export function addResidualItems(data: Artifacts, items: Array<{ content: string; reason: string }>): void {
  for (const item of items) {
    data.residual.push({
      id: nextId("residual", data.residual),
      content: item.content,
      reason: item.reason,
    });
  }
}

export function drainAllWaitingRoom(data: Artifacts): void {
  data.waitingRoom = [];
}
