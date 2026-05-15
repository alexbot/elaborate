import { describe, it, expect, vi } from "vitest";

vi.mock("../configuration.js", () => ({
  ENABLE_ASSUMPTIONS_PHASE: true,
  ENABLE_GOAL_NEGATIVE_STAGE: true,
  GOAL_DETAIL_CAP: 3,
  PRIMARY_SH_CAP: 5,
  SECONDARY_SH_CAP: 4,
  EXTERNAL_SH_CAP: 2,
  SCOPE_CONTRAST_CAP: 3,
}));

import { session, memoryPersistence, createAdapter, step, suspended } from "./helpers.js";

describe("validation phase", () => {
  const baseLlm: Record<string, unknown> = {
    // Opening
    "opening-greet-extraction-r0": {
      purpose: "task management for teams",
      stakeholders: ["team lead", "developer"],
      domainHints: ["project management"],
    },
    "opening-brownfield-screen": { greenfieldConfidence: 9 },
    "opening-confirmation-classification-0-r0": { approved: true, revisionRequested: null },
    // Purpose
    "purpose-initial-extraction": {
      purpose: "streamline task tracking for development teams",
      advantage: "simpler than Jira",
      measurement: "tasks completed per sprint",
      contradictions: [],
    },
    "purpose-confirmation-classification-0-r0": { approved: true, revisionRequested: null },
    // Goals
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
    "goal-refinement-goal_001-clarify-0-extraction-r0": { title: null, description: "Track task status", rationale: null, contradictions: [], waitingRoomItems: [] },
    "goal-refinement-goal_001-why-0-composition-r0": { question: "Why?", suggestions: ["B"] },
    "goal-refinement-goal_001-why-0-extraction-r0": { title: null, description: null, rationale: "Team visibility", contradictions: [], waitingRoomItems: [] },
    "goal-refinement-goal_001-negative-0-composition-r0": { question: "What if not?", suggestions: ["C"] },
    "goal-refinement-goal_001-negative-0-extraction-r0": { title: null, description: "Lose track", rationale: null, contradictions: [], waitingRoomItems: [] },
    "goal-discovery-composition-0": { question: "More?", suggestions: ["X"] },
    "goal-discovery-classification-0": { hasMoreGoals: false, newGoals: [], waitingRoomItems: [] },
    "goals-confirmation-classification-0-r0": { approved: true, revisionRequested: null },
    // Stakeholders
    "stakeholder-review-classification-r0": {
      updatedTypes: [],
      removedIds: [],
      newStakeholders: [],
    },
    "stakeholder-respondent-present-extraction-r0": { respondentId: "stakeholder_001" },
    "stakeholder-elaboration-stakeholder_001-0-composition-r0": { question: "Role?", suggestions: ["M"] },
    "stakeholder-elaboration-stakeholder_001-0-extraction-r0": {
      role: "Assigns tasks", concerns: ["Visibility"], contradictions: [], waitingRoomItems: [],
    },
    "stakeholder-elaboration-stakeholder_002-0-composition-r0": { question: "Dev?", suggestions: ["C"] },
    "stakeholder-elaboration-stakeholder_002-0-extraction-r0": {
      role: "Writes code", concerns: ["Clear specs"], contradictions: [], waitingRoomItems: [],
    },
    "stakeholder-perspective-stakeholder_002-composition-r0": {
      question: "As developer?", suggestions: ["Speed"],
    },
    "stakeholder-perspective-stakeholder_002-extraction-r0": {
      concerns: ["Fast builds"], contradictions: [], waitingRoomItems: [],
    },
    "stakeholders-confirmation-classification-0-r0": { approved: true, revisionRequested: null },
    // Scope
    "scope-seed-extraction": {
      inScope: [{ description: "Task board", relatedGoals: ["goal_001"] }],
      outOfScope: [],
      ambiguous: [],
    },
    "scope-seed-classification-r0": {
      confirmedInScope: ["scope_001"],
      confirmedOutOfScope: [],
      removedIds: [],
      newItems: [],
      waitingRoomItems: [],
    },
    "scope-constraint-composition-r0": { question: "Constraints?", suggestions: ["Time"] },
    "scope-constraint-extraction-r0": { constraints: [{ description: "Small team" }], waitingRoomItems: [] },
    "scope-contradiction-check": { contradictions: [], orphans: [] },
    "scope-confirmation-classification-0-r0": { approved: true, revisionRequested: null },
    // Assumptions
    "assumption-seed-extraction": {
      assumptions: [{ statement: "Team uses Git", type: "invariant", relatedGoals: ["goal_001"] }],
    },
    "assumption-seed-classification-r0": {
      confirmedIds: ["assumption_001"],
      removedIds: [],
      newAssumptions: [],
      waitingRoomItems: [],
    },
    "assumption-validation-assumption_001-composition-r0": { question: "Git?", suggestions: ["Yes"] },
    "assumption-validation-assumption_001-extraction-r0": { verdict: "validated", waitingRoomItems: [] },
    "assumptions-confirmation-classification-0-r0": { approved: true, revisionRequested: null },
    // Validation (defaults)
    "validation-consistency-check": { contradictions: [] },
    "validation-confirmation-classification-0-r0": { approved: true, revisionRequested: null },
  };

  /** Advance through all prerequisite phases to reach validation */
  async function advanceToValidation(llm: Record<string, unknown>) {
    const persistence = memoryPersistence();
    const mergedLlm = { ...baseLlm, ...llm };

    // Opening
    await step(persistence, session, createAdapter(mergedLlm));
    await step(persistence, session, createAdapter(mergedLlm, { "opening-greet-r0": "Task management tool for my dev team" }));
    await step(persistence, session, createAdapter(mergedLlm, { "opening-summary-r0": "Yes" }));
    // Purpose
    await step(persistence, session, createAdapter(mergedLlm, { "purpose-confirmation-r0": "Looks good" }));
    // Goals
    await step(persistence, session, createAdapter(mergedLlm, { "goal-seed-present-r0": "Good" }));
    await step(persistence, session, createAdapter(mergedLlm, { "goal-refinement-goal_001-clarify-0-question-r0": "Task status" }));
    await step(persistence, session, createAdapter(mergedLlm, { "goal-refinement-goal_001-why-0-question-r0": "Visibility" }));
    await step(persistence, session, createAdapter(mergedLlm, { "goal-refinement-goal_001-negative-0-question-r0": "Lose track" }));
    await step(persistence, session, createAdapter(mergedLlm, { "goal-discovery-question-0": "No more" }));
    await step(persistence, session, createAdapter(mergedLlm, { "goals-confirmation-r0": "Looks good" }));
    // Stakeholders
    await step(persistence, session, createAdapter(mergedLlm));
    await step(persistence, session, createAdapter(mergedLlm, { "stakeholder-review-present-r0": "Looks fine" }));
    await step(persistence, session, createAdapter(mergedLlm, { "stakeholder-respondent-present-r0": "I'm the lead" }));
    await step(persistence, session, createAdapter(mergedLlm, { "stakeholder-elaboration-stakeholder_001-0-question-r0": "I assign tasks" }));
    await step(persistence, session, createAdapter(mergedLlm, { "stakeholder-elaboration-stakeholder_002-0-question-r0": "They code" }));
    await step(persistence, session, createAdapter(mergedLlm, { "stakeholder-perspective-stakeholder_002-question-r0": "Fast builds" }));
    await step(persistence, session, createAdapter(mergedLlm, { "stakeholders-confirmation-r0": "Looks good" }));
    // Scope
    await step(persistence, session, createAdapter(mergedLlm, { "scope-seed-present-r0": "Good" }));
    await step(persistence, session, createAdapter(mergedLlm, { "scope-constraint-question-r0": "Small team" }));
    await step(persistence, session, createAdapter(mergedLlm, { "scope-confirmation-r0": "Looks good" }));
    // Assumptions
    await step(persistence, session, createAdapter(mergedLlm, { "assumption-seed-present-r0": "Good" }));
    await step(persistence, session, createAdapter(mergedLlm, { "assumption-validation-assumption_001-question-r0": "Yes definitely" }));
    await step(persistence, session, createAdapter(mergedLlm, { "assumptions-confirmation-r0": "Looks good" }));
    // Now in validation phase

    return { persistence, llm: mergedLlm };
  }

  describe("consistency check", () => {
    it("adds findings from cross-artifact contradictions", async () => {
      const { persistence, llm } = await advanceToValidation({
        "validation-consistency-check": {
          contradictions: [
            { description: "Goal 'Track tasks' references removed stakeholder" },
          ],
        },
      });

      const prompt = await suspended(persistence, session, createAdapter(llm));
      expect(prompt.id).toBe("validation-summary-present-r0");
      expect((prompt as { request: { message: string } }).request.message).toContain(
        "Goal 'Track tasks' references removed stakeholder",
      );
    });

    it("adds no findings when no contradictions found", async () => {
      const { persistence, llm } = await advanceToValidation({
        "validation-consistency-check": { contradictions: [] },
      });

      const prompt = await suspended(persistence, session, createAdapter(llm));
      expect(prompt.id).toBe("validation-summary-present-r0");
      // No "validation" phase findings in the message (only prior phase findings if any)
      const msg = (prompt as { request: { message: string } }).request.message;
      expect(msg).not.toContain("[validation]");
    });
  });

  describe("summary presentation", () => {
    it("includes all artifact types", async () => {
      const { persistence, llm } = await advanceToValidation({});

      const prompt = await suspended(persistence, session, createAdapter(llm));
      expect(prompt.id).toBe("validation-summary-present-r0");
      const msg = (prompt as { request: { message: string } }).request.message;
      expect(msg).toContain("Purpose");
      expect(msg).toContain("Goals");
      expect(msg).toContain("Stakeholders");
      expect(msg).toContain("Scope");
      expect(msg).toContain("Assumptions");
    });

    it("classifies waiting room items as residual and shows in summary", async () => {
      const { persistence, llm } = await advanceToValidation({
        // Add a waiting room item via assumptions seed
        "assumption-seed-classification-r0": {
          confirmedIds: ["assumption_001"],
          removedIds: [],
          newAssumptions: [],
          waitingRoomItems: [{ content: "Maybe add reporting feature" }],
        },
        // Classify-and-route step marks the item as residual
        "validation-wr-classify": {
          routed: [{ id: "waiting_001", target: "residual", content: "Maybe add reporting feature", reason: "too vague to classify" }],
        },
      });

      const prompt = await suspended(persistence, session, createAdapter(llm));
      const msg = (prompt as { request: { message: string } }).request.message;
      expect(msg).toContain("Residual");
      expect(msg).toContain("Maybe add reporting feature");
    });
  });

  describe("confirmation", () => {
    it("completes workflow on user confirmation", async () => {
      const { persistence, llm } = await advanceToValidation({
        "validation-confirmation-classification-0-r0": { approved: true, revisionRequested: null },
      });

      const done = await step(
        persistence, session,
        createAdapter(llm, { "validation-summary-present-r0": "Confirmed" }),
      );
      expect(done).toBe(true);
      expect(persistence.current()!.status).toBe("completed");
    });

    it("completes workflow when user has concerns", async () => {
      const { persistence, llm } = await advanceToValidation({
        "validation-confirmation-classification-0-r0": { approved: false, revisionRequested: "Missing key stakeholder analysis" },
      });

      const done = await step(
        persistence, session,
        createAdapter(llm, { "validation-summary-present-r0": "I have concerns about the stakeholder analysis" }),
      );
      expect(done).toBe(true);
      expect(persistence.current()!.status).toBe("completed");
    });
  });
});
