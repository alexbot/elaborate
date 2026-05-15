/**
 * MVP artifact schema using Zod
 */

import { z } from "zod";

/** Provenance — which prompt surfaced this artifact */
export const SourceSchema = z.object({
  promptId: z.string(),
});
export type Source = z.infer<typeof SourceSchema>;

/** Goal status progression: fuzzy → elaborated → confirmed */
export const GoalStatus = z.enum(["fuzzy", "elaborated", "confirmed"]);
export type GoalStatus = z.infer<typeof GoalStatus>;

/** Deterministic confidence from goal status */
export const GOAL_CONFIDENCE: Record<GoalStatus, number> = {
  fuzzy: 0.5,
  elaborated: 0.7,
  confirmed: 0.9,
};

/** In-scope item — no status progression, boundary decisions are binary */
export const InScopeItemSchema = z.object({
  id: z.string(),
  description: z.string().min(1),
  relatedGoals: z.array(z.string()).default([]),
  confidence: z.number().min(0).max(1),
  source: SourceSchema.optional(),
});
export type InScopeItem = z.infer<typeof InScopeItemSchema>;

/** Out-of-scope item */
export const OutOfScopeItemSchema = z.object({
  id: z.string(),
  description: z.string().min(1),
  reason: z.string().default(""),
  relatedGoals: z.array(z.string()).default([]),
  confidence: z.number().min(0).max(1),
  source: SourceSchema.optional(),
});
export type OutOfScopeItem = z.infer<typeof OutOfScopeItemSchema>;

/** Constraint — external non-negotiable reality */
export const ConstraintSchema = z.object({
  id: z.string(),
  description: z.string().min(1),
  source: SourceSchema.optional(),
});
export type Constraint = z.infer<typeof ConstraintSchema>;

/** Stakeholder type */
export const StakeholderType = z.enum(["primary", "secondary", "external"]);
export type StakeholderType = z.infer<typeof StakeholderType>;

/** Stakeholder status progression: identified → elaborated → confirmed */
export const StakeholderStatus = z.enum(["identified", "elaborated", "confirmed"]);
export type StakeholderStatus = z.infer<typeof StakeholderStatus>;

/** Deterministic confidence from stakeholder status */
export const STAKEHOLDER_CONFIDENCE: Record<StakeholderStatus, number> = {
  identified: 0.5,
  elaborated: 0.7,
  confirmed: 0.9,
};

/** Purpose statement with confidence */
export const PurposeSchema = z.object({
  statement: z.string().min(1),
  confidence: z.number().min(0).max(1),
  source: SourceSchema.optional(),
});
export type Purpose = z.infer<typeof PurposeSchema>;

/** Goal */
export const GoalSchema = z.object({
  id: z.string(),
  title: z.string().min(1),
  description: z.string(),
  rationale: z.string().optional(),
  status: GoalStatus,
  confidence: z.number().min(0).max(1),
  source: SourceSchema.optional(),
});
export type Goal = z.infer<typeof GoalSchema>;

/** Stakeholder */
export const StakeholderSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  type: StakeholderType,
  role: z.string().default(""),
  concerns: z.array(z.string()).default([]),
  isRespondent: z.boolean().default(false),
  status: StakeholderStatus.default("identified"),
  confidence: z.number().min(0).max(1).default(0.5),
  source: SourceSchema.optional(),
});
export type Stakeholder = z.infer<typeof StakeholderSchema>;

/** Advantage statement with confidence */
export const AdvantageSchema = z.object({
  statement: z.string().min(1),
  confidence: z.number().min(0).max(1),
  source: SourceSchema.optional(),
});
export type Advantage = z.infer<typeof AdvantageSchema>;

/** Measurement criteria with confidence */
export const MeasurementSchema = z.object({
  statement: z.string().min(1),
  confidence: z.number().min(0).max(1),
  source: SourceSchema.optional(),
});
export type Measurement = z.infer<typeof MeasurementSchema>;

/** Assumption status: no progression — binary validation with explicit "can't verify" */
export const AssumptionStatus = z.enum(["unvalidated", "validated", "flagged"]);
export type AssumptionStatus = z.infer<typeof AssumptionStatus>;

/** Deterministic confidence from assumption status */
export const ASSUMPTION_CONFIDENCE: Record<AssumptionStatus, number> = {
  unvalidated: 0.5,
  validated: 0.9,
  flagged: 0.7,
};

export const AssumptionType = z.enum(["hypothesis", "invariant"]);
export type AssumptionType = z.infer<typeof AssumptionType>;

/** Assumption — believed-but-unverified domain property (KAOS) */
export const AssumptionSchema = z.object({
  id: z.string(),
  statement: z.string().min(1),
  type: AssumptionType,
  status: AssumptionStatus.default("unvalidated"),
  relatedGoals: z.array(z.string()).default([]),
  confidence: z.number().min(0).max(1),
  source: SourceSchema.optional(),
});
export type Assumption = z.infer<typeof AssumptionSchema>;

/** Waiting room item */
export const WaitingItemSchema = z.object({
  id: z.string(),
  content: z.string().min(1),
});
export type WaitingItem = z.infer<typeof WaitingItemSchema>;

/** A finding — gap or observation captured during the session */
export const FindingSchema = z.object({
  id: z.string(),
  content: z.string().min(1),
  phase: z.string(),
});
export type Finding = z.infer<typeof FindingSchema>;

/** Residual item — WR content that survived classify-and-route in validation */
export const ResidualItemSchema = z.object({
  id: z.string(),
  content: z.string().min(1),
  reason: z.string().min(1),
});
export type ResidualItem = z.infer<typeof ResidualItemSchema>;

/** Complete artifacts structure (MVP) */
export const ArtifactsSchema = z.object({
  purpose: PurposeSchema.optional(),
  advantage: AdvantageSchema.optional(),
  measurement: MeasurementSchema.optional(),
  goals: z.array(GoalSchema).default([]),
  stakeholders: z.array(StakeholderSchema).default([]),
  inScope: z.array(InScopeItemSchema).default([]),
  outOfScope: z.array(OutOfScopeItemSchema).default([]),
  constraints: z.array(ConstraintSchema).default([]),
  assumptions: z.array(AssumptionSchema).default([]),
  domainHints: z.array(z.string()).default([]),
  waitingRoom: z.array(WaitingItemSchema).default([]),
  findings: z.array(FindingSchema).default([]),
  residual: z.array(ResidualItemSchema).default([]),
});
export type Artifacts = z.infer<typeof ArtifactsSchema>;

/** Create empty artifacts structure */
export function createEmptyArtifacts(): Artifacts {
  return {
    goals: [],
    stakeholders: [],
    inScope: [],
    outOfScope: [],
    constraints: [],
    assumptions: [],
    domainHints: [],
    waitingRoom: [],
    findings: [],
    residual: [],
  };
}
