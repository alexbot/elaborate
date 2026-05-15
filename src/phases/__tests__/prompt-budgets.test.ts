/**
 * Prompt-budget assertions for the "standard" session configuration.
 *
 * This suite runs the full `session` workflow with the default feature
 * flags (ENABLE_ASSUMPTIONS_PHASE = false, ENABLE_GOAL_NEGATIVE_STAGE = false)
 * and asserts the per-phase user-prompt counts match the budgets documented
 * in the interview-prompt-budgets requirement.
 *
 * Scenario: minimal representative session — 1 goal, 2 stakeholders
 * (1 respondent + 1 non-respondent), 1 scope item, 0 ambiguous. A full typical
 * session (3 goals, 3 stakeholders, 4 assumptions, 2 ambiguous) scales the
 * per-artifact loops linearly; the per-phase assertions here verify the
 * gate behaviour that keeps those scaled counts within budget.
 */

import { describe, it, expect } from "vitest";
import {
  type Resolver,
  Suspend,
  execute,
  session,
  memoryPersistence,
} from "./helpers.js";

type Counter = { total: number; byPhase: Record<string, number> };

function phaseOf(id: string): string {
  if (id.startsWith("opening-")) return "opening";
  if (id.startsWith("purpose-")) return "purpose";
  if (id.startsWith("goal-") || id.startsWith("goals-")) return "goals";
  if (id.startsWith("stakeholder-") || id.startsWith("stakeholders-")) return "stakeholders";
  if (id.startsWith("scope-")) return "scope";
  if (id.startsWith("assumption-") || id.startsWith("assumptions-")) return "assumptions";
  if (id.startsWith("validation-")) return "validation";
  return "other";
}

function countingResolver(
  llm: Record<string, unknown>,
  env: Record<string, string>,
  counter: Counter,
): Resolver {
  return async (prompt) => {
    if (prompt.type === "infer") return llm[prompt.id] ?? {};
    counter.total++;
    counter.byPhase[phaseOf(prompt.id)] = (counter.byPhase[phaseOf(prompt.id)] ?? 0) + 1;
    if (prompt.id in env) return env[prompt.id];
    throw new Suspend(prompt.id, prompt);
  };
}

const llm: Record<string, unknown> = {
  // opening
  "opening-greet-extraction-r0": {
    purpose: "task management for teams",
    stakeholders: ["team lead", "developer"],
    domainHints: ["project management"],
  },
  "opening-brownfield-screen": { greenfieldConfidence: 9 },
  "opening-confirmation-classification-0-r0": { approved: true, revisionRequested: null },
  // purpose — opening response already fills all 3 PAM slots, no slot-fill prompts
  "purpose-initial-extraction": {
    purpose: "streamline task tracking",
    advantage: "simpler than Jira",
    measurement: "tasks completed per sprint",
    contradictions: [],
  },
  "purpose-confirmation-classification-0-r0": { approved: true, revisionRequested: null },
  // goals — 1 goal, clarify captures rationale (why skipped), negative gated off
  "goal-seed-extraction": {
    goals: [{ title: "Track tasks", description: "Monitor team tasks" }],
  },
  "goal-seed-classification-r0": {
    responseInterpretation: "Confirmed",
    confirmedGoalIds: ["goal_001"],
    removedGoalIds: [],
    newGoals: [],
    waitingRoomItems: [],
  },
  "goal-refinement-goal_001-clarify-0-composition-r0": { question: "What?", suggestions: ["A"] },
  "goal-refinement-goal_001-clarify-0-extraction-r0": {
    title: null, description: "Track task status", rationale: "Team visibility",
    contradictions: [], waitingRoomItems: [],
  },
  "goals-confirmation-classification-0-r0": { approved: true, revisionRequested: null },
  // stakeholders — 2 SH, 1 respondent
  "stakeholder-review-classification-r0": { updatedTypes: [], removedIds: [], newStakeholders: [] },
  "stakeholder-respondent-present-extraction-r0": { respondentId: "stakeholder_001" },
  "stakeholder-elaboration-stakeholder_001-0-composition-r0": { question: "Role?", suggestions: ["M"] },
  "stakeholder-elaboration-stakeholder_001-0-extraction-r0": {
    role: "Assigns tasks", concerns: ["Visibility"], contradictions: [], waitingRoomItems: [],
  },
  "stakeholder-elaboration-stakeholder_002-0-composition-r0": { question: "Dev?", suggestions: ["C"] },
  "stakeholder-elaboration-stakeholder_002-0-extraction-r0": {
    role: "Writes code", concerns: ["Clear specs"], contradictions: [], waitingRoomItems: [],
  },
  "stakeholder-followup-assessment-stakeholder_002": {
    needed: true, question: "What specific challenges does the developer face?", suggestions: ["Build speed", "Unclear specs"],
  },
  "stakeholder-followup-stakeholder_002-extraction-r0": {
    responseInterpretation: "Fast builds matter", role: null, concerns: ["Fast builds"], contradictions: [], waitingRoomItems: [],
  },
  "stakeholders-confirmation-classification-0-r0": { approved: true, revisionRequested: null },
  // scope — 1 inScope, 0 ambiguous
  "scope-seed-extraction": {
    inScope: [{ description: "Task board", relatedGoals: ["goal_001"] }],
    outOfScope: [],
    ambiguous: [],
  },
  "scope-seed-classification-r0": {
    confirmedInScope: ["scope_001"], confirmedOutOfScope: [], removedIds: [], newItems: [], waitingRoomItems: [],
  },
  "scope-constraint-composition-r0": { question: "Constraints?", suggestions: ["Time"] },
  "scope-constraint-extraction-r0": { constraints: [{ description: "Small team" }], waitingRoomItems: [] },
  "scope-contradiction-check": { contradictions: [], orphans: [] },
  "scope-confirmation-classification-0-r0": { approved: true, revisionRequested: null },
  // validation
  "validation-consistency-check": { contradictions: [] },
  "validation-confirmation-classification-0-r0": { approved: true, revisionRequested: null },
};

const env: Record<string, string> = {
  "opening-greet-r0": "Task management tool for dev teams",
  "opening-summary-r0": "Yes",
  "purpose-confirmation-r0": "Looks good",
  "goal-seed-present-r0": "Confirmed",
  "goal-refinement-goal_001-clarify-0-question-r0": "Track task status so the team has visibility",
  "goals-confirmation-r0": "Looks good",
  "stakeholder-review-present-r0": "Looks right",
  "stakeholder-respondent-present-r0": "I'm the lead",
  "stakeholder-elaboration-stakeholder_001-0-question-r0": "Assigns tasks",
  "stakeholder-elaboration-stakeholder_002-0-question-r0": "Writes code",
  "stakeholder-followup-stakeholder_002-question-r0": "Speed",
  "stakeholders-confirmation-r0": "Looks good",
  "scope-seed-present-r0": "Confirmed",
  "scope-constraint-question-r0": "Small team",
  "scope-confirmation-r0": "Looks good",
  "validation-summary-present-r0": "All good",
};

describe("prompt budgets (standard configuration)", () => {
  it("per-phase user-prompt counts match documented budgets", async () => {
    const persistence = memoryPersistence();
    const counter: Counter = { total: 0, byPhase: {} };
    const resolver = countingResolver(llm, env, counter);

    await execute(persistence, session, resolver);

    // Minimal fixture: 1 goal, 2 SH (1 respondent), 1 scope item (0 ambiguous), 0 assumptions.
    // Budget per phase, per the standard configuration (both flags off):
    expect(counter.byPhase).toEqual({
      opening: 2,       // greeting + summary confirmation (brownfield skipped — high greenfield confidence)
      purpose: 1,       // PAM confirmation (opening filled all slots)
      goals: 3,         // seed-present + clarify + confirmation (why skipped — rationale captured in clarify)
      stakeholders: 6,  // review + respondent + elaborate×2 + follow-up×1 (assessment said needed) + confirmation
      scope: 3,         // review + constraint + confirmation (0 ambiguous)
      validation: 1,    // summary
      // assumptions: absent — phase gated off
    });
    expect(counter.total).toBe(16);
  });

  it("assumption phase is skipped when ENABLE_ASSUMPTIONS_PHASE is false", async () => {
    const persistence = memoryPersistence();
    const counter: Counter = { total: 0, byPhase: {} };
    const resolver = countingResolver(llm, env, counter);

    await execute(persistence, session, resolver);

    expect(counter.byPhase.assumptions).toBeUndefined();
  });

  it("negative goal stage is skipped when ENABLE_GOAL_NEGATIVE_STAGE is false", async () => {
    const persistence = memoryPersistence();
    const counter: Counter = { total: 0, byPhase: {} };
    const resolver = countingResolver(llm, env, counter);

    await execute(persistence, session, resolver);

    const state = persistence.load();
    expect(state).not.toBeNull();
    const ids = state!.entries.map((e) => e.id);
    expect(ids.some((id) => id.includes("negative"))).toBe(false);
  });
});
