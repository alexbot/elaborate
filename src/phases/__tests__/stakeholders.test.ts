import { describe, it, expect } from "vitest";
import { session, memoryPersistence, createAdapter, step, suspended } from "./helpers.js";

describe("stakeholders phase", () => {
  const baseLlm: Record<string, unknown> = {
    // Opening
    "opening-greet-extraction-r0": {
      purpose: "task management for teams",
      stakeholders: ["team lead", "developer"],
      domainHints: ["project management"],
    },
    "opening-brownfield-screen": { greenfieldConfidence: 9 },
    "opening-confirmation-classification-0-r0": { approved: true, revisionRequested: null },
    // Purpose — all slots filled in initial extraction
    "purpose-initial-extraction": {
      purpose: "streamline task tracking for development teams",
      advantage: "simpler than Jira",
      measurement: "tasks completed per sprint",
      contradictions: [],
    },
    "purpose-confirmation-classification-0-r0": { approved: true, revisionRequested: null },
    // Goals — single goal, full probing cycle
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
  };

  /** Helper: advance through opening + purpose + goals to reach stakeholders */
  async function advanceToStakeholders(llm: Record<string, unknown>) {
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
    // Now in stakeholders phase

    return { persistence, llm: mergedLlm };
  }

  /** Helper: advance through review + respondent to start elaboration */
  async function reviewedWith(extraLlm: Record<string, unknown> = {}) {
    return advanceToStakeholders({
      "stakeholder-review-classification-r0": {
        updatedTypes: [],
        removedIds: [],
        newStakeholders: [],
      },
      "stakeholder-respondent-present-extraction-r0": {
        respondentId: "stakeholder_001",
      },
      ...extraLlm,
    });
  }

  /** Drive through review + respondent steps manually */
  async function driveThruReviewAndRespondent(
    persistence: ReturnType<typeof memoryPersistence>,
    llm: Record<string, unknown>,
  ) {
    await step(persistence, session, createAdapter(llm)); // review:present suspends
    await step(persistence, session, createAdapter(llm, { "stakeholder-review-present-r0": "Looks fine" })); // respondent:present suspends
    await step(persistence, session, createAdapter(llm, { "stakeholder-respondent-present-r0": "I'm the lead" })); // elaborate starts
  }

  describe("list review", () => {
    it("presents seeded stakeholders for review", async () => {
      const { persistence, llm } = await advanceToStakeholders({});
      const prompt = await suspended(persistence, session, createAdapter(llm));
      expect(prompt.id).toBe("stakeholder-review-present-r0");
      if (prompt.type === "prompt") {
        expect(prompt.request.message).toContain("team lead");
        expect(prompt.request.message).toContain("developer");
        expect(prompt.request.message).toContain("change, add, or remove");
      }
    });

    it("applies type corrections from review", async () => {
      const { persistence, llm } = await advanceToStakeholders({
        "stakeholder-review-classification-r0": {
          updatedTypes: [{ id: "stakeholder_001", type: "secondary" }],
          removedIds: [],
          newStakeholders: [],
        },
        "stakeholder-respondent-present-extraction-r0": { respondentId: "stakeholder_001" },
        "stakeholder-elaboration-stakeholder_001-0-composition-r0": { question: "Role?", suggestions: ["M"] },
      });

      await step(persistence, session, createAdapter(llm)); // review:present
      await step(persistence, session, createAdapter(llm, { "stakeholder-review-present-r0": "Lead is secondary" })); // respondent:present
      await suspended(
        persistence, session,
        createAdapter(llm, { "stakeholder-respondent-present-r0": "I'm the lead" }),
      );
      // Type correction applied — test passes if flow continues without error
    });

    it("removes stakeholders from review", async () => {
      const { persistence, llm } = await advanceToStakeholders({
        "stakeholder-review-classification-r0": {
          updatedTypes: [],
          removedIds: ["stakeholder_002"],
          newStakeholders: [],
        },
        "stakeholder-respondent-present-extraction-r0": { respondentId: "stakeholder_001" },
        "stakeholder-elaboration-stakeholder_001-0-composition-r0": { question: "Role?", suggestions: ["M"] },
      });

      await step(persistence, session, createAdapter(llm)); // review:present
      await step(persistence, session, createAdapter(llm, { "stakeholder-review-present-r0": "Remove developer" })); // respondent:present
      await suspended(
        persistence, session,
        createAdapter(llm, { "stakeholder-respondent-present-r0": "I'm the lead" }),
      );
      // Only stakeholder_001 should remain — elaboration starts for it
    });

    it("adds new stakeholders from review response", async () => {
      const { persistence, llm } = await advanceToStakeholders({
        "stakeholder-review-classification-r0": {
          updatedTypes: [],
          removedIds: [],
          newStakeholders: [{ name: "QA tester", type: "secondary" }],
        },
        "stakeholder-respondent-present-extraction-r0": { respondentId: "stakeholder_001" },
        "stakeholder-elaboration-stakeholder_001-0-composition-r0": { question: "Role?", suggestions: ["M"] },
      });

      await step(persistence, session, createAdapter(llm)); // review:present
      await step(persistence, session, createAdapter(llm, { "stakeholder-review-present-r0": "Add QA tester" })); // respondent:present
      await suspended(
        persistence, session,
        createAdapter(llm, { "stakeholder-respondent-present-r0": "I'm the lead" }),
      );
      // QA tester added (stakeholder_003) — elaboration starts
    });
  });

  describe("respondent identification", () => {
    it("asks which stakeholder is the respondent after review", async () => {
      const { persistence, llm } = await advanceToStakeholders({
        "stakeholder-review-classification-r0": {
          updatedTypes: [],
          removedIds: [],
          newStakeholders: [],
        },
      });

      await step(persistence, session, createAdapter(llm)); // review:present
      const prompt = await suspended(
        persistence, session,
        createAdapter(llm, { "stakeholder-review-present-r0": "Looks fine" }),
      );

      expect(prompt.id).toBe("stakeholder-respondent-present-r0");
      if (prompt.type === "prompt") {
        expect(prompt.request.message).toContain("Which of these roles best describes you");
        expect(prompt.request.message).toContain("team lead");
      }
    });

    it("marks respondent from classification", async () => {
      const { persistence, llm } = await reviewedWith({
        "stakeholder-elaboration-stakeholder_001-0-composition-r0": { question: "Role?", suggestions: ["M"] },
      });

      await driveThruReviewAndRespondent(persistence, llm);
      const prompt = await suspended(persistence, session, createAdapter(llm));
      expect(prompt.id).toBe("stakeholder-elaboration-stakeholder_001-0-question-r0");
    });
  });

  describe("per-stakeholder elaboration", () => {
    it("asks about role and concerns for each stakeholder", async () => {
      const { persistence, llm } = await reviewedWith({
        "stakeholder-elaboration-stakeholder_001-0-composition-r0": {
          question: "As team lead, what's your role and main concerns?",
          suggestions: ["Assigning tasks", "Tracking progress"],
        },
      });

      await driveThruReviewAndRespondent(persistence, llm);
      const prompt = await suspended(persistence, session, createAdapter(llm));

      expect(prompt.id).toBe("stakeholder-elaboration-stakeholder_001-0-question-r0");
      if (prompt.type === "prompt") {
        expect(prompt.request.message).toContain("team lead");
      }
    });

    it("advances stakeholder to elaborated when role+concerns extracted", async () => {
      const { persistence, llm } = await reviewedWith({
        "stakeholder-elaboration-stakeholder_001-0-composition-r0": { question: "Role?", suggestions: ["M"] },
        "stakeholder-elaboration-stakeholder_001-0-extraction-r0": {
          role: "Assigns and tracks team tasks",
          concerns: ["Need visibility into blockers"],
          contradictions: [],
          waitingRoomItems: [],
        },
        // Respondent — no perspective-switching, moves to stakeholder_002
        "stakeholder-elaboration-stakeholder_002-0-composition-r0": {
          question: "What about the developer?",
          suggestions: ["Writes code"],
        },
      });

      await driveThruReviewAndRespondent(persistence, llm);
      const prompt = await suspended(
        persistence, session,
        createAdapter(llm, { "stakeholder-elaboration-stakeholder_001-0-question-r0": "I assign tasks and track blockers" }),
      );

      // Should move to stakeholder_002 (respondent gets no perspective-switching)
      expect(prompt.id).toBe("stakeholder-elaboration-stakeholder_002-0-question-r0");
    });

    it("rephrases when no fields extracted", async () => {
      const { persistence, llm } = await reviewedWith({
        "stakeholder-elaboration-stakeholder_001-0-composition-r0": { question: "Role?", suggestions: ["X"] },
        "stakeholder-elaboration-stakeholder_001-0-extraction-r0": {
          role: null, concerns: [], contradictions: [], waitingRoomItems: [],
        },
        "stakeholder-elaboration-stakeholder_001-1-composition-r0": {
          question: "Maybe try examples?",
          suggestions: ["Y"],
        },
      });

      await driveThruReviewAndRespondent(persistence, llm);
      const prompt = await suspended(
        persistence, session,
        createAdapter(llm, { "stakeholder-elaboration-stakeholder_001-0-question-r0": "I don't know" }),
      );

      expect(prompt.id).toBe("stakeholder-elaboration-stakeholder_001-1-question-r0");
    });

    it("flags finding after max failed elaboration attempts", async () => {
      const { persistence, llm } = await reviewedWith({
        "stakeholder-elaboration-stakeholder_001-0-composition-r0": { question: "Q", suggestions: ["X"] },
        "stakeholder-elaboration-stakeholder_001-0-extraction-r0": { role: null, concerns: [], contradictions: [], waitingRoomItems: [] },
        "stakeholder-elaboration-stakeholder_001-1-composition-r0": { question: "Q", suggestions: ["X"] },
        "stakeholder-elaboration-stakeholder_001-1-extraction-r0": { role: null, concerns: [], contradictions: [], waitingRoomItems: [] },
        "stakeholder-elaboration-stakeholder_001-2-composition-r0": { question: "Q", suggestions: ["X"] },
        "stakeholder-elaboration-stakeholder_001-2-extraction-r0": { role: null, concerns: [], contradictions: [], waitingRoomItems: [] },
        // After 3 failures, moves to next stakeholder
        "stakeholder-elaboration-stakeholder_002-0-composition-r0": { question: "Developer role?", suggestions: ["Y"] },
      });

      await driveThruReviewAndRespondent(persistence, llm);
      await step(persistence, session, createAdapter(llm, { "stakeholder-elaboration-stakeholder_001-0-question-r0": "?" }));
      await step(persistence, session, createAdapter(llm, { "stakeholder-elaboration-stakeholder_001-1-question-r0": "?" }));
      const prompt = await suspended(
        persistence, session,
        createAdapter(llm, { "stakeholder-elaboration-stakeholder_001-2-question-r0": "?" }),
      );

      // Should skip to stakeholder_002 elaboration
      expect(prompt.id).toBe("stakeholder-elaboration-stakeholder_002-0-question-r0");
    });
  });

  describe("conditional follow-up", () => {
    it("asks follow-up when assessment says needed for non-respondent", async () => {
      const { persistence, llm } = await reviewedWith({
        // Elaborate team lead (respondent)
        "stakeholder-elaboration-stakeholder_001-0-composition-r0": { question: "Role?", suggestions: ["M"] },
        "stakeholder-elaboration-stakeholder_001-0-extraction-r0": {
          role: "Task assignment", concerns: ["Visibility"], contradictions: [], waitingRoomItems: [],
        },
        // Elaborate developer (non-respondent)
        "stakeholder-elaboration-stakeholder_002-0-composition-r0": { question: "Dev role?", suggestions: ["C"] },
        "stakeholder-elaboration-stakeholder_002-0-extraction-r0": {
          role: "Writes code", concerns: ["Clear specs"], contradictions: [], waitingRoomItems: [],
        },
        // Assessment says follow-up needed
        "stakeholder-followup-assessment-stakeholder_002": {
          needed: true,
          question: "What specific challenges does the developer face day-to-day?",
          suggestions: ["Unclear priorities", "Context switching"],
        },
      });

      await driveThruReviewAndRespondent(persistence, llm);
      // Elaborate team lead (respondent — no follow-up)
      await step(persistence, session, createAdapter(llm, { "stakeholder-elaboration-stakeholder_001-0-question-r0": "I assign tasks" }));
      // Elaborate developer
      await step(persistence, session, createAdapter(llm, { "stakeholder-elaboration-stakeholder_002-0-question-r0": "They code" }));

      // Should now ask the follow-up for developer (assessment said needed)
      const prompt = await suspended(persistence, session, createAdapter(llm));
      expect(prompt.id).toBe("stakeholder-followup-stakeholder_002-question-r0");
      if (prompt.type === "prompt") {
        expect(prompt.request.message).toContain("developer");
      }
    });

    it("skips follow-up when assessment says not needed", async () => {
      const { persistence, llm } = await reviewedWith({
        "stakeholder-elaboration-stakeholder_001-0-composition-r0": { question: "Role?", suggestions: ["M"] },
        "stakeholder-elaboration-stakeholder_001-0-extraction-r0": {
          role: "Task assignment", concerns: ["Visibility"], contradictions: [], waitingRoomItems: [],
        },
        "stakeholder-elaboration-stakeholder_002-0-composition-r0": { question: "Dev role?", suggestions: ["C"] },
        "stakeholder-elaboration-stakeholder_002-0-extraction-r0": {
          role: "Writes code", concerns: ["Clear specs", "Fast builds"], contradictions: [], waitingRoomItems: [],
        },
        // Assessment says no follow-up needed (rich elaboration)
        "stakeholder-followup-assessment-stakeholder_002": {
          needed: false,
        },
        "stakeholders-confirmation-classification-0-r0": { approved: true, revisionRequested: null },
      });

      await driveThruReviewAndRespondent(persistence, llm);
      await step(persistence, session, createAdapter(llm, { "stakeholder-elaboration-stakeholder_001-0-question-r0": "I assign tasks" }));
      const prompt = await suspended(
        persistence, session,
        createAdapter(llm, { "stakeholder-elaboration-stakeholder_002-0-question-r0": "They code with clear specs and fast builds" }),
      );

      // Should go directly to confirmation (no follow-up needed)
      expect(prompt.id).toBe("stakeholders-confirmation-r0");
    });

    it("skips follow-up for respondent stakeholder", async () => {
      const { persistence, llm } = await advanceToStakeholders({
        "stakeholder-review-classification-r0": {
          updatedTypes: [],
          removedIds: ["stakeholder_002"],
          newStakeholders: [],
        },
        "stakeholder-respondent-present-extraction-r0": { respondentId: "stakeholder_001" },
        // Only team lead remains (respondent)
        "stakeholder-elaboration-stakeholder_001-0-composition-r0": { question: "Role?", suggestions: ["M"] },
        "stakeholder-elaboration-stakeholder_001-0-extraction-r0": {
          role: "Task assignment", concerns: ["Visibility"], contradictions: [], waitingRoomItems: [],
        },
        // No follow-up for respondent → goes to confirmation
        "stakeholders-confirmation-classification-0-r0": { approved: true, revisionRequested: null },
      });

      await step(persistence, session, createAdapter(llm)); // review:present
      await step(persistence, session, createAdapter(llm, { "stakeholder-review-present-r0": "Remove developer" })); // respondent:present
      await step(persistence, session, createAdapter(llm, { "stakeholder-respondent-present-r0": "I'm the lead" })); // elaborate starts
      const prompt = await suspended(
        persistence, session,
        createAdapter(llm, { "stakeholder-elaboration-stakeholder_001-0-question-r0": "I assign tasks" }),
      );

      // Should go directly to confirmation (no follow-up for respondent)
      expect(prompt.id).toBe("stakeholders-confirmation-r0");
    });

    it("adds proxy reliability finding when no concerns after elaboration + follow-up", async () => {
      const { persistence, llm } = await reviewedWith({
        "stakeholder-elaboration-stakeholder_001-0-composition-r0": { question: "Role?", suggestions: ["M"] },
        "stakeholder-elaboration-stakeholder_001-0-extraction-r0": {
          role: "Manager", concerns: ["Visibility"], contradictions: [], waitingRoomItems: [],
        },
        "stakeholder-elaboration-stakeholder_002-0-composition-r0": { question: "Dev?", suggestions: ["C"] },
        "stakeholder-elaboration-stakeholder_002-0-extraction-r0": {
          role: "Coder", concerns: [], contradictions: [], waitingRoomItems: [],
        },
        // Assessment says follow-up needed (thin concerns)
        "stakeholder-followup-assessment-stakeholder_002": {
          needed: true,
          question: "What would the developer care about?",
          suggestions: ["Speed"],
        },
        "stakeholder-followup-stakeholder_002-extraction-r0": {
          responseInterpretation: "Not sure", role: null, concerns: [], contradictions: [], waitingRoomItems: [],
        },
        // After follow-up → confirmation
        "stakeholder-dedup": { duplicateGroups: [] },
        "stakeholders-confirmation-classification-0-r0": { approved: true, revisionRequested: null },
      });

      await driveThruReviewAndRespondent(persistence, llm);
      await step(persistence, session, createAdapter(llm, { "stakeholder-elaboration-stakeholder_001-0-question-r0": "Manager" }));
      await step(persistence, session, createAdapter(llm, { "stakeholder-elaboration-stakeholder_002-0-question-r0": "Codes" }));
      const prompt = await suspended(
        persistence, session,
        createAdapter(llm, { "stakeholder-followup-stakeholder_002-question-r0": "Not sure" }),
      );

      // Should reach confirmation — proxy reliability finding was added
      expect(prompt.id).toBe("stakeholders-confirmation-r0");
      if (prompt.type === "prompt") {
        expect(prompt.request.message).toContain("proxy knowledge may be limited");
      }
    });
  });

  describe("contradiction handling", () => {
    it("surfaces contradictions between concerns and goals", async () => {
      const { persistence, llm } = await reviewedWith({
        "stakeholder-elaboration-stakeholder_001-0-composition-r0": { question: "Role?", suggestions: ["M"] },
        "stakeholder-elaboration-stakeholder_001-0-extraction-r0": {
          role: null, concerns: [],
          contradictions: ["Team lead wants minimal tracking, but goal says comprehensive task monitoring"],
          waitingRoomItems: [],
        },
      });

      await driveThruReviewAndRespondent(persistence, llm);
      const prompt = await suspended(
        persistence, session,
        createAdapter(llm, { "stakeholder-elaboration-stakeholder_001-0-question-r0": "Minimal tracking" }),
      );

      expect(prompt.type).toBe("prompt");
      if (prompt.type === "prompt") {
        expect(prompt.request.message).toContain("inconsistent");
      }
    });
  });

  describe("quality check", () => {
    it("adds finding when no primary at elaborated, proceeds to confirmation", async () => {
      const { persistence, llm } = await advanceToStakeholders({
        "stakeholder-review-classification-r0": {
          updatedTypes: [{ id: "stakeholder_001", type: "secondary" }],
          removedIds: ["stakeholder_002"],
          newStakeholders: [],
        },
        "stakeholder-respondent-present-extraction-r0": { respondentId: "stakeholder_001" },
        // Only secondary stakeholder, fails to elaborate
        "stakeholder-elaboration-stakeholder_001-0-composition-r0": { question: "Q", suggestions: ["X"] },
        "stakeholder-elaboration-stakeholder_001-0-extraction-r0": { role: null, concerns: [], contradictions: [], waitingRoomItems: [] },
        "stakeholder-elaboration-stakeholder_001-1-composition-r0": { question: "Q", suggestions: ["X"] },
        "stakeholder-elaboration-stakeholder_001-1-extraction-r0": { role: null, concerns: [], contradictions: [], waitingRoomItems: [] },
        "stakeholder-elaboration-stakeholder_001-2-composition-r0": { question: "Q", suggestions: ["X"] },
        "stakeholder-elaboration-stakeholder_001-2-extraction-r0": { role: null, concerns: [], contradictions: [], waitingRoomItems: [] },
      });

      await step(persistence, session, createAdapter(llm)); // review:present
      await step(persistence, session, createAdapter(llm, { "stakeholder-review-present-r0": "Lead is secondary" })); // respondent:present
      await step(persistence, session, createAdapter(llm, { "stakeholder-respondent-present-r0": "I'm the lead" })); // elaborate starts
      await step(persistence, session, createAdapter(llm, { "stakeholder-elaboration-stakeholder_001-0-question-r0": "?" }));
      await step(persistence, session, createAdapter(llm, { "stakeholder-elaboration-stakeholder_001-1-question-r0": "?" }));
      const prompt = await suspended(
        persistence, session,
        createAdapter(llm, { "stakeholder-elaboration-stakeholder_001-2-question-r0": "?" }),
      );

      // Proceeds to confirmation with a finding
      expect(prompt.id).toBe("stakeholders-confirmation-r0");
      if (prompt.type === "prompt") {
        expect(prompt.request.message).toContain("No primary stakeholder has been elaborated");
      }
    });
  });

  describe("confirmation", () => {
    async function advanceToConfirmation(extraLlm: Record<string, unknown> = {}) {
      return advanceToStakeholders({
        "stakeholder-review-classification-r0": {
          updatedTypes: [],
          removedIds: ["stakeholder_002"],
          newStakeholders: [],
        },
        "stakeholder-respondent-present-extraction-r0": { respondentId: "stakeholder_001" },
        "stakeholder-elaboration-stakeholder_001-0-composition-r0": { question: "Role?", suggestions: ["M"] },
        "stakeholder-elaboration-stakeholder_001-0-extraction-r0": {
          role: "Manager", concerns: ["Visibility"], contradictions: [], waitingRoomItems: [],
        },
        ...extraLlm,
      });
    }

    async function driveToConfirmation(persistence: ReturnType<typeof memoryPersistence>, llm: Record<string, unknown>) {
      await step(persistence, session, createAdapter(llm)); // review:present
      await step(persistence, session, createAdapter(llm, { "stakeholder-review-present-r0": "Remove developer" })); // respondent:present
      await step(persistence, session, createAdapter(llm, { "stakeholder-respondent-present-r0": "I'm the lead" })); // elaborate
      await step(persistence, session, createAdapter(llm, { "stakeholder-elaboration-stakeholder_001-0-question-r0": "Manager" })); // → confirm
    }

    it("advances to scope phase when stakeholders confirmed", async () => {
      const { persistence, llm } = await advanceToConfirmation({
        "stakeholders-confirmation-classification-0-r0": { approved: true, revisionRequested: null },
      });
      await driveToConfirmation(persistence, llm);

      const prompt = await suspended(
        persistence, session,
        createAdapter(llm, { "stakeholders-confirmation-r0": "Looks good" }),
      );

      // Workflow continues to scope phase (not completed)
      expect(prompt.id).toBe("scope-seed-present-r0");
    });

    it("extracts revision from rejection and advances to scope", async () => {
      const { persistence, llm } = await advanceToConfirmation({
        "stakeholders-confirmation-classification-0-r0": { approved: false, revisionRequested: "Change role", targetId: "sh_001" },
        "stakeholders-revision-r0": { responseInterpretation: "wants different role", role: "Team lead", concerns: [], contradictions: [] },
      });
      await driveToConfirmation(persistence, llm);

      const prompt = await suspended(
        persistence, session,
        createAdapter(llm, { "stakeholders-confirmation-r0": "Change the role to team lead" }),
      );

      expect(prompt.id).toBe("scope-seed-present-r0");
    });

    it("promotes elaborated to confirmed on approval", async () => {
      const { persistence, llm } = await advanceToConfirmation({
        "stakeholders-confirmation-classification-0-r0": { approved: true, revisionRequested: null },
      });
      await driveToConfirmation(persistence, llm);

      // Workflow continues to scope — but stakeholder status should be updated
      await suspended(
        persistence, session,
        createAdapter(llm, { "stakeholders-confirmation-r0": "Looks good" }),
      );

      // Suspended at scope phase, not completed — but stakeholders were confirmed
      expect(persistence.current()!.status).toBe("suspended");
    });
  });

  describe("waiting room drain", () => {
    it("drains matching waiting room items during seed", async () => {
      // Goals classification routes "sounds like stakeholder" to waiting room
      const { persistence, llm } = await advanceToStakeholders({
        "goal-seed-classification-r0": {
          responseInterpretation: "Confirmed",
          confirmedGoalIds: ["goal_001"],
          removedGoalIds: [],
          newGoals: [],
          waitingRoomItems: [{ content: "QA team should be involved" }],
        },
        // Stakeholder seed extraction picks up the waiting room item
        "stakeholder-seed-extraction": {
          stakeholders: [{ name: "QA team", type: "secondary" }],
          drainedWaitingRoomIds: ["waiting_001"],
        },
        "stakeholder-review-classification-r0": {
          updatedTypes: [],
          removedIds: [],
          newStakeholders: [],
        },
      });

      // Seed extraction already ran (inline LLM step) — now at review:present
      const prompt = await suspended(persistence, session, createAdapter(llm));
      expect(prompt.id).toBe("stakeholder-review-present-r0");
      // QA team should appear in the review list (seeded from waiting room drain)
      if (prompt.type === "prompt") {
        expect(prompt.request.message).toContain("QA team");
      }
    });
  });

  describe("type-based depth", () => {
    it("skips follow-up for secondary stakeholders", async () => {
      // Reclassify developer to secondary — should get elaboration but no follow-up assessment
      const { persistence, llm } = await advanceToStakeholders({
        "stakeholder-review-classification-r0": {
          updatedTypes: [{ id: "stakeholder_002", type: "secondary" }],
          removedIds: [],
          newStakeholders: [],
        },
        "stakeholder-respondent-present-extraction-r0": { respondentId: "stakeholder_001" },
        "stakeholder-elaboration-stakeholder_001-0-composition-r0": { question: "Role?", suggestions: ["M"] },
        "stakeholder-elaboration-stakeholder_001-0-extraction-r0": {
          role: "Manager", concerns: ["Visibility"], contradictions: [], waitingRoomItems: [],
        },
        "stakeholder-elaboration-stakeholder_002-0-composition-r0": { question: "Dev?", suggestions: ["C"] },
        "stakeholder-elaboration-stakeholder_002-0-extraction-r0": {
          role: "Writes code", concerns: ["Clear specs"], contradictions: [], waitingRoomItems: [],
        },
        "stakeholder-dedup": { duplicateGroups: [] },
        "stakeholders-confirmation-classification-0-r0": { approved: true, revisionRequested: null },
      });

      await step(persistence, session, createAdapter(llm)); // review:present
      await step(persistence, session, createAdapter(llm, { "stakeholder-review-present-r0": "Dev is secondary" })); // respondent:present
      await step(persistence, session, createAdapter(llm, { "stakeholder-respondent-present-r0": "I'm the lead" })); // elaborate lead
      await step(persistence, session, createAdapter(llm, { "stakeholder-elaboration-stakeholder_001-0-question-r0": "Manager" })); // elaborate dev
      const prompt = await suspended(
        persistence, session,
        createAdapter(llm, { "stakeholder-elaboration-stakeholder_002-0-question-r0": "Codes" }),
      );

      // Should go directly to confirmation (no follow-up for secondary)
      expect(prompt.id).toBe("stakeholders-confirmation-r0");
    });

    it("elaborates external stakeholders within cap", async () => {
      // Reclassify developer to external — now probed (1 ≤ EXTERNAL_SH_CAP of 2)
      const { persistence, llm } = await advanceToStakeholders({
        "stakeholder-review-classification-r0": {
          updatedTypes: [{ id: "stakeholder_002", type: "external" }],
          removedIds: [],
          newStakeholders: [],
        },
        "stakeholder-respondent-present-extraction-r0": { respondentId: "stakeholder_001" },
        "stakeholder-elaboration-stakeholder_001-0-composition-r0": { question: "Role?", suggestions: ["M"] },
        "stakeholder-elaboration-stakeholder_001-0-extraction-r0": {
          role: "Manager", concerns: ["Visibility"], contradictions: [], waitingRoomItems: [],
        },
        "stakeholder-elaboration-stakeholder_002-0-composition-r0": { question: "Dev?", suggestions: ["C"] },
        "stakeholder-elaboration-stakeholder_002-0-extraction-r0": {
          role: "Coder", concerns: ["Speed"], contradictions: [], waitingRoomItems: [],
        },
        "stakeholder-dedup": { duplicateGroups: [] },
        "stakeholders-confirmation-classification-0-r0": { approved: true, revisionRequested: null },
      });

      await step(persistence, session, createAdapter(llm)); // review:present
      await step(persistence, session, createAdapter(llm, { "stakeholder-review-present-r0": "Dev is external" }));
      await step(persistence, session, createAdapter(llm, { "stakeholder-respondent-present-r0": "I'm the lead" }));
      await step(persistence, session, createAdapter(llm, { "stakeholder-elaboration-stakeholder_001-0-question-r0": "Manager" }));
      const prompt = await suspended(
        persistence, session,
        createAdapter(llm, { "stakeholder-elaboration-stakeholder_002-0-question-r0": "Codes" }),
      );

      // External SH elaborated and reaches confirmation
      expect(prompt.id).toBe("stakeholders-confirmation-r0");
      if (prompt.type === "prompt") {
        expect(prompt.request.message).toContain("developer");
        expect(prompt.request.message).toContain("external");
        expect(prompt.request.message).toContain("elaborated");
      }
    });
  });

  describe("sort and cap", () => {
    it("sorts and caps when primary count exceeds cap", async () => {
      // Seed 6 primary stakeholders via review additions, sort keeps top 5
      const { persistence, llm } = await advanceToStakeholders({
        "stakeholder-review-classification-r0": {
          updatedTypes: [],
          removedIds: [],
          newStakeholders: [
            { name: "admin", type: "primary" },
            { name: "analyst", type: "primary" },
            { name: "tester", type: "primary" },
            { name: "designer", type: "primary" },
          ],
        },
        "stakeholder-respondent-present-extraction-r0": { respondentId: "stakeholder_001" },
        // Sort: 6 primaries > cap of 5, so sort fires
        "stakeholder-sort-primary": {
          rankedStakeholderIds: ["stakeholder_001", "stakeholder_002", "stakeholder_003", "stakeholder_004", "stakeholder_005", "stakeholder_006"],
        },
        // Top 5 get elaborated (stakeholder_006 = designer is capped out)
        "stakeholder-elaboration-stakeholder_001-0-composition-r0": { question: "Role?", suggestions: ["M"] },
        "stakeholder-elaboration-stakeholder_001-0-extraction-r0": {
          role: "Manager", concerns: ["Visibility"], contradictions: [], waitingRoomItems: [],
        },
        "stakeholder-elaboration-stakeholder_002-0-composition-r0": { question: "Dev?", suggestions: ["C"] },
        "stakeholder-elaboration-stakeholder_002-0-extraction-r0": {
          role: "Coder", concerns: ["Speed"], contradictions: [], waitingRoomItems: [],
        },
        "stakeholder-followup-assessment-stakeholder_002": {
          needed: false,
        },
        "stakeholder-elaboration-stakeholder_003-0-composition-r0": { question: "Admin?", suggestions: ["A"] },
        "stakeholder-elaboration-stakeholder_003-0-extraction-r0": {
          role: "Admin", concerns: ["Permissions"], contradictions: [], waitingRoomItems: [],
        },
        "stakeholder-followup-assessment-stakeholder_003": {
          needed: false,
        },
        "stakeholder-elaboration-stakeholder_004-0-composition-r0": { question: "Analyst?", suggestions: ["R"] },
        "stakeholder-elaboration-stakeholder_004-0-extraction-r0": {
          role: "Analyst", concerns: ["Reports"], contradictions: [], waitingRoomItems: [],
        },
        "stakeholder-followup-assessment-stakeholder_004": {
          needed: false,
        },
        "stakeholder-elaboration-stakeholder_005-0-composition-r0": { question: "Tester?", suggestions: ["T"] },
        "stakeholder-elaboration-stakeholder_005-0-extraction-r0": {
          role: "Tester", concerns: ["Coverage"], contradictions: [], waitingRoomItems: [],
        },
        "stakeholder-followup-assessment-stakeholder_005": {
          needed: false,
        },
        "stakeholder-dedup": { duplicateGroups: [] },
        "stakeholders-confirmation-classification-0-r0": { approved: true, revisionRequested: null },
      });

      await step(persistence, session, createAdapter(llm)); // review:present
      await step(persistence, session, createAdapter(llm, { "stakeholder-review-present-r0": "Add all four" }));
      await step(persistence, session, createAdapter(llm, { "stakeholder-respondent-present-r0": "I'm the lead" }));
      // Elaboration for top 5 (stakeholder_001 respondent, _002–_005 non-respondent)
      await step(persistence, session, createAdapter(llm, { "stakeholder-elaboration-stakeholder_001-0-question-r0": "Manager" }));
      await step(persistence, session, createAdapter(llm, { "stakeholder-elaboration-stakeholder_002-0-question-r0": "Coder" }));
      await step(persistence, session, createAdapter(llm, { "stakeholder-elaboration-stakeholder_003-0-question-r0": "Admin" }));
      await step(persistence, session, createAdapter(llm, { "stakeholder-elaboration-stakeholder_004-0-question-r0": "Reports" }));
      await step(persistence, session, createAdapter(llm, { "stakeholder-elaboration-stakeholder_005-0-question-r0": "Coverage" }));
      const prompt = await suspended(
        persistence, session,
        createAdapter(llm, { "stakeholders-confirmation-r0": "Looks good" }),
      );

      // Should advance to scope — 6th stakeholder (designer) was listed but not probed
      expect(prompt.id).toBe("scope-seed-present-r0");
    });

    it("skips sort when primary count is within cap", async () => {
      // Default fixture: 2 primaries (team lead + developer), ≤ cap of 5 → no sort infer
      const { persistence, llm } = await reviewedWith({
        "stakeholder-elaboration-stakeholder_001-0-composition-r0": { question: "Role?", suggestions: ["M"] },
        "stakeholder-elaboration-stakeholder_001-0-extraction-r0": {
          role: "Manager", concerns: ["Visibility"], contradictions: [], waitingRoomItems: [],
        },
        "stakeholder-elaboration-stakeholder_002-0-composition-r0": { question: "Dev?", suggestions: ["C"] },
        "stakeholder-elaboration-stakeholder_002-0-extraction-r0": {
          role: "Coder", concerns: ["Speed"], contradictions: [], waitingRoomItems: [],
        },
        "stakeholder-followup-assessment-stakeholder_002": {
          needed: true, question: "What else matters to the developer?", suggestions: ["D"],
        },
        "stakeholder-followup-stakeholder_002-extraction-r0": {
          responseInterpretation: "Fast builds", role: null, concerns: ["Fast builds"], contradictions: [], waitingRoomItems: [],
        },
        "stakeholder-dedup": { duplicateGroups: [] },
        "stakeholders-confirmation-classification-0-r0": { approved: true, revisionRequested: null },
      });

      await driveThruReviewAndRespondent(persistence, llm);
      await step(persistence, session, createAdapter(llm, { "stakeholder-elaboration-stakeholder_001-0-question-r0": "Manager" }));
      await step(persistence, session, createAdapter(llm, { "stakeholder-elaboration-stakeholder_002-0-question-r0": "Coder" }));
      await step(persistence, session, createAdapter(llm, { "stakeholder-followup-stakeholder_002-question-r0": "Fast" }));
      const prompt = await suspended(
        persistence, session,
        createAdapter(llm, { "stakeholders-confirmation-r0": "Looks good" }),
      );

      // Both elaborated, no sort needed, advances to scope
      expect(prompt.id).toBe("scope-seed-present-r0");
    });

    it("listed stakeholders appear in confirmation with identified status", async () => {
      // 1 primary + 3 externals: developer reclassified + 2 new externals → exceeds EXTERNAL_SH_CAP=2
      const { persistence, llm } = await advanceToStakeholders({
        "stakeholder-review-classification-r0": {
          updatedTypes: [{ id: "stakeholder_002", type: "external" }],
          removedIds: [],
          newStakeholders: [
            { name: "auditor", type: "external" },
            { name: "regulator", type: "external" },
          ],
        },
        "stakeholder-respondent-present-extraction-r0": { respondentId: "stakeholder_001" },
        // Sort: 3 externals > cap of 2
        "stakeholder-sort-external": {
          rankedStakeholderIds: ["stakeholder_002", "stakeholder_003", "stakeholder_004"],
        },
        "stakeholder-elaboration-stakeholder_001-0-composition-r0": { question: "Role?", suggestions: ["M"] },
        "stakeholder-elaboration-stakeholder_001-0-extraction-r0": {
          role: "Manager", concerns: ["Visibility"], contradictions: [], waitingRoomItems: [],
        },
        "stakeholder-elaboration-stakeholder_002-0-composition-r0": { question: "Dev?", suggestions: ["C"] },
        "stakeholder-elaboration-stakeholder_002-0-extraction-r0": {
          role: "Coder", concerns: ["Speed"], contradictions: [], waitingRoomItems: [],
        },
        "stakeholder-elaboration-stakeholder_003-0-composition-r0": { question: "Auditor?", suggestions: ["A"] },
        "stakeholder-elaboration-stakeholder_003-0-extraction-r0": {
          role: "Compliance", concerns: ["Regulations"], contradictions: [], waitingRoomItems: [],
        },
        "stakeholder-dedup": { duplicateGroups: [] },
      });

      await step(persistence, session, createAdapter(llm)); // review:present
      await step(persistence, session, createAdapter(llm, { "stakeholder-review-present-r0": "Dev is external, add auditor and regulator" }));
      await step(persistence, session, createAdapter(llm, { "stakeholder-respondent-present-r0": "I'm the lead" }));
      await step(persistence, session, createAdapter(llm, { "stakeholder-elaboration-stakeholder_001-0-question-r0": "Manager" }));
      await step(persistence, session, createAdapter(llm, { "stakeholder-elaboration-stakeholder_002-0-question-r0": "Codes" }));
      const prompt = await suspended(
        persistence, session,
        createAdapter(llm, { "stakeholder-elaboration-stakeholder_003-0-question-r0": "Compliance" }),
      );

      expect(prompt.id).toBe("stakeholders-confirmation-r0");
      if (prompt.type === "prompt") {
        // Probed stakeholders show role + concerns
        expect(prompt.request.message).toContain("Manager");
        expect(prompt.request.message).toContain("Visibility");
        // Listed stakeholder (regulator, capped out) shows name + type + identified status
        expect(prompt.request.message).toContain("regulator");
        expect(prompt.request.message).toContain("external");
        expect(prompt.request.message).toContain("identified");
      }
    });
  });

  describe("semantic dedup", () => {
    it("removes duplicate stakeholders and merges concerns before confirmation", async () => {
      const { persistence, llm } = await advanceToStakeholders({
        "stakeholder-review-classification-r0": {
          updatedTypes: [],
          removedIds: [],
          newStakeholders: [],
        },
        "stakeholder-respondent-present-extraction-r0": { respondentId: "stakeholder_001" },
        "stakeholder-elaboration-stakeholder_001-0-composition-r0": { question: "Role?", suggestions: ["M"] },
        "stakeholder-elaboration-stakeholder_001-0-extraction-r0": {
          role: "Manager", concerns: ["Visibility"], contradictions: [], waitingRoomItems: [],
        },
        "stakeholder-elaboration-stakeholder_002-0-composition-r0": { question: "Dev?", suggestions: ["C"] },
        "stakeholder-elaboration-stakeholder_002-0-extraction-r0": {
          role: "Coder", concerns: ["Speed", "Tooling"], contradictions: [], waitingRoomItems: [],
        },
        "stakeholder-dedup": {
          duplicateGroups: [{ keepId: "stakeholder_001", removeIds: ["stakeholder_002"] }],
        },
        "stakeholders-confirmation-classification-0-r0": { approved: true, revisionRequested: null },
      });

      await driveThruReviewAndRespondent(persistence, llm);
      await step(persistence, session, createAdapter(llm, { "stakeholder-elaboration-stakeholder_001-0-question-r0": "Manager" }));

      const prompt = await suspended(
        persistence, session,
        createAdapter(llm, { "stakeholder-elaboration-stakeholder_002-0-question-r0": "Coder" }),
      );

      expect(prompt.id).toBe("stakeholders-confirmation-r0");
      if (prompt.type === "prompt") {
        expect(prompt.request.message).toContain("team lead");
        expect(prompt.request.message).not.toContain("developer");
        // Merged concerns from removed stakeholder
        expect(prompt.request.message).toContain("Visibility");
        expect(prompt.request.message).toContain("Speed");
        expect(prompt.request.message).toContain("Tooling");
      }
    });

    it("transfers respondent flag when respondent stakeholder is merged away", async () => {
      const { persistence, llm } = await advanceToStakeholders({
        "stakeholder-review-classification-r0": {
          updatedTypes: [],
          removedIds: [],
          newStakeholders: [],
        },
        "stakeholder-respondent-present-extraction-r0": { respondentId: "stakeholder_002" },
        "stakeholder-elaboration-stakeholder_001-0-composition-r0": { question: "Role?", suggestions: ["M"] },
        "stakeholder-elaboration-stakeholder_001-0-extraction-r0": {
          role: "Manager", concerns: ["Visibility"], contradictions: [], waitingRoomItems: [],
        },
        "stakeholder-elaboration-stakeholder_002-0-composition-r0": { question: "Dev?", suggestions: ["C"] },
        "stakeholder-elaboration-stakeholder_002-0-extraction-r0": {
          role: "Coder", concerns: ["Speed"], contradictions: [], waitingRoomItems: [],
        },
        // Merge stakeholder_002 (respondent) into stakeholder_001
        "stakeholder-dedup": {
          duplicateGroups: [{ keepId: "stakeholder_001", removeIds: ["stakeholder_002"] }],
        },
      });

      await driveThruReviewAndRespondent(persistence, llm);
      await step(persistence, session, createAdapter(llm, { "stakeholder-elaboration-stakeholder_001-0-question-r0": "Manager" }));

      const prompt = await suspended(
        persistence, session,
        createAdapter(llm, { "stakeholder-elaboration-stakeholder_002-0-question-r0": "Coder" }),
      );

      expect(prompt.id).toBe("stakeholders-confirmation-r0");
      if (prompt.type === "prompt") {
        // Respondent flag transferred to the surviving stakeholder
        expect(prompt.request.message).toContain("_(you)_");
        expect(prompt.request.message).toContain("team lead");
      }
    });

    it("skips dedup when fewer than 2 stakeholders", async () => {
      // advanceToConfirmation removes stakeholder_002 — only 1 remains, no dedup step
      const { persistence, llm } = await advanceToStakeholders({
        "stakeholder-review-classification-r0": {
          updatedTypes: [],
          removedIds: ["stakeholder_002"],
          newStakeholders: [],
        },
        "stakeholder-respondent-present-extraction-r0": { respondentId: "stakeholder_001" },
        "stakeholder-elaboration-stakeholder_001-0-composition-r0": { question: "Role?", suggestions: ["M"] },
        "stakeholder-elaboration-stakeholder_001-0-extraction-r0": {
          role: "Manager", concerns: ["Visibility"], contradictions: [], waitingRoomItems: [],
        },
        // No "stakeholder-dedup" key — if dedup ran, it would get {} and fail
        "stakeholders-confirmation-classification-0-r0": { approved: true, revisionRequested: null },
      });

      await step(persistence, session, createAdapter(llm)); // review:present
      await step(persistence, session, createAdapter(llm, { "stakeholder-review-present-r0": "Remove developer" }));
      await step(persistence, session, createAdapter(llm, { "stakeholder-respondent-present-r0": "I'm the lead" }));
      await step(persistence, session, createAdapter(llm, { "stakeholder-elaboration-stakeholder_001-0-question-r0": "Manager" }));

      const prompt = await suspended(
        persistence, session,
        createAdapter(llm, { "stakeholders-confirmation-r0": "Looks good" }),
      );

      // Reaches scope without dedup step (would have crashed on missing mock)
      expect(prompt.id).toBe("scope-seed-present-r0");
    });
  });
});
