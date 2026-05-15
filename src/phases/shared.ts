/**
 * RE-coupled residual of the former shared.ts — items that reference the
 * `Artifacts` or `Phase` type and therefore stay on the phases side of the
 * layer boundary. Interview-generic content lives in `../interview/`.
 */

import { z } from "zod";
import { WorkflowContext } from "../durable/index.js";
import type { Artifacts } from "./schema.js";
import {
  PurposeSchema, AdvantageSchema, MeasurementSchema,
  GoalSchema, StakeholderSchema,
  InScopeItemSchema, OutOfScopeItemSchema, ConstraintSchema,
  AssumptionSchema,
} from "./schema.js";
import {
  type PromptConfirmOptions,
  classificationPreamble,
} from "../interview/index.js";
// Barrel import for side effects — registers every interview-generic prototype
// method on WorkflowContext.
import "../interview/index.js";

/** Interview phase identifier. */
export type Phase = "opening" | "purpose" | "goals" | "stakeholders" | "scope" | "assumptions" | "validation";

/** Schema for classifying approval/revision responses across all phases. */
export const ConfirmClassifySchema = z.object({
  approved: z.boolean().describe("true if the stakeholder approved the summary"),
  revisionRequested: z.string().nullable().describe("what they want to change, null if approved"),
  targetId: z.string().nullable().optional().describe("ID of the specific item to revise (e.g. goal_001, sh_002), null if unclear or not applicable"),
});

declare module "../durable/workflow.js" {
  interface WorkflowContext {
    confirm(response: string, artifacts: Artifacts, phase: Phase, round: number, ri?: number): Promise<{ approved: boolean; revisionRequested: string | null; targetId?: string | null }>;
  }
}

/** Classify whether the respondent approved a phase summary or requested a revision. */
WorkflowContext.prototype.confirm = async function (
  response: string,
  artifacts: Artifacts,
  phase: Phase,
  round: number,
  ri?: number,
) {
  const idSuffix = ri !== undefined ? `-r${ri}` : "";
  const hasIds = phase === "goals" || phase === "stakeholders";
  const targetHint = hasIds ? "\nIf revising, set targetId to the ID of the specific item they want to change." : "";
  const baseGuidance = `Classify the response to the ${phase} summary.${targetHint}`;
  const classPre = classificationPreamble();
  const guidance = classPre
    ? classPre + "\n" + baseGuidance
    : baseGuidance;
  return this.extract({
    id: `${phase}-confirmation-classification-${round}${idSuffix}`,
    response,
    artifactsContext: buildFullContext(artifacts),
    schema: ConfirmClassifySchema,
    guidance,
  });
};

/**
 * Phase-side `promptConfirm` wrapper: delegates the prompt-and-classify cycle
 * to `ctx.promptConfirm` in interview/macros.ts, passing the RE-coupled
 * `ctx.confirm` as the classifier thunk. Returned shape matches the phase
 * confirmation contract: `{ response, approved, revisionRequested, targetId? }`.
 */
export function confirmPhase(
  ctx: WorkflowContext,
  prompt: { id: string; message: string },
  artifacts: Artifacts,
  phase: Phase,
  round: number,
  options?: PromptConfirmOptions,
): Promise<{ response: string; approved: boolean; revisionRequested: string | null; targetId?: string | null }> {
  return ctx.promptConfirm(
    prompt,
    (response, ri) => ctx.confirm(response, artifacts, phase, round, ri),
    options,
  );
}

/**
 * Serialize all non-empty artifacts to a compact JSON string for LLM context.
 *
 * `includeWaitingRoom: true` emits the waitingRoom array too — used by seed
 * primitives that mine parked items. Default omits it, so non-seed extractions
 * don't carry unrelated parked content.
 */
export function buildFullContext(
  artifacts: Artifacts,
  options?: { includeWaitingRoom?: boolean },
): string {
  const ctx: Record<string, unknown> = {};
  if (artifacts.purpose) ctx.purpose = PurposeSchema.pick({ statement: true }).parse(artifacts.purpose);
  if (artifacts.advantage) ctx.advantage = AdvantageSchema.pick({ statement: true }).parse(artifacts.advantage);
  if (artifacts.measurement) ctx.measurement = MeasurementSchema.pick({ statement: true }).parse(artifacts.measurement);
  if (artifacts.goals.length > 0) ctx.goals = artifacts.goals.map(g => GoalSchema.pick({ id: true, title: true, status: true, rationale: true }).parse(g));
  if (artifacts.stakeholders.length > 0) ctx.stakeholders = artifacts.stakeholders.map(s => StakeholderSchema.pick({ id: true, name: true, type: true, role: true, concerns: true, isRespondent: true, status: true }).parse(s));
  if (artifacts.inScope.length > 0) ctx.inScope = artifacts.inScope.map(s => InScopeItemSchema.pick({ description: true, relatedGoals: true }).parse(s));
  if (artifacts.outOfScope.length > 0) ctx.outOfScope = artifacts.outOfScope.map(s => OutOfScopeItemSchema.pick({ description: true, reason: true, relatedGoals: true }).parse(s));
  if (artifacts.constraints.length > 0) ctx.constraints = artifacts.constraints.map(c => ConstraintSchema.pick({ id: true, description: true }).parse(c));
  if (artifacts.assumptions.length > 0) ctx.assumptions = artifacts.assumptions.map(a => AssumptionSchema.pick({ id: true, statement: true, type: true, status: true, relatedGoals: true }).parse(a));
  if (artifacts.domainHints.length > 0) ctx.domainHints = artifacts.domainHints;
  if (options?.includeWaitingRoom && artifacts.waitingRoom.length > 0) {
    ctx.waitingRoom = artifacts.waitingRoom.map(w => ({ id: w.id, content: w.content }));
  }
  return Object.keys(ctx).length > 0 ? JSON.stringify(ctx) : "(no artifacts captured yet)";
}

/** Module-load self-check for the RE-coupled augmentations on WorkflowContext. */
const REQUIRED_PROTOTYPE_METHODS = [
  "confirm",
] as const;
for (const method of REQUIRED_PROTOTYPE_METHODS) {
  if (typeof (WorkflowContext.prototype as unknown as Record<string, unknown>)[method] !== "function") {
    throw new Error(
      `phases/shared.ts self-check failed: WorkflowContext.prototype.${method} is not a function. A prototype assignment was likely dropped.`,
    );
  }
}

// Re-export interview-layer items that today's callers reach for through shared.ts.
// This keeps the current phase-file import shape working until the API sibling child
// defines per-layer barrels and cross-layer import discipline.
export { confirmationCloser } from "../interview/index.js";

/** Build a markdown section: optional heading + non-empty lines. Returns "" if no lines remain. */
export function section(heading: string, lines: string[]): string {
  const filled = lines.filter(Boolean);
  if (filled.length === 0) return "";
  return heading ? [heading, ...filled].join("\n") : filled.join("\n");
}
