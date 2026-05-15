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

describe("assumptions phase", () => {
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
  };

  /** Advance through all prerequisite phases to reach assumptions */
  async function advanceToAssumptions(llm: Record<string, unknown>) {
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
    // Now in assumptions phase

    return { persistence, llm: mergedLlm };
  }

  describe("seed extraction", () => {
    it("presents assumptions from conversation", async () => {
      const { persistence, llm } = await advanceToAssumptions({
        "assumption-seed-extraction": {
          assumptions: [
            { statement: "Team has internet access", type: "invariant", relatedGoals: ["goal_001"] },
            { statement: "Developers prefer simple tools", type: "hypothesis", relatedGoals: ["goal_001"] },
          ],
        },
      });

      const prompt = await suspended(persistence, session, createAdapter(llm));
      expect(prompt.id).toBe("assumption-seed-present-r0");
      if (prompt.type === "prompt") {
        expect(prompt.request.message).toContain("Team has internet access");
        expect(prompt.request.message).toContain("Developers prefer simple tools");
        expect(prompt.request.message).toContain("invariant");
        expect(prompt.request.message).toContain("hypothesis");
      }
    });

    it("shows empty-state message when no assumptions found", async () => {
      const { persistence, llm } = await advanceToAssumptions({
        "assumption-seed-extraction": { assumptions: [] },
      });

      const prompt = await suspended(persistence, session, createAdapter(llm));
      expect(prompt.id).toBe("assumption-seed-present-r0");
      if (prompt.type === "prompt") {
        expect(prompt.request.message).toContain("haven't identified any implicit assumptions");
      }
    });

    it("removes assumptions rejected during seed review", async () => {
      const { persistence, llm } = await advanceToAssumptions({
        "assumption-seed-extraction": {
          assumptions: [
            { statement: "Team has internet", type: "invariant" },
            { statement: "Budget is unlimited", type: "hypothesis" },
          ],
        },
        "assumption-seed-classification-r0": {
          confirmedIds: ["assumption_001"],
          removedIds: ["assumption_002"],
          newAssumptions: [],
          waitingRoomItems: [],
        },
        "assumption-validation-assumption_001-composition-r0": { question: "Internet?", suggestions: ["Yes"] },
      });

      const prompt = await suspended(
        persistence, session,
        createAdapter(llm, { "assumption-seed-present-r0": "Remove budget one" }),
      );
      // Should proceed to validate assumption_001 (assumption_002 was removed)
      expect(prompt.id).toBe("assumption-validation-assumption_001-question-r0");
    });

    it("adds new assumptions from seed response", async () => {
      const { persistence, llm } = await advanceToAssumptions({
        "assumption-seed-extraction": { assumptions: [] },
        "assumption-seed-classification-r0": {
          confirmedIds: [],
          removedIds: [],
          newAssumptions: [{ statement: "Users have smartphones", type: "hypothesis", relatedGoals: ["goal_001"] }],
          waitingRoomItems: [],
        },
        "assumption-validation-assumption_001-composition-r0": { question: "Smartphones?", suggestions: ["Yes"] },
      });

      const prompt = await suspended(
        persistence, session,
        createAdapter(llm, { "assumption-seed-present-r0": "Also assume users have smartphones" }),
      );
      expect(prompt.id).toBe("assumption-validation-assumption_001-question-r0");
    });
  });

  describe("waiting room drain", () => {
    it("drains matching waiting room items during seed", async () => {
      // Scope extraction routes "sounds like assumption" to waiting room
      const { persistence, llm } = await advanceToAssumptions({
        "scope-constraint-extraction-r0": {
          constraints: [{ description: "Small team" }],
          waitingRoomItems: [{ content: "Team has technical expertise" }],
        },
        "assumption-seed-extraction": {
          assumptions: [{ statement: "Team has technical expertise", type: "invariant" }],
          drainedWaitingRoomIds: ["waiting_001"],
        },
        "assumption-seed-classification-r0": {
          confirmedIds: ["assumption_001"],
          removedIds: [],
          newAssumptions: [],
          waitingRoomItems: [],
        },
        "assumption-validation-assumption_001-composition-r0": { question: "Tech expertise?", suggestions: ["Yes"] },
        "assumption-validation-assumption_001-extraction-r0": { verdict: "validated", waitingRoomItems: [] },
        "assumptions-confirmation-classification-0-r0": { approved: true, revisionRequested: null },
      });

      await step(persistence, session, createAdapter(llm, { "assumption-seed-present-r0": "Good" }));
      await step(persistence, session, createAdapter(llm, { "assumption-validation-assumption_001-question-r0": "Yes" }));

      // Reach confirmation — the waiting room item should have been drained
      const prompt = await suspended(persistence, session, createAdapter(llm));
      expect(prompt.id).toBe("assumptions-confirmation-r0");
      // The confirm message should show the assumption but NOT as a waiting room item
      if (prompt.type === "prompt") {
        expect(prompt.request.message).toContain("Team has technical expertise");
        expect(prompt.request.message).toContain("validated");
      }
    });
  });

  describe("gap-fill", () => {
    it("triggers SAST question when seed produces no assumptions", async () => {
      const { persistence, llm } = await advanceToAssumptions({
        "assumption-seed-extraction": { assumptions: [] },
        "assumption-seed-classification-r0": {
          confirmedIds: [],
          removedIds: [],
          newAssumptions: [],
          waitingRoomItems: [],
        },
        "assumption-gap-fill-composition-r0": {
          question: "What needs to be true for your task tracking goals to work?",
          suggestions: ["Team uses digital tools", "Internet always available"],
        },
      });

      // Seed present (empty) → classify → gap-fill
      const prompt = await suspended(
        persistence, session,
        createAdapter(llm, { "assumption-seed-present-r0": "Not sure" }),
      );
      expect(prompt.id).toBe("assumption-gap-fill-question-r0");
      if (prompt.type === "prompt") {
        expect(prompt.request.message).toContain("What needs to be true");
      }
    });

    it("extracts assumptions from gap-fill response", async () => {
      const { persistence, llm } = await advanceToAssumptions({
        "assumption-seed-extraction": { assumptions: [] },
        "assumption-seed-classification-r0": {
          confirmedIds: [],
          removedIds: [],
          newAssumptions: [],
          waitingRoomItems: [],
        },
        "assumption-gap-fill-composition-r0": { question: "What needs to be true?", suggestions: ["A"] },
        "assumption-gap-fill-extraction-r0": {
          assumptions: [{ statement: "Team adopts new tools quickly", type: "hypothesis", relatedGoals: ["goal_001"] }],
          waitingRoomItems: [],
        },
        "assumption-validation-assumption_001-composition-r0": { question: "Quick adoption?", suggestions: ["Yes"] },
      });

      await step(persistence, session, createAdapter(llm, { "assumption-seed-present-r0": "Not sure" }));
      const prompt = await suspended(
        persistence, session,
        createAdapter(llm, { "assumption-gap-fill-question-r0": "We assume team adapts quickly" }),
      );
      expect(prompt.id).toBe("assumption-validation-assumption_001-question-r0");
    });

    it("skips gap-fill when seed produced assumptions", async () => {
      const { persistence, llm } = await advanceToAssumptions({
        "assumption-seed-extraction": {
          assumptions: [{ statement: "Team uses Git", type: "invariant" }],
        },
        "assumption-seed-classification-r0": {
          confirmedIds: ["assumption_001"],
          removedIds: [],
          newAssumptions: [],
          waitingRoomItems: [],
        },
        "assumption-validation-assumption_001-composition-r0": { question: "Git?", suggestions: ["Yes"] },
      });

      // After seed present → classify → goes straight to validate (no gap-fill)
      const prompt = await suspended(
        persistence, session,
        createAdapter(llm, { "assumption-seed-present-r0": "Looks right" }),
      );
      expect(prompt.id).toBe("assumption-validation-assumption_001-question-r0");
    });

    it("retries gap-fill on clarification request", async () => {
      const { persistence, llm } = await advanceToAssumptions({
        "assumption-seed-extraction": { assumptions: [] },
        "assumption-seed-classification-r0": {
          confirmedIds: [],
          removedIds: [],
          newAssumptions: [],
          waitingRoomItems: [],
        },
        "assumption-gap-fill-composition-r0": {
          question: "What needs to be true for your goals to work?",
          suggestions: ["Team adapts", "Budget sufficient"],
        },
        // First extraction: clarification request
        "assumption-gap-fill-extraction-r0": {
          responseClass: "confusion",
          responseInterpretation: "confused",
          assumptions: [],
          waitingRoomItems: [],
        },
        // Retry with rephrase
        "assumption-gap-fill-composition-r1": {
          question: "What are you counting on being true?",
          suggestions: ["Users want this", "Tech works"],
        },
        "assumption-gap-fill-extraction-r1": {
          responseClass: "answer",
          responseInterpretation: "understood now",
          assumptions: [{ statement: "Users want task tracking", type: "hypothesis", relatedGoals: ["goal_001"] }],
          waitingRoomItems: [],
        },
        "assumption-validation-assumption_001-composition-r0": { question: "Users want it?", suggestions: ["Yes"] },
      });

      await step(persistence, session, createAdapter(llm, { "assumption-seed-present-r0": "Not sure" }));
      // First attempt: user asks for clarification
      const retryPrompt = await suspended(
        persistence, session,
        createAdapter(llm, { "assumption-gap-fill-question-r0": "What do you mean by assumption?" }),
      );
      // Should get rephrased question (r1)
      expect(retryPrompt.id).toBe("assumption-gap-fill-question-r1");

      // Second attempt: user answers
      const nextPrompt = await suspended(
        persistence, session,
        createAdapter(llm, { "assumption-gap-fill-question-r1": "We count on users wanting task tracking" }),
      );
      // Should proceed to validation
      expect(nextPrompt.id).toBe("assumption-validation-assumption_001-question-r0");
    });

    it("retries gap-fill on divergence and parks content", async () => {
      const { persistence, llm } = await advanceToAssumptions({
        "assumption-seed-extraction": { assumptions: [] },
        "assumption-seed-classification-r0": {
          confirmedIds: [],
          removedIds: [],
          newAssumptions: [],
          waitingRoomItems: [],
        },
        "assumption-gap-fill-composition-r0": {
          question: "What needs to be true?",
          suggestions: ["A"],
        },
        // First extraction: off-topic
        "assumption-gap-fill-extraction-r0": {
          responseClass: "off_topic",
          responseInterpretation: "off topic",
          assumptions: [],
          waitingRoomItems: [{ content: "want mobile app" }],
        },
        // Retry
        "assumption-gap-fill-composition-r1": {
          question: "Back to assumptions — what must be true?",
          suggestions: ["B"],
        },
        "assumption-gap-fill-extraction-r1": {
          responseClass: "answer",
          responseInterpretation: "answered",
          assumptions: [{ statement: "Team has capacity", type: "hypothesis" }],
          waitingRoomItems: [],
        },
        "assumption-validation-assumption_001-composition-r0": { question: "Capacity?", suggestions: ["Yes"] },
      });

      await step(persistence, session, createAdapter(llm, { "assumption-seed-present-r0": "Hmm" }));
      // Off-topic response
      const retryPrompt = await suspended(
        persistence, session,
        createAdapter(llm, { "assumption-gap-fill-question-r0": "We also need a mobile app" }),
      );
      expect(retryPrompt.id).toBe("assumption-gap-fill-question-r1");
      if (retryPrompt.type === "prompt") {
        expect(retryPrompt.request.message).toContain("noted");
      }

      // On-topic response
      const nextPrompt = await suspended(
        persistence, session,
        createAdapter(llm, { "assumption-gap-fill-question-r1": "Team has capacity to build" }),
      );
      expect(nextPrompt.id).toBe("assumption-validation-assumption_001-question-r0");
    });
  });

  describe("validation", () => {
    it("marks assumption as validated when user confirms", async () => {
      const { persistence, llm } = await advanceToAssumptions({
        "assumption-seed-extraction": {
          assumptions: [{ statement: "Team uses Git", type: "invariant", relatedGoals: ["goal_001"] }],
        },
        "assumption-seed-classification-r0": {
          confirmedIds: ["assumption_001"],
          removedIds: [],
          newAssumptions: [],
          waitingRoomItems: [],
        },
        "assumption-validation-assumption_001-composition-r0": { question: "Does the team use Git?", suggestions: ["Yes", "No"] },
        "assumption-validation-assumption_001-extraction-r0": { verdict: "validated", waitingRoomItems: [] },
        "assumptions-confirmation-classification-0-r0": { approved: true, revisionRequested: null },
      });

      await step(persistence, session, createAdapter(llm, { "assumption-seed-present-r0": "Good" }));
      await step(persistence, session, createAdapter(llm, { "assumption-validation-assumption_001-question-r0": "Yes we use Git" }));

      const prompt = await suspended(persistence, session, createAdapter(llm));
      expect(prompt.id).toBe("assumptions-confirmation-r0");
      if (prompt.type === "prompt") {
        expect(prompt.request.message).toContain("validated");
        expect(prompt.request.message).not.toContain("FLAGGED");
      }
    });

    it("marks assumption as flagged when user says flagged", async () => {
      const { persistence, llm } = await advanceToAssumptions({
        "assumption-seed-extraction": {
          assumptions: [{ statement: "Budget sufficient", type: "hypothesis", relatedGoals: ["goal_001"] }],
        },
        "assumption-seed-classification-r0": {
          confirmedIds: ["assumption_001"],
          removedIds: [],
          newAssumptions: [],
          waitingRoomItems: [],
        },
        "assumption-validation-assumption_001-composition-r0": { question: "Is budget sufficient?", suggestions: ["Yes", "No"] },
        "assumption-validation-assumption_001-extraction-r0": { verdict: "flagged", waitingRoomItems: [] },
        "assumptions-confirmation-classification-0-r0": { approved: true, revisionRequested: null },
      });

      await step(persistence, session, createAdapter(llm, { "assumption-seed-present-r0": "Good" }));
      await step(persistence, session, createAdapter(llm, { "assumption-validation-assumption_001-question-r0": "No, budget is tight" }));

      const prompt = await suspended(persistence, session, createAdapter(llm));
      expect(prompt.id).toBe("assumptions-confirmation-r0");
      if (prompt.type === "prompt") {
        expect(prompt.request.message).toContain("FLAGGED");
        // Should also show finding about at-risk goals
        expect(prompt.request.message).toContain("could not be validated");
      }
    });

    it("probes then flags when user is unsure", async () => {
      const { persistence, llm } = await advanceToAssumptions({
        "assumption-seed-extraction": {
          assumptions: [{ statement: "Users prefer web apps", type: "hypothesis", relatedGoals: ["goal_001"] }],
        },
        "assumption-seed-classification-r0": {
          confirmedIds: ["assumption_001"],
          removedIds: [],
          newAssumptions: [],
          waitingRoomItems: [],
        },
        "assumption-validation-assumption_001-composition-r0": { question: "Web preference?", suggestions: ["Yes", "Not sure"] },
        "assumption-validation-assumption_001-extraction-r0": { verdict: "unsure", waitingRoomItems: [] },
        "assumption-probe-assumption_001-composition-r0": {
          question: "What would change if users actually prefer native apps?",
          suggestions: ["Need mobile development", "Different tech stack"],
        },
        "assumption-probe-assumption_001-extraction-r0": { impact: "Would need native mobile development", waitingRoomItems: [] },
        "assumptions-confirmation-classification-0-r0": { approved: true, revisionRequested: null },
      });

      await step(persistence, session, createAdapter(llm, { "assumption-seed-present-r0": "Good" }));
      // Validate → unsure → probe
      const probePrompt = await suspended(
        persistence, session,
        createAdapter(llm, { "assumption-validation-assumption_001-question-r0": "I'm not sure about that" }),
      );
      expect(probePrompt.id).toBe("assumption-probe-assumption_001-question-r0");
      if (probePrompt.type === "prompt") {
        expect(probePrompt.request.message).toContain("What would change");
      }

      // After probe → flagged → confirm
      await step(
        persistence, session,
        createAdapter(llm, { "assumption-probe-assumption_001-question-r0": "We might need native apps" }),
      );
      const confirmPrompt = await suspended(persistence, session, createAdapter(llm));
      expect(confirmPrompt.id).toBe("assumptions-confirmation-r0");
      if (confirmPrompt.type === "prompt") {
        expect(confirmPrompt.request.message).toContain("FLAGGED");
      }
    });
  });

  describe("findings", () => {
    it("generates findings for flagged assumptions with goal links", async () => {
      const { persistence, llm } = await advanceToAssumptions({
        "assumption-seed-extraction": {
          assumptions: [{ statement: "API is stable", type: "invariant", relatedGoals: ["goal_001"] }],
        },
        "assumption-seed-classification-r0": {
          confirmedIds: ["assumption_001"],
          removedIds: [],
          newAssumptions: [],
          waitingRoomItems: [],
        },
        "assumption-validation-assumption_001-composition-r0": { question: "API stable?", suggestions: ["Yes"] },
        "assumption-validation-assumption_001-extraction-r0": { verdict: "flagged", waitingRoomItems: [] },
        "assumptions-confirmation-classification-0-r0": { approved: true, revisionRequested: null },
      });

      await step(persistence, session, createAdapter(llm, { "assumption-seed-present-r0": "OK" }));
      await step(persistence, session, createAdapter(llm, { "assumption-validation-assumption_001-question-r0": "Actually no" }));

      const prompt = await suspended(persistence, session, createAdapter(llm));
      expect(prompt.id).toBe("assumptions-confirmation-r0");
      if (prompt.type === "prompt") {
        expect(prompt.request.message).toContain("API is stable");
        expect(prompt.request.message).toContain("could not be validated");
        expect(prompt.request.message).toContain("goal_001");
      }
    });
  });

  describe("confirmation", () => {
    async function advanceToConfirmation(extraLlm: Record<string, unknown> = {}) {
      return advanceToAssumptions({
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
        ...extraLlm,
      });
    }

    async function driveToConfirmation(
      persistence: ReturnType<typeof memoryPersistence>,
      llm: Record<string, unknown>,
    ) {
      await step(persistence, session, createAdapter(llm, { "assumption-seed-present-r0": "Good" }));
      await step(persistence, session, createAdapter(llm, { "assumption-validation-assumption_001-question-r0": "Yes" }));
    }

    it("advances to validation when assumptions confirmed", async () => {
      const { persistence, llm } = await advanceToConfirmation({
        "assumptions-confirmation-classification-0-r0": { approved: true, revisionRequested: null },
        "validation-consistency-check": { contradictions: [] },
      });
      await driveToConfirmation(persistence, llm);

      await step(
        persistence, session,
        createAdapter(llm, { "assumptions-confirmation-r0": "Looks good" }),
      );
      // Pipeline continues into validation — suspends at summary presentation
      const prompt = await suspended(persistence, session, createAdapter(llm));
      expect(prompt.id).toBe("validation-summary-present-r0");
    });

    it("presents full assumptions summary at confirmation", async () => {
      const { persistence, llm } = await advanceToConfirmation({
        "assumptions-confirmation-classification-0-r0": { approved: true, revisionRequested: null },
      });
      await driveToConfirmation(persistence, llm);

      const prompt = await suspended(persistence, session, createAdapter(llm));
      expect(prompt.id).toBe("assumptions-confirmation-r0");
      if (prompt.type === "prompt") {
        expect(prompt.request.message).toContain("Team uses Git");
        expect(prompt.request.message).toContain("invariant");
        expect(prompt.request.message).toContain("validated");
      }
    });

    it("extracts revision from rejection and completes", async () => {
      const { persistence, llm } = await advanceToConfirmation({
        "assumptions-confirmation-classification-0-r0": { approved: false, revisionRequested: "Add performance assumption" },
        "assumptions-revision-r0": { responseInterpretation: "wants performance assumption", newAssumptions: [{ statement: "System handles 1000 users", type: "hypothesis", relatedGoals: [] }], removedIds: [] },
        "validation-consistency-check-r0": { contradictions: [] },
      });
      await driveToConfirmation(persistence, llm);

      const prompt = await suspended(
        persistence, session,
        createAdapter(llm, { "assumptions-confirmation-r0": "Add performance assumption" }),
      );
      expect(prompt.id).toBe("validation-summary-present-r0");
    });

    it("does not change statuses on approval", async () => {
      // Validated assumptions stay validated, flagged stay flagged
      const { persistence, llm } = await advanceToAssumptions({
        "assumption-seed-extraction": {
          assumptions: [
            { statement: "Team uses Git", type: "invariant", relatedGoals: ["goal_001"] },
            { statement: "Budget enough", type: "hypothesis", relatedGoals: [] },
          ],
        },
        "assumption-seed-classification-r0": {
          confirmedIds: ["assumption_001", "assumption_002"],
          removedIds: [],
          newAssumptions: [],
          waitingRoomItems: [],
        },
        "assumption-validation-assumption_001-composition-r0": { question: "Git?", suggestions: ["Yes"] },
        "assumption-validation-assumption_001-extraction-r0": { verdict: "validated", waitingRoomItems: [] },
        "assumption-validation-assumption_002-composition-r0": { question: "Budget?", suggestions: ["Yes"] },
        "assumption-validation-assumption_002-extraction-r0": { verdict: "flagged", waitingRoomItems: [] },
        "assumptions-confirmation-classification-0-r0": { approved: true, revisionRequested: null },
      });

      await step(persistence, session, createAdapter(llm, { "assumption-seed-present-r0": "Good" }));
      await step(persistence, session, createAdapter(llm, { "assumption-validation-assumption_001-question-r0": "Yes" }));
      await step(persistence, session, createAdapter(llm, { "assumption-validation-assumption_002-question-r0": "Not sure" }));

      const prompt = await suspended(persistence, session, createAdapter(llm));
      expect(prompt.id).toBe("assumptions-confirmation-r0");
      if (prompt.type === "prompt") {
        // Both statuses preserved
        expect(prompt.request.message).toContain("validated");
        expect(prompt.request.message).toContain("FLAGGED");
      }
    });

    it("handles empty assumptions gracefully", async () => {
      const { persistence, llm } = await advanceToAssumptions({
        "assumption-seed-extraction": { assumptions: [] },
        "assumption-seed-classification-r0": {
          confirmedIds: [],
          removedIds: [],
          newAssumptions: [],
          waitingRoomItems: [],
        },
        "assumption-gap-fill-composition-r0": { question: "What needs to be true?", suggestions: ["A"] },
        "assumption-gap-fill-extraction-r0": { assumptions: [], waitingRoomItems: [] },
        "assumptions-confirmation-classification-0-r0": { approved: true, revisionRequested: null },
      });

      await step(persistence, session, createAdapter(llm, { "assumption-seed-present-r0": "No idea" }));
      await step(persistence, session, createAdapter(llm, { "assumption-gap-fill-question-r0": "Nothing comes to mind" }));

      const prompt = await suspended(persistence, session, createAdapter(llm));
      expect(prompt.id).toBe("assumptions-confirmation-r0");
      if (prompt.type === "prompt") {
        expect(prompt.request.message).toContain("No assumptions were identified");
      }
    });
  });

  describe("buildFullContext integration", () => {
    it("includes assumptions in context for confirmation prompts", async () => {
      const { persistence, llm } = await advanceToAssumptions({
        "assumption-seed-extraction": {
          assumptions: [{ statement: "Team has CI/CD", type: "invariant", relatedGoals: ["goal_001"] }],
        },
        "assumption-seed-classification-r0": {
          confirmedIds: ["assumption_001"],
          removedIds: [],
          newAssumptions: [],
          waitingRoomItems: [],
        },
        "assumption-validation-assumption_001-composition-r0": { question: "CI/CD?", suggestions: ["Yes"] },
        "assumption-validation-assumption_001-extraction-r0": { verdict: "validated", waitingRoomItems: [] },
        "assumptions-confirmation-classification-0-r0": { approved: true, revisionRequested: null },
      });

      await step(persistence, session, createAdapter(llm, { "assumption-seed-present-r0": "Good" }));
      await step(persistence, session, createAdapter(llm, { "assumption-validation-assumption_001-question-r0": "Yes" }));

      const prompt = await suspended(persistence, session, createAdapter(llm));
      expect(prompt.id).toBe("assumptions-confirmation-r0");
      if (prompt.type === "prompt") {
        expect(prompt.request.message).toContain("Team has CI/CD");
      }
    });
  });
});
