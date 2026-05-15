/**
 * Session workflow — main entry point.
 *
 * Wires together opening → purpose → goals → stakeholders → scope → assumptions → validation → completion
 * on top of the durable interview framework.
 */

import type { Workflow } from "../durable/index.js";
import { ArtifactAggregate } from "./aggregate/index.js";
import "../interview/index.js";
import "./shared.js";
import { runOpening } from "./opening.js";
import { runPurpose } from "./purpose.js";
import { runGoals } from "./goals.js";
import { runStakeholders } from "./stakeholders.js";
import { runScope } from "./scope.js";
import { runAssumptions } from "./assumptions.js";
import { runValidation } from "./validation.js";
import { ENABLE_ASSUMPTIONS_PHASE } from "./configuration.js";

const TOTAL_PHASES = ENABLE_ASSUMPTIONS_PHASE ? 7 : 6;

/** Create a session workflow bound to the given aggregate. */
export function createSession(agg: ArtifactAggregate): Workflow {
  return async (ctx) => {
    ctx.setProgress(1, TOTAL_PHASES, "Opening");
    const opening = await runOpening(ctx, agg);

    ctx.setProgress(2, TOTAL_PHASES, "Purpose");
    ctx.setTransition("Let's dig into the purpose behind this idea.");
    await runPurpose(ctx, agg, opening);

    ctx.setProgress(3, TOTAL_PHASES, "Goals");
    ctx.setTransition("Good — now let's break that purpose down into concrete goals.");
    await runGoals(ctx, agg);

    ctx.setProgress(4, TOTAL_PHASES, "Stakeholders");
    ctx.setTransition("Now let's talk about who's involved — the people affected by or contributing to this project.");
    await runStakeholders(ctx, agg);

    ctx.setProgress(5, TOTAL_PHASES, "Scope");
    ctx.setTransition("We're past the halfway point. Let's define what's in scope and what's not.");
    await runScope(ctx, agg);

    if (ENABLE_ASSUMPTIONS_PHASE) {
      ctx.setProgress(6, TOTAL_PHASES, "Assumptions");
      ctx.setTransition("Almost done — let's surface the assumptions behind what we've discussed.");
      await runAssumptions(ctx, agg);
    }

    ctx.setProgress(TOTAL_PHASES, TOTAL_PHASES, "Validation");
    ctx.setTransition("Last step — let's review everything together.");
    await runValidation(ctx, agg);
  };
}

/** Self-contained workflow — creates its own aggregate per invocation. */
export const session: Workflow = async (ctx) => {
  await createSession(new ArtifactAggregate())(ctx);
};

// Workflow + aggregate
export { ArtifactAggregate };
export type { ContextSummary } from "./aggregate/index.js";

// Schema (whole module — artifact contract)
export {
  ArtifactsSchema,
  GoalSchema,
  StakeholderSchema,
  InScopeItemSchema,
  OutOfScopeItemSchema,
  ConstraintSchema,
  AssumptionSchema,
  PurposeSchema,
  AdvantageSchema,
  MeasurementSchema,
  SourceSchema,
  WaitingItemSchema,
  FindingSchema,
  ResidualItemSchema,
  GoalStatus,
  StakeholderType,
  StakeholderStatus,
  AssumptionType,
  AssumptionStatus,
  GOAL_CONFIDENCE,
  STAKEHOLDER_CONFIDENCE,
  ASSUMPTION_CONFIDENCE,
  createEmptyArtifacts,
} from "./schema.js";
export type {
  Artifacts,
  Goal,
  Stakeholder,
  InScopeItem,
  OutOfScopeItem,
  Constraint,
  Assumption,
  Purpose,
  Advantage,
  Measurement,
  Source,
  WaitingItem,
  Finding,
  ResidualItem,
} from "./schema.js";

// Session (re-exported from session sub-barrel)
export { createFilePersistence, archiveSession, archiveCorrupted, CorruptedSessionError } from "./session/index.js";
export type { SessionPersistence } from "./session/index.js";
