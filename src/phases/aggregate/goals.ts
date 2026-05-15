/**
 * Goal aggregate mutations — fuzzy → elaborated → confirmed progression with
 * status-driven confidence.
 */

import type { Artifacts, Goal, GoalStatus, Source } from "../schema.js";
import { GOAL_CONFIDENCE } from "../schema.js";
import { nextId } from "./shared.js";
import { addWaitingRoomItems } from "./waitingRoom.js";

export function addFuzzyGoals(
  data: Artifacts,
  raws: Array<{ title: string; description: string; rationale?: string }>,
  source?: Source,
): string[] {
  const ids: string[] = [];
  for (const raw of raws) {
    const id = nextId("goal", data.goals);
    data.goals.push({
      id,
      title: raw.title,
      description: raw.description,
      rationale: raw.rationale,
      status: "fuzzy",
      confidence: GOAL_CONFIDENCE.fuzzy,
      ...(source && { source }),
    });
    ids.push(id);
  }
  return ids;
}

export function updateGoal(
  data: Artifacts,
  goalId: string,
  fields: { title?: string | null; description?: string | null; rationale?: string | null },
): boolean {
  const goal = findGoal(data, goalId);
  if (!goal) return false;
  let changed = false;
  if (fields.title) { goal.title = fields.title; changed = true; }
  if (fields.description) { goal.description = fields.description; changed = true; }
  if (fields.rationale) { goal.rationale = fields.rationale; changed = true; }
  return changed;
}

export function setGoalStatus(data: Artifacts, goalId: string, status: GoalStatus): void {
  const goal = findGoal(data, goalId);
  if (!goal) return;
  goal.status = status;
  goal.confidence = GOAL_CONFIDENCE[status];
}

export function removeGoals(data: Artifacts, ids: Set<string>): void {
  data.goals = data.goals.filter((g) => !ids.has(g.id));
}

export function confirmElaboratedGoals(data: Artifacts): void {
  for (const g of data.goals) {
    if (g.status === "elaborated") {
      g.status = "confirmed";
      g.confidence = GOAL_CONFIDENCE.confirmed;
    }
  }
}

export function applyGoalExtraction(
  data: Artifacts,
  goalId: string,
  ext: {
    title?: string | null;
    description?: string | null;
    rationale?: string | null;
    waitingRoomItems?: Array<{ content: string }>;
  },
): boolean {
  const advanced = updateGoal(data, goalId, {
    title: ext.title,
    description: ext.description,
    rationale: ext.rationale,
  });
  addWaitingRoomItems(data, ext.waitingRoomItems ?? []);
  return advanced;
}

export function findGoal(data: Artifacts, id: string): Goal | undefined {
  return data.goals.find((g) => g.id === id);
}
