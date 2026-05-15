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

describe("scope phase", () => {
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
  };

  /** Advance through opening + purpose + goals + stakeholders to reach scope */
  async function advanceToScope(llm: Record<string, unknown>) {
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
    await step(persistence, session, createAdapter(mergedLlm)); // review:present
    await step(persistence, session, createAdapter(mergedLlm, { "stakeholder-review-present-r0": "Looks fine" })); // respondent
    await step(persistence, session, createAdapter(mergedLlm, { "stakeholder-respondent-present-r0": "I'm the lead" })); // elaborate SH1
    await step(persistence, session, createAdapter(mergedLlm, { "stakeholder-elaboration-stakeholder_001-0-question-r0": "I assign tasks" })); // elaborate SH2
    await step(persistence, session, createAdapter(mergedLlm, { "stakeholder-elaboration-stakeholder_002-0-question-r0": "They code" })); // perspective
    await step(persistence, session, createAdapter(mergedLlm, { "stakeholder-perspective-stakeholder_002-question-r0": "Fast builds" })); // confirm
    await step(persistence, session, createAdapter(mergedLlm, { "stakeholders-confirmation-r0": "Looks good" }));
    // Now in scope phase

    return { persistence, llm: mergedLlm };
  }

  describe("seed extraction", () => {
    it("presents scope candidates from conversation", async () => {
      const { persistence, llm } = await advanceToScope({
        "scope-seed-extraction": {
          inScope: [{ description: "Task tracking dashboard", relatedGoals: ["goal_001"] }],
          outOfScope: [{ description: "Payroll integration", reason: "Different domain" }],
          ambiguous: [],
        },
      });

      const prompt = await suspended(persistence, session, createAdapter(llm));
      expect(prompt.id).toBe("scope-seed-present-r0");
      if (prompt.type === "prompt") {
        expect(prompt.request.message).toContain("Task tracking dashboard");
        expect(prompt.request.message).toContain("Payroll integration");
        expect(prompt.request.message).toContain("In scope");
        expect(prompt.request.message).toContain("Out of scope");
      }
    });

    it("shows empty-state message when no seeds found", async () => {
      const { persistence, llm } = await advanceToScope({
        "scope-seed-extraction": {
          inScope: [],
          outOfScope: [],
          ambiguous: [],
        },
      });

      const prompt = await suspended(persistence, session, createAdapter(llm));
      expect(prompt.id).toBe("scope-seed-present-r0");
      if (prompt.type === "prompt") {
        expect(prompt.request.message).toContain("scope boundaries");
      }
    });

    it("removes items rejected during seed review", async () => {
      const { persistence, llm } = await advanceToScope({
        "scope-seed-extraction": {
          inScope: [{ description: "Task tracking", relatedGoals: ["goal_001"] }],
          outOfScope: [{ description: "Email integration" }],
          ambiguous: [],
        },
        "scope-seed-classification-r0": {
          confirmedInScope: [],
          confirmedOutOfScope: [],
          removedIds: ["scope_002"],
          newItems: [],
          waitingRoomItems: [],
        },
        "scope-constraint-composition-r0": { question: "Constraints?", suggestions: ["Budget"] },
      });

      // Seed present → classify → constraints
      const prompt = await suspended(
        persistence, session,
        createAdapter(llm, { "scope-seed-present-r0": "Remove email integration" }),
      );
      expect(prompt.id).toBe("scope-constraint-question-r0");
    });

    it("adds new items from seed response", async () => {
      const { persistence, llm } = await advanceToScope({
        "scope-seed-extraction": {
          inScope: [],
          outOfScope: [],
          ambiguous: [],
        },
        "scope-seed-classification-r0": {
          confirmedInScope: [],
          confirmedOutOfScope: [],
          removedIds: [],
          newItems: [
            { description: "Kanban board", classification: "in" },
            { description: "Video conferencing", classification: "out" },
          ],
          waitingRoomItems: [],
        },
        "scope-constraint-composition-r0": { question: "Constraints?", suggestions: ["Time"] },
      });

      const prompt = await suspended(
        persistence, session,
        createAdapter(llm, { "scope-seed-present-r0": "Add kanban board in scope, video conferencing out" }),
      );
      expect(prompt.id).toBe("scope-constraint-question-r0");
    });
  });

  describe("constraints", () => {
    it("captures constraints after seed review", async () => {
      const { persistence, llm } = await advanceToScope({
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
        "scope-constraint-composition-r0": {
          question: "What constraints does your project have?",
          suggestions: ["Must run on mobile", "Small team of 2"],
        },
        "scope-constraint-extraction-r0": {
          constraints: [{ description: "Must support iOS and Android" }],
          waitingRoomItems: [],
        },
        "scope-contradiction-check": { contradictions: [], orphans: [] },
        "scope-confirmation-classification-0-r0": { approved: true, revisionRequested: null },
      });

      await step(persistence, session, createAdapter(llm, { "scope-seed-present-r0": "Good" }));
      const prompt = await suspended(persistence, session, createAdapter(llm));
      expect(prompt.id).toBe("scope-constraint-question-r0");

      // Answer constraints → contradiction check → confirm
      const confirmPrompt = await suspended(
        persistence, session,
        createAdapter(llm, { "scope-constraint-question-r0": "Must support mobile" }),
      );
      expect(confirmPrompt.id).toBe("scope-confirmation-r0");
      if (confirmPrompt.type === "prompt") {
        expect(confirmPrompt.request.message).toContain("Must support iOS and Android");
        expect(confirmPrompt.request.message).toContain("Constraints");
      }
    });

    it("retries on off-topic divergence and parks content", async () => {
      const { persistence, llm } = await advanceToScope({
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
        "scope-constraint-composition-r0": {
          question: "What constraints does your project have?",
          suggestions: ["Must run on mobile"],
        },
        // First extraction: off-topic (responseClass: other)
        "scope-constraint-extraction-r0": {
          responseClass: "off_topic",
          responseInterpretation: "off topic",
          constraints: [],
          waitingRoomItems: [{ content: "dark mode feature" }],
        },
        // Retry composition + extraction: on-topic
        "scope-constraint-composition-r1": {
          question: "Coming back to constraints — any limits?",
          suggestions: ["Budget", "Timeline"],
        },
        "scope-constraint-extraction-r1": {
          responseClass: "answer",
          responseInterpretation: "budget constraint",
          constraints: [{ description: "Limited budget of $10k" }],
          waitingRoomItems: [],
        },
        "scope-contradiction-check": { contradictions: [], orphans: [] },
        "scope-confirmation-classification-0-r0": { approved: true, revisionRequested: null },
      });

      await step(persistence, session, createAdapter(llm, { "scope-seed-present-r0": "Good" }));
      // First attempt: user goes off-topic
      const retryPrompt = await suspended(
        persistence, session,
        createAdapter(llm, { "scope-constraint-question-r0": "Oh and we need dark mode" }),
      );
      // Should get the retry question (r1) with redirect prefix
      expect(retryPrompt.id).toBe("scope-constraint-question-r1");
      if (retryPrompt.type === "prompt") {
        expect(retryPrompt.request.message).toContain("noted");
      }

      // Second attempt: user answers on-topic
      const confirmPrompt = await suspended(
        persistence, session,
        createAdapter(llm, { "scope-constraint-question-r1": "Budget is $10k" }),
      );
      expect(confirmPrompt.id).toBe("scope-confirmation-r0");
      if (confirmPrompt.type === "prompt") {
        expect(confirmPrompt.request.message).toContain("Limited budget");
      }
    });

    it("returns defaults when all retries exhausted", async () => {
      const { persistence, llm } = await advanceToScope({
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
        "scope-constraint-extraction-r0": { responseClass: "off_topic", responseInterpretation: "", constraints: [], waitingRoomItems: [] },
        "scope-constraint-composition-r1": { question: "Constraints?", suggestions: ["Time"] },
        "scope-constraint-extraction-r1": { responseClass: "off_topic", responseInterpretation: "", constraints: [], waitingRoomItems: [] },
        "scope-constraint-composition-r2": { question: "Constraints?", suggestions: ["Time"] },
        "scope-constraint-extraction-r2": { responseClass: "off_topic", responseInterpretation: "", constraints: [], waitingRoomItems: [] },
        "scope-contradiction-check": { contradictions: [], orphans: [] },
        "scope-confirmation-classification-0-r0": { approved: true, revisionRequested: null },
      });

      await step(persistence, session, createAdapter(llm, { "scope-seed-present-r0": "Good" }));
      await step(persistence, session, createAdapter(llm, { "scope-constraint-question-r0": "off topic" }));
      await step(persistence, session, createAdapter(llm, { "scope-constraint-question-r1": "still off topic" }));
      // Third attempt also off-topic → defaults (empty constraints), moves to confirmation
      const prompt = await suspended(
        persistence, session,
        createAdapter(llm, { "scope-constraint-question-r2": "totally unrelated" }),
      );
      expect(prompt.id).toBe("scope-confirmation-r0");
    });
  });

  describe("contrast questions", () => {
    it("asks contrast questions for ambiguous items", async () => {
      const { persistence, llm } = await advanceToScope({
        "scope-seed-extraction": {
          inScope: [],
          outOfScope: [],
          ambiguous: [{ description: "Reporting module", relatedGoals: ["goal_001"] }],
        },
        "scope-seed-classification-r0": {
          confirmedInScope: [],
          confirmedOutOfScope: [],
          removedIds: [],
          newItems: [],
          waitingRoomItems: [],
        },
        "scope-constraint-composition-r0": { question: "Constraints?", suggestions: ["Time"] },
        "scope-constraint-extraction-r0": { constraints: [], waitingRoomItems: [] },
        "scope-contrast-0-composition-r0": {
          question: "Is the reporting module in scope or out?",
          suggestions: ["In — basic reports", "Out — use external tool"],
        },
      });

      await step(persistence, session, createAdapter(llm, { "scope-seed-present-r0": "OK" }));
      await step(persistence, session, createAdapter(llm, { "scope-constraint-question-r0": "None" }));
      const prompt = await suspended(persistence, session, createAdapter(llm));
      expect(prompt.id).toBe("scope-contrast-0-question-r0");
      if (prompt.type === "prompt") {
        expect(prompt.request.message).toContain("reporting module");
      }
    });

    it("classifies contrast answer as in-scope", async () => {
      const { persistence, llm } = await advanceToScope({
        "scope-seed-extraction": {
          inScope: [],
          outOfScope: [],
          ambiguous: [{ description: "Reporting module" }],
        },
        "scope-seed-classification-r0": {
          confirmedInScope: [],
          confirmedOutOfScope: [],
          removedIds: [],
          newItems: [],
          waitingRoomItems: [],
        },
        "scope-constraint-composition-r0": { question: "Constraints?", suggestions: ["Time"] },
        "scope-constraint-extraction-r0": { constraints: [], waitingRoomItems: [] },
        "scope-contrast-0-composition-r0": { question: "Reporting?", suggestions: ["In", "Out"] },
        "scope-contrast-0-extraction-r0": {
          classification: "in",
          relatedGoals: ["goal_001"],
          waitingRoomItems: [],
        },
        "scope-contradiction-check": { contradictions: [], orphans: [] },
        "scope-confirmation-classification-0-r0": { approved: true, revisionRequested: null },
      });

      await step(persistence, session, createAdapter(llm, { "scope-seed-present-r0": "OK" }));
      await step(persistence, session, createAdapter(llm, { "scope-constraint-question-r0": "None" }));
      const prompt = await suspended(
        persistence, session,
        createAdapter(llm, { "scope-contrast-0-question-r0": "In scope, basic reports" }),
      );

      // Should reach confirmation with the reporting module as in-scope
      expect(prompt.id).toBe("scope-confirmation-r0");
      if (prompt.type === "prompt") {
        expect(prompt.request.message).toContain("Reporting module");
        expect(prompt.request.message).toContain("In scope");
      }
    });

    it("classifies contrast answer as deferred → waiting room", async () => {
      const { persistence, llm } = await advanceToScope({
        "scope-seed-extraction": {
          inScope: [{ description: "Task board", relatedGoals: ["goal_001"] }],
          outOfScope: [],
          ambiguous: [{ description: "Analytics" }],
        },
        "scope-seed-classification-r0": {
          confirmedInScope: ["scope_001"],
          confirmedOutOfScope: [],
          removedIds: [],
          newItems: [],
          waitingRoomItems: [],
        },
        "scope-constraint-composition-r0": { question: "Constraints?", suggestions: ["Time"] },
        "scope-constraint-extraction-r0": { constraints: [], waitingRoomItems: [] },
        "scope-contrast-0-composition-r0": { question: "Analytics?", suggestions: ["In", "Out"] },
        "scope-contrast-0-extraction-r0": {
          classification: "deferred",
          waitingRoomItems: [],
        },
        "scope-contradiction-check": { contradictions: [], orphans: [] },
        "scope-confirmation-classification-0-r0": { approved: true, revisionRequested: null },
      });

      await step(persistence, session, createAdapter(llm, { "scope-seed-present-r0": "OK" }));
      await step(persistence, session, createAdapter(llm, { "scope-constraint-question-r0": "None" }));
      const prompt = await suspended(
        persistence, session,
        createAdapter(llm, { "scope-contrast-0-question-r0": "Maybe later" }),
      );

      // Should reach confirmation — analytics went to waiting room, not scope
      expect(prompt.id).toBe("scope-confirmation-r0");
      if (prompt.type === "prompt") {
        // Analytics should NOT appear in scope summary
        expect(prompt.request.message).not.toContain("Analytics");
      }
    });

    it("sorts and auto-classifies excess ambiguous items beyond cap", async () => {
      const { persistence, llm } = await advanceToScope({
        "scope-seed-extraction": {
          inScope: [],
          outOfScope: [],
          ambiguous: [
            { description: "Reporting module", relatedGoals: ["goal_001"] },
            { description: "Analytics dashboard", relatedGoals: ["goal_001"] },
            { description: "Email notifications", relatedGoals: [] },
            { description: "Dark mode", relatedGoals: [] },
            { description: "Export to PDF", relatedGoals: [] },
          ],
        },
        "scope-seed-classification-r0": {
          confirmedInScope: [],
          confirmedOutOfScope: [],
          removedIds: [],
          newItems: [],
          waitingRoomItems: [],
        },
        "scope-constraint-composition-r0": { question: "Constraints?", suggestions: ["Time"] },
        "scope-constraint-extraction-r0": { constraints: [], waitingRoomItems: [] },
        // Sort: top 3 are indices 0, 1, 2; excess 3 and 4 get auto-classified
        "scope-ambiguous-sort": {
          rankedAmbiguousIds: ["0", "1", "2", "3", "4"],
          autoClassifications: [
            { index: "3", classification: "out", reason: "Low priority", relatedGoals: [] },
            { index: "4", classification: "in", relatedGoals: [] },
          ],
        },
        // Only top 3 get contrast questions
        "scope-contrast-0-composition-r0": { question: "Reporting?", suggestions: ["In", "Out"] },
        "scope-contrast-0-extraction-r0": { classification: "in", relatedGoals: ["goal_001"], waitingRoomItems: [] },
        "scope-contrast-1-composition-r0": { question: "Analytics?", suggestions: ["In", "Out"] },
        "scope-contrast-1-extraction-r0": { classification: "in", relatedGoals: ["goal_001"], waitingRoomItems: [] },
        "scope-contrast-2-composition-r0": { question: "Email?", suggestions: ["In", "Out"] },
        "scope-contrast-2-extraction-r0": { classification: "out", reason: "Not needed", relatedGoals: [], waitingRoomItems: [] },
        "scope-dedup": { duplicateGroups: [] },
        "scope-contradiction-check": { contradictions: [], orphans: [] },
        "scope-confirmation-classification-0-r0": { approved: true, revisionRequested: null },
      });

      await step(persistence, session, createAdapter(llm, { "scope-seed-present-r0": "OK" }));
      await step(persistence, session, createAdapter(llm, { "scope-constraint-question-r0": "None" }));
      // 3 contrast questions
      await step(persistence, session, createAdapter(llm, { "scope-contrast-0-question-r0": "In scope" }));
      await step(persistence, session, createAdapter(llm, { "scope-contrast-1-question-r0": "In scope" }));
      const prompt = await suspended(
        persistence, session,
        createAdapter(llm, { "scope-contrast-2-question-r0": "Out" }),
      );

      expect(prompt.id).toBe("scope-confirmation-r0");
      if (prompt.type === "prompt") {
        // Contrast-decided items
        expect(prompt.request.message).toContain("Reporting module");
        expect(prompt.request.message).toContain("Analytics dashboard");
        expect(prompt.request.message).toContain("Email notifications");
        // Auto-classified items: Export to PDF as in-scope, Dark mode as out-of-scope
        expect(prompt.request.message).toContain("Export to PDF");
        expect(prompt.request.message).toContain("Dark mode");
      }
    });

    it("skips sort when ambiguous count is within cap", async () => {
      const { persistence, llm } = await advanceToScope({
        "scope-seed-extraction": {
          inScope: [],
          outOfScope: [],
          ambiguous: [
            { description: "Reporting module", relatedGoals: ["goal_001"] },
            { description: "Analytics", relatedGoals: [] },
          ],
        },
        "scope-seed-classification-r0": {
          confirmedInScope: [],
          confirmedOutOfScope: [],
          removedIds: [],
          newItems: [],
          waitingRoomItems: [],
        },
        "scope-constraint-composition-r0": { question: "Constraints?", suggestions: ["Time"] },
        "scope-constraint-extraction-r0": { constraints: [], waitingRoomItems: [] },
        // No scope-ambiguous-sort mock — sort should not be called
        "scope-contrast-0-composition-r0": { question: "Reporting?", suggestions: ["In", "Out"] },
        "scope-contrast-0-extraction-r0": { classification: "in", relatedGoals: ["goal_001"], waitingRoomItems: [] },
        "scope-contrast-1-composition-r0": { question: "Analytics?", suggestions: ["In", "Out"] },
        "scope-contrast-1-extraction-r0": { classification: "in", relatedGoals: [], waitingRoomItems: [] },
        "scope-dedup": { duplicateGroups: [] },
        "scope-contradiction-check": { contradictions: [], orphans: [] },
        "scope-confirmation-classification-0-r0": { approved: true, revisionRequested: null },
      });

      await step(persistence, session, createAdapter(llm, { "scope-seed-present-r0": "OK" }));
      await step(persistence, session, createAdapter(llm, { "scope-constraint-question-r0": "None" }));
      // Both items get contrast questions (no sort needed)
      await step(persistence, session, createAdapter(llm, { "scope-contrast-0-question-r0": "In" }));
      const prompt = await suspended(
        persistence, session,
        createAdapter(llm, { "scope-contrast-1-question-r0": "In" }),
      );

      expect(prompt.id).toBe("scope-confirmation-r0");
      if (prompt.type === "prompt") {
        expect(prompt.request.message).toContain("Reporting module");
        expect(prompt.request.message).toContain("Analytics");
      }
    });

    it("falls back to array-order slice when sort returns incomplete ranking", async () => {
      const { persistence, llm } = await advanceToScope({
        "scope-seed-extraction": {
          inScope: [],
          outOfScope: [],
          ambiguous: [
            { description: "Item A", relatedGoals: [] },
            { description: "Item B", relatedGoals: [] },
            { description: "Item C", relatedGoals: [] },
            { description: "Item D", relatedGoals: [] },
          ],
        },
        "scope-seed-classification-r0": {
          confirmedInScope: [],
          confirmedOutOfScope: [],
          removedIds: [],
          newItems: [],
          waitingRoomItems: [],
        },
        "scope-constraint-composition-r0": { question: "Constraints?", suggestions: ["Time"] },
        "scope-constraint-extraction-r0": { constraints: [], waitingRoomItems: [] },
        // Sort returns only 1 valid ID — fewer than cap
        "scope-ambiguous-sort": {
          rankedAmbiguousIds: ["2"],
          autoClassifications: [
            { index: "3", classification: "in", relatedGoals: [] },
          ],
        },
        // Fallback: first 3 items in array order get contrast
        "scope-contrast-0-composition-r0": { question: "A?", suggestions: ["In", "Out"] },
        "scope-contrast-0-extraction-r0": { classification: "in", relatedGoals: [], waitingRoomItems: [] },
        "scope-contrast-1-composition-r0": { question: "B?", suggestions: ["In", "Out"] },
        "scope-contrast-1-extraction-r0": { classification: "in", relatedGoals: [], waitingRoomItems: [] },
        "scope-contrast-2-composition-r0": { question: "C?", suggestions: ["In", "Out"] },
        "scope-contrast-2-extraction-r0": { classification: "in", relatedGoals: [], waitingRoomItems: [] },
        "scope-dedup": { duplicateGroups: [] },
        "scope-contradiction-check": { contradictions: [], orphans: [] },
        "scope-confirmation-classification-0-r0": { approved: true, revisionRequested: null },
      });

      await step(persistence, session, createAdapter(llm, { "scope-seed-present-r0": "OK" }));
      await step(persistence, session, createAdapter(llm, { "scope-constraint-question-r0": "None" }));
      await step(persistence, session, createAdapter(llm, { "scope-contrast-0-question-r0": "In" }));
      await step(persistence, session, createAdapter(llm, { "scope-contrast-1-question-r0": "In" }));
      const prompt = await suspended(
        persistence, session,
        createAdapter(llm, { "scope-contrast-2-question-r0": "In" }),
      );

      expect(prompt.id).toBe("scope-confirmation-r0");
      if (prompt.type === "prompt") {
        expect(prompt.request.message).toContain("Item A");
        expect(prompt.request.message).toContain("Item B");
        expect(prompt.request.message).toContain("Item C");
        // Item D: auto-classified as in-scope (from autoClassifications)
        expect(prompt.request.message).toContain("Item D");
      }
    });
  });

  describe("contradiction detection", () => {
    it("surfaces contradictions between scope and goals", async () => {
      const { persistence, llm } = await advanceToScope({
        "scope-seed-extraction": {
          inScope: [],
          outOfScope: [{ description: "Task tracking", reason: "Too complex", relatedGoals: ["goal_001"] }],
          ambiguous: [],
        },
        "scope-seed-classification-r0": {
          confirmedInScope: [],
          confirmedOutOfScope: ["scope_001"],
          removedIds: [],
          newItems: [],
          waitingRoomItems: [],
        },
        "scope-constraint-composition-r0": { question: "Constraints?", suggestions: ["Time"] },
        "scope-constraint-extraction-r0": { constraints: [], waitingRoomItems: [] },
        "scope-contradiction-check": {
          contradictions: [{
            description: "Task tracking is excluded but goal_001 requires it",
            scopeItemId: "scope_001",
            goalId: "goal_001",
          }],
          orphans: [],
        },
      });

      await step(persistence, session, createAdapter(llm, { "scope-seed-present-r0": "OK" }));
      await step(persistence, session, createAdapter(llm, { "scope-constraint-question-r0": "None" }));
      const prompt = await suspended(persistence, session, createAdapter(llm));

      expect(prompt.id).toBe("scope-contradiction-clarification-r0");
      if (prompt.type === "prompt") {
        expect(prompt.request.message).toContain("inconsistent");
      }
    });

    it("records orphan findings for in-scope items without goals", async () => {
      const { persistence, llm } = await advanceToScope({
        "scope-seed-extraction": {
          inScope: [{ description: "Chat feature", relatedGoals: [] }],
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
        "scope-constraint-extraction-r0": { constraints: [], waitingRoomItems: [] },
        "scope-contradiction-check": {
          contradictions: [],
          orphans: [{ scopeItemId: "scope_001", description: "Chat feature has no connection to any stated goal" }],
        },
        "scope-confirmation-classification-0-r0": { approved: true, revisionRequested: null },
      });

      await step(persistence, session, createAdapter(llm, { "scope-seed-present-r0": "OK" }));
      await step(persistence, session, createAdapter(llm, { "scope-constraint-question-r0": "None" }));
      const prompt = await suspended(persistence, session, createAdapter(llm));

      expect(prompt.id).toBe("scope-confirmation-r0");
      if (prompt.type === "prompt") {
        expect(prompt.request.message).toContain("no connection to any stated goal");
      }
    });
  });

  describe("quality check", () => {
    it("nudges when zero scope items, then adds finding if still empty", async () => {
      const { persistence, llm } = await advanceToScope({
        "scope-seed-extraction": {
          inScope: [],
          outOfScope: [],
          ambiguous: [],
        },
        "scope-seed-classification-r0": {
          confirmedInScope: [],
          confirmedOutOfScope: [],
          removedIds: [],
          newItems: [],
          waitingRoomItems: [],
        },
        "scope-constraint-composition-r0": { question: "Constraints?", suggestions: ["Time"] },
        "scope-constraint-extraction-r0": { constraints: [], waitingRoomItems: [] },
        // Nudge
        "scope-nudge-extraction-r0": { inScope: [], outOfScope: [], ambiguous: [] },
        "scope-confirmation-classification-0-r0": { approved: true, revisionRequested: null },
      });

      await step(persistence, session, createAdapter(llm, { "scope-seed-present-r0": "I don't know" }));
      await step(persistence, session, createAdapter(llm, { "scope-constraint-question-r0": "None" }));

      // Should get nudge
      const nudge = await suspended(persistence, session, createAdapter(llm));
      expect(nudge.id).toBe("scope-nudge-r0");
      if (nudge.type === "prompt") {
        expect(nudge.request.message).toContain("haven't defined any scope boundaries");
      }

      // Nudge response still empty → finding, then confirm
      const confirm = await suspended(
        persistence, session,
        createAdapter(llm, { "scope-nudge-r0": "I really don't know" }),
      );
      expect(confirm.id).toBe("scope-confirmation-r0");
      if (confirm.type === "prompt") {
        expect(confirm.request.message).toContain("No scope boundaries defined");
      }
    });

    it("accepts scope items from nudge response", async () => {
      const { persistence, llm } = await advanceToScope({
        "scope-seed-extraction": {
          inScope: [],
          outOfScope: [],
          ambiguous: [],
        },
        "scope-seed-classification-r0": {
          confirmedInScope: [],
          confirmedOutOfScope: [],
          removedIds: [],
          newItems: [],
          waitingRoomItems: [],
        },
        "scope-constraint-composition-r0": { question: "Constraints?", suggestions: ["Time"] },
        "scope-constraint-extraction-r0": { constraints: [], waitingRoomItems: [] },
        "scope-nudge-extraction-r0": {
          inScope: [{ description: "Basic task board", relatedGoals: ["goal_001"] }],
          outOfScope: [],
        },
        "scope-contradiction-check": { contradictions: [], orphans: [] },
        "scope-confirmation-classification-0-r0": { approved: true, revisionRequested: null },
      });

      await step(persistence, session, createAdapter(llm, { "scope-seed-present-r0": "Not sure" }));
      await step(persistence, session, createAdapter(llm, { "scope-constraint-question-r0": "None" }));
      const prompt = await suspended(
        persistence, session,
        createAdapter(llm, { "scope-nudge-r0": "Well, a basic task board for sure" }),
      );

      // Should skip to confirm (nudge produced an item)
      expect(prompt.id).toBe("scope-confirmation-r0");
      if (prompt.type === "prompt") {
        expect(prompt.request.message).toContain("Basic task board");
      }
    });
  });

  describe("confirmation", () => {
    async function advanceToConfirmation(extraLlm: Record<string, unknown> = {}) {
      return advanceToScope({
        "scope-seed-extraction": {
          inScope: [{ description: "Task board", relatedGoals: ["goal_001"] }],
          outOfScope: [{ description: "Payroll", reason: "Different domain" }],
          ambiguous: [],
        },
        "scope-seed-classification-r0": {
          confirmedInScope: ["scope_001"],
          confirmedOutOfScope: ["scope_002"],
          removedIds: [],
          newItems: [],
          waitingRoomItems: [],
        },
        "scope-constraint-composition-r0": { question: "Constraints?", suggestions: ["Time"] },
        "scope-constraint-extraction-r0": {
          constraints: [{ description: "2-month timeline" }],
          waitingRoomItems: [],
        },
        "scope-dedup": { duplicateGroups: [] },
        "scope-contradiction-check": { contradictions: [], orphans: [] },
        ...extraLlm,
      });
    }

    async function driveToConfirmation(
      persistence: ReturnType<typeof memoryPersistence>,
      llm: Record<string, unknown>,
    ) {
      await step(persistence, session, createAdapter(llm, { "scope-seed-present-r0": "Good" }));
      await step(persistence, session, createAdapter(llm, { "scope-constraint-question-r0": "2 months" }));
    }

    it("advances to assumptions phase when scope confirmed", async () => {
      const { persistence, llm } = await advanceToConfirmation({
        "scope-confirmation-classification-0-r0": { approved: true, revisionRequested: null },
      });
      await driveToConfirmation(persistence, llm);

      const prompt = await suspended(
        persistence, session,
        createAdapter(llm, { "scope-confirmation-r0": "Looks good" }),
      );
      // After scope confirmation, workflow continues to assumption capture
      expect(prompt.id).toBe("assumption-seed-present-r0");
    });

    it("presents full scope summary at confirmation", async () => {
      const { persistence, llm } = await advanceToConfirmation({
        "scope-confirmation-classification-0-r0": { approved: true, revisionRequested: null },
      });
      await driveToConfirmation(persistence, llm);

      const prompt = await suspended(persistence, session, createAdapter(llm));
      expect(prompt.id).toBe("scope-confirmation-r0");
      if (prompt.type === "prompt") {
        expect(prompt.request.message).toContain("Task board");
        expect(prompt.request.message).toContain("Payroll");
        expect(prompt.request.message).toContain("2-month timeline");
      }
    });

    it("extracts revision from rejection and advances to assumptions", async () => {
      const { persistence, llm } = await advanceToConfirmation({
        "scope-confirmation-classification-0-r0": { approved: false, revisionRequested: "Add mobile app" },
        "scope-revision-r0": { responseInterpretation: "wants mobile app in scope", inScope: [{ description: "Mobile app" }], outOfScope: [], removedIds: [] },
      });
      await driveToConfirmation(persistence, llm);

      const prompt = await suspended(
        persistence, session,
        createAdapter(llm, { "scope-confirmation-r0": "Add mobile app to scope" }),
      );
      expect(prompt.id).toBe("assumption-seed-present-r0");
    });

    it("advances past scope on approval", async () => {
      const { persistence, llm } = await advanceToConfirmation({
        "scope-confirmation-classification-0-r0": { approved: true, revisionRequested: null },
      });
      await driveToConfirmation(persistence, llm);

      const prompt = await suspended(
        persistence, session,
        createAdapter(llm, { "scope-confirmation-r0": "Looks good" }),
      );
      // Scope completed, now in assumptions phase
      expect(prompt.id).toBe("assumption-seed-present-r0");
    });

    it("removes semantic duplicates before confirmation", async () => {
      const { persistence, llm } = await advanceToConfirmation({
        "scope-dedup": {
          duplicateGroups: [{ keepId: "scope_001", removeIds: ["scope_002"] }],
        },
        "scope-confirmation-classification-0-r0": { approved: true, revisionRequested: null },
      });
      await driveToConfirmation(persistence, llm);

      const prompt = await suspended(persistence, session, createAdapter(llm));
      expect(prompt.id).toBe("scope-confirmation-r0");
      if (prompt.type === "prompt") {
        expect(prompt.request.message).toContain("Task board");
        // Payroll (scope_002) was removed as a duplicate
        expect(prompt.request.message).not.toContain("Payroll");
      }
    });

    it("reclassifies items during revision", async () => {
      const { persistence, llm } = await advanceToConfirmation({
        "scope-confirmation-classification-0-r0": { approved: false, revisionRequested: "Move Payroll to in-scope" },
        "scope-revision-r0": {
          responseInterpretation: "wants payroll in scope",
          inScope: [],
          outOfScope: [],
          removedIds: [],
          reclassifiedItems: [{ id: "scope_002", newClassification: "in" }],
        },
      });
      await driveToConfirmation(persistence, llm);

      const prompt = await suspended(
        persistence, session,
        createAdapter(llm, { "scope-confirmation-r0": "Move Payroll to in-scope" }),
      );
      expect(prompt.id).toBe("assumption-seed-present-r0");
    });

    it("deduplicates items added during revision", async () => {
      const { persistence, llm } = await advanceToConfirmation({
        "scope-dedup-post-revision": {
          duplicateGroups: [{ keepId: "scope_001", removeIds: ["scope_003"] }],
        },
        "scope-confirmation-classification-0-r0": { approved: false, revisionRequested: "Add project board" },
        "scope-revision-r0": {
          responseInterpretation: "wants project board added",
          inScope: [{ description: "Project task board", relatedGoals: ["goal_001"] }],
          outOfScope: [],
          removedIds: [],
          reclassifiedItems: [],
          waitingRoomItems: [],
        },
      });
      await driveToConfirmation(persistence, llm);

      const prompt = await suspended(
        persistence, session,
        createAdapter(llm, { "scope-confirmation-r0": "Add project board" }),
      );

      // Post-revision dedup removed scope_003 (duplicate of scope_001 "Task board")
      // Flow continues to assumptions
      expect(prompt.id).toBe("assumption-seed-present-r0");
    });
  });
});
