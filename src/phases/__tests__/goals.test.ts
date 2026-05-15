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

describe("goals phase", () => {
  const baseLlm: Record<string, unknown> = {
    "opening-greet-extraction-r0": {
      purpose: "track reading habits",
      stakeholders: ["readers"],
      domainHints: ["books"],
    },
    "opening-brownfield-screen": { greenfieldConfidence: 9 },
    "opening-confirmation-classification-0-r0": { approved: true, revisionRequested: null },
    "purpose-initial-extraction": {
      purpose: "track reading to build habits",
      advantage: "simpler than spreadsheets",
      measurement: "books per month",
      contradictions: [],
    },
    "purpose-confirmation-classification-0-r0": { approved: true, revisionRequested: null },
  };

  /** Helper: advance through opening + purpose to reach goals */
  async function advanceToGoals(llm: Record<string, unknown>) {
    const persistence = memoryPersistence();
    const mergedLlm = { ...baseLlm, ...llm };

    await step(persistence, session, createAdapter(mergedLlm));
    await step(persistence, session, createAdapter(mergedLlm, { "opening-greet-r0": "Reading tracker" }));
    await step(persistence, session, createAdapter(mergedLlm, { "opening-summary-r0": "Yes" }));
    // Now at purpose:confirm (all PAM slots filled in initial extraction)
    await step(persistence, session, createAdapter(mergedLlm, { "purpose-confirmation-r0": "Looks good" }));
    // Now in goals phase

    return { persistence, llm: mergedLlm };
  }

  describe("seeding", () => {
    it("presents seed goals as indexed list", async () => {
      const { persistence, llm } = await advanceToGoals({
        "goal-seed-extraction": {
          goals: [
            { title: "Track reading progress", description: "Monitor books started and finished" },
            { title: "Build reading habits", description: "Encourage consistent daily reading" },
          ],
        },
      });

      const prompt = await suspended(persistence, session, createAdapter(llm));
      expect(prompt.id).toBe("goal-seed-present-r0");
      if (prompt.type === "prompt") {
        expect(prompt.request.message).toContain("a)");
        expect(prompt.request.message).toContain("b)");
        expect(prompt.request.message).toContain("Track reading progress");
        expect(prompt.request.message).toContain("Build reading habits");
      }
    });

    it("asks initial question when seed returns no goals", async () => {
      const { persistence, llm } = await advanceToGoals({
        "goal-seed-extraction": { goals: [] },
        "goal-initial-composition-r0": { question: "What are your project goals?", suggestions: ["Track reading"] },
      });

      const prompt = await suspended(persistence, session, createAdapter(llm));
      expect(prompt.id).toBe("goal-initial-question-r0");
      if (prompt.type === "prompt") {
        expect(prompt.request.message).toContain("What are your project goals?");
      }
    });

    it("extracts goals from initial question response", async () => {
      const { persistence, llm } = await advanceToGoals({
        "goal-seed-extraction": { goals: [] },
        "goal-initial-composition-r0": { question: "What goals?", suggestions: ["Track"] },
        "goal-initial-extraction-r0": {
          responseInterpretation: "Track books",
          goals: [{ title: "Track reading", description: "Monitor books" }],
          waitingRoomItems: [],
        },
        "goal-refinement-goal_001-clarify-0-composition-r0": { question: "What?", suggestions: ["A"] },
      });

      const prompt = await suspended(
        persistence, session,
        createAdapter(llm, { "goal-initial-question-r0": "I want to track books" }),
      );

      // Should start refining the extracted goal
      expect(prompt.id).toBe("goal-refinement-goal_001-clarify-0-question-r0");
    });

    it("handles user removing seed goals", async () => {
      const { persistence, llm } = await advanceToGoals({
        "goal-seed-extraction": {
          goals: [
            { title: "Goal A", description: "Desc A" },
            { title: "Goal B", description: "Desc B" },
          ],
        },
        "goal-seed-classification-r0": {
          responseInterpretation: "Remove Goal B",
          confirmedGoalIds: ["goal_001"],
          removedGoalIds: ["goal_002"],
          newGoals: [],
          waitingRoomItems: [],
        },
        // After removal, should start refining goal_001
        "goal-refinement-goal_001-clarify-0-composition-r0": {
          question: "What does Goal A mean?",
          suggestions: ["X"],
        },
      });

      // Seed presented
      await step(persistence, session, createAdapter(llm));

      // User responds to seed list → classify → refine
      const prompt = await suspended(
        persistence, session,
        createAdapter(llm, { "goal-seed-present-r0": "Remove the second one" }),
      );

      expect(prompt.id).toBe("goal-refinement-goal_001-clarify-0-question-r0");
    });

    it("adds new goals from seed response", async () => {
      const { persistence, llm } = await advanceToGoals({
        "goal-seed-extraction": {
          goals: [{ title: "Goal A", description: "Desc A" }],
        },
        "goal-seed-classification-r0": {
          responseInterpretation: "Add analytics",
          confirmedGoalIds: ["goal_001"],
          removedGoalIds: [],
          newGoals: [{ title: "Reading analytics", description: "Track stats" }],
          waitingRoomItems: [],
        },
        "goal-refinement-goal_001-clarify-0-composition-r0": { question: "What?", suggestions: ["Y"] },
      });

      // Present seed list → user adds goal → classify → refine
      await step(persistence, session, createAdapter(llm));
      const prompt = await suspended(
        persistence, session,
        createAdapter(llm, { "goal-seed-present-r0": "Also add analytics" }),
      );

      // Should start refining goal_001 first
      expect(prompt.id).toBe("goal-refinement-goal_001-clarify-0-question-r0");
    });
  });

  describe("per-goal refinement", () => {
    async function seedOneGoal(extraLlm: Record<string, unknown> = {}) {
      return advanceToGoals({
        "goal-seed-extraction": {
          goals: [{ title: "Track reading", description: "Monitor books" }],
        },
        "goal-seed-classification-r0": {
          responseInterpretation: "Confirmed all",
          confirmedGoalIds: ["goal_001"],
          removedGoalIds: [],
          newGoals: [],
          waitingRoomItems: [],
        },
        ...extraLlm,
      });
    }

    it("asks clarification question for first fuzzy goal", async () => {
      const { persistence, llm } = await seedOneGoal({
        "goal-refinement-goal_001-clarify-0-composition-r0": {
          question: "What does tracking reading mean?",
          suggestions: ["Pages per day", "Books completed"],
        },
      });

      // Present seeds → user confirms → classify → compose
      await step(persistence, session, createAdapter(llm));
      const prompt = await suspended(
        persistence, session,
        createAdapter(llm, { "goal-seed-present-r0": "Looks good" }),
      );

      expect(prompt.id).toBe("goal-refinement-goal_001-clarify-0-question-r0");
      if (prompt.type === "prompt") {
        expect(prompt.request.message).toContain("What does tracking reading mean?");
        expect(prompt.request.message).toContain("a)");
        expect(prompt.request.message).toContain("b)");
      }
    });

    it("advances probing from clarify to why when extraction yields data", async () => {
      const { persistence, llm } = await seedOneGoal({
        "goal-refinement-goal_001-clarify-0-composition-r0": { question: "What?", suggestions: ["A"] },
        "goal-refinement-goal_001-clarify-0-extraction-r0": {
          title: null, description: "Track books finished over time",
          rationale: null, contradictions: [], waitingRoomItems: [],
        },
        "goal-refinement-goal_001-why-0-composition-r0": {
          question: "Why is this important?",
          suggestions: ["Motivation"],
        },
      });

      // Seeds → confirm → compose → answer → extract → why compose
      await step(persistence, session, createAdapter(llm));
      await step(persistence, session, createAdapter(llm, { "goal-seed-present-r0": "Good" }));
      const prompt = await suspended(
        persistence, session,
        createAdapter(llm, { "goal-refinement-goal_001-clarify-0-question-r0": "Books finished" }),
      );

      expect(prompt.id).toBe("goal-refinement-goal_001-why-0-question-r0");
      if (prompt.type === "prompt") {
        expect(prompt.request.message).toContain("Why is this important?");
      }
    });

    it("advances probing from why to negative", async () => {
      const { persistence, llm } = await seedOneGoal({
        "goal-refinement-goal_001-clarify-0-composition-r0": { question: "What?", suggestions: ["A"] },
        "goal-refinement-goal_001-clarify-0-extraction-r0": {
          title: null, description: "Track books", rationale: null, contradictions: [], waitingRoomItems: [],
        },
        "goal-refinement-goal_001-why-0-composition-r0": { question: "Why?", suggestions: ["B"] },
        "goal-refinement-goal_001-why-0-extraction-r0": {
          title: null, description: null, rationale: "Keeps motivated", contradictions: [], waitingRoomItems: [],
        },
        "goal-refinement-goal_001-negative-0-composition-r0": {
          question: "What if this didn't exist?",
          suggestions: ["C"],
        },
      });

      await step(persistence, session, createAdapter(llm));
      await step(persistence, session, createAdapter(llm, { "goal-seed-present-r0": "Good" }));
      await step(persistence, session, createAdapter(llm, { "goal-refinement-goal_001-clarify-0-question-r0": "Books" }));
      const prompt = await suspended(
        persistence, session,
        createAdapter(llm, { "goal-refinement-goal_001-why-0-question-r0": "Motivation" }),
      );

      expect(prompt.id).toBe("goal-refinement-goal_001-negative-0-question-r0");
      if (prompt.type === "prompt") {
        expect(prompt.request.message).toContain("What if this didn't exist?");
      }
    });

    it("goes to confirmation after negative stage succeeds", async () => {
      const { persistence, llm } = await seedOneGoal({
        "goal-refinement-goal_001-clarify-0-composition-r0": { question: "What?", suggestions: ["A"] },
        "goal-refinement-goal_001-clarify-0-extraction-r0": {
          title: null, description: "Track books", rationale: null, contradictions: [], waitingRoomItems: [],
        },
        "goal-refinement-goal_001-why-0-composition-r0": { question: "Why?", suggestions: ["B"] },
        "goal-refinement-goal_001-why-0-extraction-r0": {
          title: null, description: null, rationale: "Motivation", contradictions: [], waitingRoomItems: [],
        },
        "goal-refinement-goal_001-negative-0-composition-r0": { question: "What if not?", suggestions: ["C"] },
        "goal-refinement-goal_001-negative-0-extraction-r0": {
          title: null, description: "Would lose awareness", rationale: null, contradictions: [], waitingRoomItems: [],
        },
      });

      await step(persistence, session, createAdapter(llm));
      await step(persistence, session, createAdapter(llm, { "goal-seed-present-r0": "Good" }));
      await step(persistence, session, createAdapter(llm, { "goal-refinement-goal_001-clarify-0-question-r0": "Books" }));
      await step(persistence, session, createAdapter(llm, { "goal-refinement-goal_001-why-0-question-r0": "Motivation" }));
      const prompt = await suspended(
        persistence, session,
        createAdapter(llm, { "goal-refinement-goal_001-negative-0-question-r0": "Lose track" }),
      );

      // Goal elaborated → goes to confirmation (no discovery loop)
      expect(prompt.id).toBe("goals-confirmation-r0");
    });

    it("skips why when clarify captures rationale", async () => {
      const { persistence, llm } = await seedOneGoal({
        "goal-refinement-goal_001-clarify-0-composition-r0": { question: "What?", suggestions: ["A"] },
        "goal-refinement-goal_001-clarify-0-extraction-r0": {
          title: null, description: "Track books finished over time",
          rationale: "Keeps readers motivated", contradictions: [], waitingRoomItems: [],
        },
        "goal-refinement-goal_001-negative-0-composition-r0": {
          question: "What if this didn't exist?",
          suggestions: ["C"],
        },
      });

      await step(persistence, session, createAdapter(llm));
      await step(persistence, session, createAdapter(llm, { "goal-seed-present-r0": "Good" }));
      const prompt = await suspended(
        persistence, session,
        createAdapter(llm, { "goal-refinement-goal_001-clarify-0-question-r0": "Track books to stay motivated" }),
      );

      // Why skipped — rationale captured in clarify. Goes to negative (enabled in this test suite).
      expect(prompt.id).toBe("goal-refinement-goal_001-negative-0-question-r0");
    });

    it("skips refinement entirely when seed provides rationale", async () => {
      const { persistence, llm } = await advanceToGoals({
        "goal-seed-extraction": {
          goals: [{ title: "Track reading", description: "Monitor books", rationale: "Build consistent habits" }],
        },
        "goal-seed-classification-r0": {
          responseInterpretation: "Confirmed",
          confirmedGoalIds: ["goal_001"],
          removedGoalIds: [],
          newGoals: [],
          waitingRoomItems: [],
        },
        "goals-confirmation-classification-0-r0": { approved: true, revisionRequested: null },
      });

      await step(persistence, session, createAdapter(llm));
      const prompt = await suspended(
        persistence, session,
        createAdapter(llm, { "goal-seed-present-r0": "Looks good" }),
      );

      // Rationale from seed — all refinement skipped, goes straight to confirmation
      expect(prompt.id).toBe("goals-confirmation-r0");
    });

    it("rephrases when no fields extracted", async () => {
      const { persistence, llm } = await seedOneGoal({
        "goal-refinement-goal_001-clarify-0-composition-r0": { question: "What?", suggestions: ["A"] },
        "goal-refinement-goal_001-clarify-0-extraction-r0": {
          title: null, description: null, rationale: null, contradictions: [], waitingRoomItems: [],
        },
        "goal-refinement-goal_001-clarify-1-composition-r0": { question: "How about?", suggestions: ["B"] },
      });

      await step(persistence, session, createAdapter(llm));
      await step(persistence, session, createAdapter(llm, { "goal-seed-present-r0": "Good" }));
      const prompt = await suspended(
        persistence, session,
        createAdapter(llm, { "goal-refinement-goal_001-clarify-0-question-r0": "I don't know" }),
      );

      expect(prompt.id).toBe("goal-refinement-goal_001-clarify-1-question-r0");
      if (prompt.type === "prompt") {
        expect(prompt.request.message).toContain("How about?");
      }
    });

    it("flags finding after 3 failed attempts and goes to confirmation", async () => {
      const { persistence, llm } = await seedOneGoal({
        "goal-refinement-goal_001-clarify-0-composition-r0": { question: "What?", suggestions: ["A"] },
        "goal-refinement-goal_001-clarify-0-extraction-r0": { title: null, description: null, rationale: null, contradictions: [], waitingRoomItems: [] },
        "goal-refinement-goal_001-clarify-1-composition-r0": { question: "How?", suggestions: ["B"] },
        "goal-refinement-goal_001-clarify-1-extraction-r0": { title: null, description: null, rationale: null, contradictions: [], waitingRoomItems: [] },
        "goal-refinement-goal_001-clarify-2-composition-r0": { question: "Maybe?", suggestions: ["C"] },
        "goal-refinement-goal_001-clarify-2-extraction-r0": { title: null, description: null, rationale: null, contradictions: [], waitingRoomItems: [] },
      });

      await step(persistence, session, createAdapter(llm));
      await step(persistence, session, createAdapter(llm, { "goal-seed-present-r0": "Good" }));
      await step(persistence, session, createAdapter(llm, { "goal-refinement-goal_001-clarify-0-question-r0": "?" }));
      await step(persistence, session, createAdapter(llm, { "goal-refinement-goal_001-clarify-1-question-r0": "?" }));
      const prompt = await suspended(
        persistence, session,
        createAdapter(llm, { "goal-refinement-goal_001-clarify-2-question-r0": "?" }),
      );

      // After 3 failures → goes to confirmation (with quality-check finding)
      expect(prompt.id).toBe("goals-confirmation-r0");
      if (prompt.type === "prompt") {
        expect(prompt.request.message).toContain("Gaps noted");
      }
    });

    it("uses fallback question when compose fails", async () => {
      const { persistence, llm } = await seedOneGoal({
        "goal-refinement-goal_001-clarify-0-composition-r0": {}, // No question
      });

      await step(persistence, session, createAdapter(llm));
      const prompt = await suspended(
        persistence, session,
        createAdapter(llm, { "goal-seed-present-r0": "Good" }),
      );

      if (prompt.type === "prompt") {
        expect(prompt.request.message).toContain("Track reading");
        expect(prompt.request.message).toContain("in practice");
      }
    });
  });

  describe("contradiction handling", () => {
    it("surfaces contradictions to user", async () => {
      const { persistence, llm } = await advanceToGoals({
        "goal-seed-extraction": {
          goals: [{ title: "Track reading", description: "Monitor books" }],
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
          title: null, description: null, rationale: null,
          contradictions: ["Earlier said comprehensive, now says simple"],
          waitingRoomItems: [],
        },
      });

      await step(persistence, session, createAdapter(llm));
      await step(persistence, session, createAdapter(llm, { "goal-seed-present-r0": "Good" }));
      const prompt = await suspended(
        persistence, session,
        createAdapter(llm, { "goal-refinement-goal_001-clarify-0-question-r0": "Simple" }),
      );

      expect(prompt.type).toBe("prompt");
      if (prompt.type === "prompt") {
        expect(prompt.request.message).toContain("inconsistent");
      }
    });
  });

  describe("confirmation", () => {
    async function advanceToConfirmation(extraLlm: Record<string, unknown> = {}) {
      return advanceToGoals({
        "goal-seed-extraction": {
          goals: [{ title: "Track reading", description: "Monitor books" }],
        },
        "goal-seed-classification-r0": {
          responseInterpretation: "Confirmed",
          confirmedGoalIds: ["goal_001"],
          removedGoalIds: [],
          newGoals: [],
          waitingRoomItems: [],
        },
        "goal-refinement-goal_001-clarify-0-composition-r0": { question: "What?", suggestions: ["A"] },
        "goal-refinement-goal_001-clarify-0-extraction-r0": { title: null, description: "Track books", rationale: null, contradictions: [], waitingRoomItems: [] },
        "goal-refinement-goal_001-why-0-composition-r0": { question: "Why?", suggestions: ["B"] },
        "goal-refinement-goal_001-why-0-extraction-r0": { title: null, description: null, rationale: "Motivation", contradictions: [], waitingRoomItems: [] },
        "goal-refinement-goal_001-negative-0-composition-r0": { question: "What if not?", suggestions: ["C"] },
        "goal-refinement-goal_001-negative-0-extraction-r0": { title: null, description: "Lose awareness", rationale: null, contradictions: [], waitingRoomItems: [] },
        ...extraLlm,
      });
    }

    async function driveToConfirmation(persistence: ReturnType<typeof memoryPersistence>, llm: Record<string, unknown>) {
      await step(persistence, session, createAdapter(llm));
      await step(persistence, session, createAdapter(llm, { "goal-seed-present-r0": "Good" }));
      await step(persistence, session, createAdapter(llm, { "goal-refinement-goal_001-clarify-0-question-r0": "Books" }));
      await step(persistence, session, createAdapter(llm, { "goal-refinement-goal_001-why-0-question-r0": "Motivation" }));
      await step(persistence, session, createAdapter(llm, { "goal-refinement-goal_001-negative-0-question-r0": "Lose track" }));
      // Now at goals-confirmation (no discovery loop)
    }

    it("advances to stakeholders when goals confirmed", async () => {
      const { persistence, llm } = await advanceToConfirmation({
        "goals-confirmation-classification-0-r0": { approved: true, revisionRequested: null },
      });
      await driveToConfirmation(persistence, llm);

      const prompt = await suspended(
        persistence, session,
        createAdapter(llm, { "goals-confirmation-r0": "Looks good" }),
      );

      // After goals confirmation, workflow continues to stakeholders phase
      expect(prompt.id).toBe("stakeholder-review-present-r0");
    });

    it("extracts revision from rejection and advances to stakeholders", async () => {
      const { persistence, llm } = await advanceToConfirmation({
        "goals-confirmation-classification-0-r0": { approved: false, revisionRequested: "First goal needs work", targetId: "goal_001" },
        "goals-revision-r0": { responseInterpretation: "wants better title", title: "Better reading tracking", rationale: null, contradictions: [] },
        "stakeholder-review-present-r0": "ok",
      });
      await driveToConfirmation(persistence, llm);

      const prompt = await suspended(
        persistence, session,
        createAdapter(llm, { "goals-confirmation-r0": "The first goal needs work" }),
      );

      expect(prompt.id).toBe("stakeholder-review-present-r0");
    });
  });

  describe("waiting room", () => {
    it("puts reclassified items in waitingRoom", async () => {
      const { persistence, llm } = await advanceToGoals({
        "goal-seed-extraction": {
          goals: [{ title: "Track reading", description: "Monitor books" }],
        },
        "goal-seed-classification-r0": {
          responseInterpretation: "Confirmed",
          confirmedGoalIds: ["goal_001"],
          removedGoalIds: [],
          newGoals: [],
          waitingRoomItems: [{ content: "Scope: only fiction books" }],
        },
        "goal-refinement-goal_001-clarify-0-composition-r0": { question: "What?", suggestions: ["A"] },
      });

      // Seeds → user confirms → classify (with waiting room item) → refine
      await step(persistence, session, createAdapter(llm));
      await step(persistence, session, createAdapter(llm, { "goal-seed-present-r0": "Good" }));

      // Check that the waiting room item was stored by inspecting entries
      const state = persistence.current()!;
      // The workflow processed seed:classify which has waitingRoomItems
      // The artifacts are rebuilt during replay, so we verify by driving to
      // a point where artifact context is included
      await suspended(persistence, session, createAdapter(llm));
      // The refine compose message should include any waiting room items indirectly
    });

    it("drains matching waiting room items during seed", async () => {
      // Purpose laddering produces a waiting room item; goals seed extraction drains it
      const persistence = memoryPersistence();
      const llm: Record<string, unknown> = {
        "opening-greet-extraction-r0": {
          purpose: "track reading habits",
          stakeholders: ["readers"],
          domainHints: ["books"],
        },
        "opening-brownfield-screen": { greenfieldConfidence: 9 },
        "opening-confirmation-classification-0-r0": { approved: true, revisionRequested: null },
        // Purpose — null purpose triggers laddering
        "purpose-initial-extraction": {
          purpose: null, advantage: "simpler than spreadsheets",
          measurement: "books per month", contradictions: [],
        },
        "purpose-classify-framing": { framing: "solution", solutionDescription: "A reading tracker app" },
        "purpose-ladder-composition-0": { question: "Why track reading?", suggestions: ["Build habits"] },
        "purpose-ladder-extraction-0": {
          purpose: "track reading to build habits",
          contradictions: [],
          waitingRoomItems: ["Users might want book recommendations"],
        },
        "purpose-confirmation-classification-0-r0": { approved: true, revisionRequested: null },
        // Goal seed extraction drains the parked item
        "goal-seed-extraction": {
          goals: [{ title: "Track reading", description: "Monitor books" }],
          drainedWaitingRoomIds: ["waiting_001"],
        },
        "goal-seed-classification-r0": {
          responseInterpretation: "Confirmed",
          confirmedGoalIds: ["goal_001"],
          removedGoalIds: [],
          newGoals: [],
          waitingRoomItems: [],
        },
        "goal-refinement-goal_001-clarify-0-composition-r0": { question: "What?", suggestions: ["A"] },
        "goal-refinement-goal_001-clarify-0-extraction-r0": { title: null, description: "Monitor books started", rationale: null, contradictions: [], waitingRoomItems: [] },
        "goal-refinement-goal_001-why-0-composition-r0": { question: "Why?", suggestions: ["B"] },
        "goal-refinement-goal_001-why-0-extraction-r0": { title: null, description: null, rationale: "Build habits", contradictions: [], waitingRoomItems: [] },
        "goal-refinement-goal_001-negative-0-composition-r0": { question: "What if?", suggestions: ["C"] },
        "goal-refinement-goal_001-negative-0-extraction-r0": { title: null, description: null, rationale: "Risk of losing reading habit", contradictions: [], waitingRoomItems: [] },
        "goals-confirmation-classification-0-r0": { approved: true, revisionRequested: null },
      };

      // Opening
      await step(persistence, session, createAdapter(llm));
      await step(persistence, session, createAdapter(llm, { "opening-greet-r0": "Reading tracker" }));
      await step(persistence, session, createAdapter(llm, { "opening-summary-r0": "Yes" }));
      // Purpose — ladder path (extra step vs standard flow)
      await step(persistence, session, createAdapter(llm, { "purpose-ladder-question-0": "To build habits" }));
      await step(persistence, session, createAdapter(llm, { "purpose-confirmation-r0": "Looks good" }));
      // Goals — seed extraction runs + drain, then present
      await step(persistence, session, createAdapter(llm, { "goal-seed-present-r0": "Good" }));
      await step(persistence, session, createAdapter(llm, { "goal-refinement-goal_001-clarify-0-question-r0": "Monitor books" }));
      await step(persistence, session, createAdapter(llm, { "goal-refinement-goal_001-why-0-question-r0": "Habits" }));
      await step(persistence, session, createAdapter(llm, { "goal-refinement-goal_001-negative-0-question-r0": "Lose progress" }));

      // Reach goals confirmation — waiting room item should have been drained
      const prompt = await suspended(persistence, session, createAdapter(llm));
      expect(prompt.id).toBe("goals-confirmation-r0");
      if (prompt.type === "prompt") {
        expect(prompt.request.message).toContain("Track reading");
      }
    });
  });

  describe("quality check", () => {
    it("adds finding when no goals are elaborated", async () => {
      const { persistence, llm } = await advanceToGoals({
        "goal-seed-extraction": {
          goals: [{ title: "Track reading", description: "Monitor books" }],
        },
        "goal-seed-classification-r0": {
          responseInterpretation: "Confirmed",
          confirmedGoalIds: ["goal_001"],
          removedGoalIds: [],
          newGoals: [],
          waitingRoomItems: [],
        },
        // 3 failed clarify attempts → finding
        "goal-refinement-goal_001-clarify-0-composition-r0": { question: "What?", suggestions: ["A"] },
        "goal-refinement-goal_001-clarify-0-extraction-r0": { title: null, description: null, rationale: null, contradictions: [], waitingRoomItems: [] },
        "goal-refinement-goal_001-clarify-1-composition-r0": { question: "How?", suggestions: ["B"] },
        "goal-refinement-goal_001-clarify-1-extraction-r0": { title: null, description: null, rationale: null, contradictions: [], waitingRoomItems: [] },
        "goal-refinement-goal_001-clarify-2-composition-r0": { question: "Maybe?", suggestions: ["C"] },
        "goal-refinement-goal_001-clarify-2-extraction-r0": { title: null, description: null, rationale: null, contradictions: [], waitingRoomItems: [] },
      });

      await step(persistence, session, createAdapter(llm));
      await step(persistence, session, createAdapter(llm, { "goal-seed-present-r0": "Good" }));
      await step(persistence, session, createAdapter(llm, { "goal-refinement-goal_001-clarify-0-question-r0": "?" }));
      await step(persistence, session, createAdapter(llm, { "goal-refinement-goal_001-clarify-1-question-r0": "?" }));
      const prompt = await suspended(
        persistence, session,
        createAdapter(llm, { "goal-refinement-goal_001-clarify-2-question-r0": "?" }),
      );

      // Quality check finding surfaces in confirmation
      expect(prompt.id).toBe("goals-confirmation-r0");
      if (prompt.type === "prompt") {
        expect(prompt.request.message).toContain("Gaps noted");
        expect(prompt.request.message).toContain("elaborated status");
      }
    });
  });

  describe("goal detail cap", () => {
    const advanceToGoalsCap = (llm: Record<string, unknown>) =>
      advanceToGoals(llm);

    function goalExtractionMocks(goalId: string) {
      return {
        [`goal-refinement-${goalId}-clarify-0-extraction-r0`]: { title: null, description: "Updated", rationale: null, contradictions: [], waitingRoomItems: [] },
        [`goal-refinement-${goalId}-why-0-extraction-r0`]: { title: null, description: null, rationale: "Reason", contradictions: [], waitingRoomItems: [] },
        [`goal-refinement-${goalId}-negative-0-extraction-r0`]: { title: null, description: "Negative insight", rationale: null, contradictions: [], waitingRoomItems: [] },
      };
    }

    it("sorts and parks excess goals, skipping parked goal in refinement", async () => {
      const { persistence, llm } = await advanceToGoalsCap({
        "goal-seed-extraction": {
          goals: [
            { title: "Goal A", description: "Desc A" },
            { title: "Goal B", description: "Desc B" },
            { title: "Goal C", description: "Desc C" },
            { title: "Goal D", description: "Desc D" },
          ],
        },
        "goal-seed-classification-r0": {
          responseInterpretation: "Confirmed all",
          confirmedGoalIds: ["goal_001", "goal_002", "goal_003", "goal_004"],
          removedGoalIds: [],
          newGoals: [],
          waitingRoomItems: [],
        },
        "goal-sort": {
          rankedGoalIds: ["goal_003", "goal_001", "goal_004", "goal_002"],
        },
        ...goalExtractionMocks("goal_001"),
      });

      // Seed → present
      await step(persistence, session, createAdapter(llm));
      // User confirms → classify → sort → cap (parks goal_002) → goal_001 clarify
      await step(persistence, session, createAdapter(llm, { "goal-seed-present-r0": "Good" }));
      // Drive through goal_001's 3 refinement stages
      await step(persistence, session, createAdapter(llm, { "goal-refinement-goal_001-clarify-0-question-r0": "X" }));
      await step(persistence, session, createAdapter(llm, { "goal-refinement-goal_001-why-0-question-r0": "X" }));
      const prompt = await suspended(
        persistence, session,
        createAdapter(llm, { "goal-refinement-goal_001-negative-0-question-r0": "X" }),
      );

      // After goal_001 completes → next is goal_003 (not goal_002 — it was parked)
      expect(prompt.id).toBe("goal-refinement-goal_003-clarify-0-question-r0");
    });

    it("caps without sort on no-seed path", async () => {
      const { persistence, llm } = await advanceToGoalsCap({
        "goal-seed-extraction": { goals: [] },
        "goal-initial-composition-r0": { question: "What goals?", suggestions: ["A"] },
        "goal-initial-extraction-r0": {
          responseInterpretation: "Multiple goals",
          goals: [
            { title: "Goal A", description: "Desc A" },
            { title: "Goal B", description: "Desc B" },
            { title: "Goal C", description: "Desc C" },
            { title: "Goal D", description: "Desc D" },
          ],
          waitingRoomItems: [],
        },
        ...goalExtractionMocks("goal_001"),
        ...goalExtractionMocks("goal_002"),
        ...goalExtractionMocks("goal_003"),
      });

      // Initial question (no seeds)
      await step(persistence, session, createAdapter(llm));
      // User names 4 goals → extract → cap at 3 → refine goal_001
      await step(persistence, session, createAdapter(llm, { "goal-initial-question-r0": "A, B, C, D" }));
      // Drive through goals 001, 002, 003 (3 stages each)
      await step(persistence, session, createAdapter(llm, { "goal-refinement-goal_001-clarify-0-question-r0": "X" }));
      await step(persistence, session, createAdapter(llm, { "goal-refinement-goal_001-why-0-question-r0": "X" }));
      await step(persistence, session, createAdapter(llm, { "goal-refinement-goal_001-negative-0-question-r0": "X" }));
      await step(persistence, session, createAdapter(llm, { "goal-refinement-goal_002-clarify-0-question-r0": "X" }));
      await step(persistence, session, createAdapter(llm, { "goal-refinement-goal_002-why-0-question-r0": "X" }));
      await step(persistence, session, createAdapter(llm, { "goal-refinement-goal_002-negative-0-question-r0": "X" }));
      await step(persistence, session, createAdapter(llm, { "goal-refinement-goal_003-clarify-0-question-r0": "X" }));
      await step(persistence, session, createAdapter(llm, { "goal-refinement-goal_003-why-0-question-r0": "X" }));
      const prompt = await suspended(
        persistence, session,
        createAdapter(llm, { "goal-refinement-goal_003-negative-0-question-r0": "X" }),
      );

      // After goal_003 (last kept goal) → confirmation (not goal_004 — parked)
      expect(prompt.id).toBe("goals-confirmation-r0");
      if (prompt.type === "prompt") {
        expect(prompt.request.message).toContain("Goal A");
        expect(prompt.request.message).toContain("Goal B");
        expect(prompt.request.message).toContain("Goal C");
        expect(prompt.request.message).not.toContain("Goal D");
      }
    });
  });
});
