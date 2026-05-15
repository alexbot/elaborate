/**
 * Scope aggregate mutations — in-scope/out-of-scope items and constraints.
 *
 * In-scope and out-of-scope items share a single `scope_NNN` namespace (numbered
 * across both lists). Constraints have their own `constraint_NNN` namespace.
 * The shared scope namespace is load-bearing: removal by ID filters both lists
 * via a single set check.
 */

import type { Artifacts, Source } from "../schema.js";
import { nextId, SCOPE_DEFAULT_CONFIDENCE, CONFIRMED_CONFIDENCE } from "./shared.js";

function nextScopeId(data: Artifacts): string {
  return nextId("scope", [...data.inScope, ...data.outOfScope]);
}

function normalizeDescription(desc: string): string {
  return desc.toLowerCase().trim().replace(/\s+/g, " ");
}

function hasDuplicateDescription(data: Artifacts, description: string): boolean {
  const normalized = normalizeDescription(description);
  return data.inScope.some((s) => normalizeDescription(s.description) === normalized)
    || data.outOfScope.some((s) => normalizeDescription(s.description) === normalized);
}

export function addInScopeItems(
  data: Artifacts,
  items: Array<{ description: string; relatedGoals?: string[] }>,
  confidence = SCOPE_DEFAULT_CONFIDENCE,
  source?: Source,
): void {
  for (const item of items) {
    if (hasDuplicateDescription(data, item.description)) continue;
    data.inScope.push({
      id: nextScopeId(data),
      description: item.description,
      relatedGoals: item.relatedGoals ?? [],
      confidence,
      ...(source && { source }),
    });
  }
}

export function addOutOfScopeItems(
  data: Artifacts,
  items: Array<{ description: string; reason?: string; relatedGoals?: string[] }>,
  confidence = SCOPE_DEFAULT_CONFIDENCE,
  source?: Source,
): void {
  for (const item of items) {
    if (hasDuplicateDescription(data, item.description)) continue;
    data.outOfScope.push({
      id: nextScopeId(data),
      description: item.description,
      reason: item.reason ?? "",
      relatedGoals: item.relatedGoals ?? [],
      confidence,
      ...(source && { source }),
    });
  }
}

export function addConstraints(data: Artifacts, items: Array<{ description: string }>, source?: Source): void {
  for (const item of items) {
    data.constraints.push({
      id: nextId("constraint", data.constraints),
      description: item.description,
      ...(source && { source }),
    });
  }
}

export function removeScopeItems(data: Artifacts, ids: Set<string>): void {
  data.inScope = data.inScope.filter((s) => !ids.has(s.id));
  data.outOfScope = data.outOfScope.filter((s) => !ids.has(s.id));
}

export function confirmScope(data: Artifacts): void {
  for (const s of data.inScope) s.confidence = CONFIRMED_CONFIDENCE;
  for (const s of data.outOfScope) s.confidence = CONFIRMED_CONFIDENCE;
}
