import { describe, it, expect } from "vitest";
import { type Resolver, Suspend, execute, session, memoryPersistence, step, driveToCompletion } from "./helpers.js";

describe("full pipeline", () => {
  it("completes entire session from start to finish", async () => {
    const llm: Record<string, unknown> = {
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
      "goal-seed-extraction": {
        goals: [{ title: "Track progress", description: "Monitor books" }],
      },
      "goal-seed-classification-r0": {
        responseInterpretation: "Confirmed",
        confirmedGoalIds: ["goal_001"],
        removedGoalIds: [],
        newGoals: [],
        waitingRoomItems: [],
      },
      "goal-refinement-goal_001-clarify-0-composition-r0": { question: "What?", suggestions: ["A"] },
      "goal-refinement-goal_001-clarify-0-extraction-r0": { title: null, description: "Track books finished", rationale: null, contradictions: [], waitingRoomItems: [] },
      "goal-refinement-goal_001-why-0-composition-r0": { question: "Why?", suggestions: ["B"] },
      "goal-refinement-goal_001-why-0-extraction-r0": { title: null, description: null, rationale: "Motivation", contradictions: [], waitingRoomItems: [] },
      "goal-refinement-goal_001-negative-0-composition-r0": { question: "What if not?", suggestions: ["C"] },
      "goal-refinement-goal_001-negative-0-extraction-r0": { title: null, description: "Lose awareness", rationale: null, contradictions: [], waitingRoomItems: [] },
      "goal-discovery-composition-0": { question: "More?", suggestions: ["X"] },
      "goal-discovery-classification-0": { hasMoreGoals: false, newGoals: [], waitingRoomItems: [] },
      "goals-confirmation-classification-0-r0": { approved: true, revisionRequested: null },
      // Stakeholders phase
      "stakeholder-review-classification-r0": {
        updatedTypes: [],
        removedIds: [],
        newStakeholders: [],
      },
      "stakeholder-respondent-present-extraction-r0": { respondentId: "stakeholder_001" },
      "stakeholder-elaboration-stakeholder_001-0-composition-r0": { question: "What's your role?", suggestions: ["Daily reader"] },
      "stakeholder-elaboration-stakeholder_001-0-extraction-r0": {
        role: "Primary user tracking reading habits",
        concerns: ["Easy to log books"],
        contradictions: [],
        waitingRoomItems: [],
      },
      // Respondent — no perspective-switching
      "stakeholders-confirmation-classification-0-r0": { approved: true, revisionRequested: null },
      // Scope phase
      "scope-seed-extraction": {
        inScope: [{ description: "Reading log", relatedGoals: ["goal_001"] }],
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
      "scope-contradiction-check": { contradictions: [], orphans: [] },
      "scope-confirmation-classification-0-r0": { approved: true, revisionRequested: null },
      // Assumptions phase
      "assumption-seed-extraction": {
        assumptions: [{ statement: "Users read regularly", type: "hypothesis", relatedGoals: ["goal_001"] }],
      },
      "assumption-seed-classification-r0": {
        confirmedIds: ["assumption_001"],
        removedIds: [],
        newAssumptions: [],
        waitingRoomItems: [],
      },
      "assumption-validation-assumption_001-composition-r0": { question: "Do users read regularly?", suggestions: ["Yes", "Not sure"] },
      "assumption-validation-assumption_001-extraction-r0": { verdict: "validated", waitingRoomItems: [] },
      "assumptions-confirmation-classification-0-r0": { approved: true, revisionRequested: null },
      // Validation phase
      "validation-consistency-check": { contradictions: [] },
      "validation-confirmation-classification-0-r0": { approved: true, revisionRequested: null },
    };

    const { completed, persistence } = await driveToCompletion(llm, [
      ["opening-greet-r0", "I want to build a reading tracker"],
      ["opening-summary-r0", "Yes that's right"],
      ["purpose-confirmation-r0", "Looks good"],
      ["goal-seed-present-r0", "Good"],
      ["goal-refinement-goal_001-clarify-0-question-r0", "Books finished"],
      ["goal-refinement-goal_001-why-0-question-r0", "Motivation"],
      ["goal-refinement-goal_001-negative-0-question-r0", "Lose track"],
      ["goal-discovery-question-0", "No more"],
      ["goals-confirmation-r0", "Looks good"],
      // Stakeholders phase
      ["stakeholder-review-present-r0", "I'm the reader"],
      ["stakeholder-respondent-present-r0", "I'm the reader role"],
      ["stakeholder-elaboration-stakeholder_001-0-question-r0", "I'm the main user, I care about ease"],
      ["stakeholders-confirmation-r0", "Looks good"],
      // Scope phase
      ["scope-seed-present-r0", "Good"],
      ["scope-constraint-question-r0", "No constraints"],
      ["scope-confirmation-r0", "Looks good"],
      // Assumptions phase
      ["assumption-seed-present-r0", "Looks right"],
      ["assumption-validation-assumption_001-question-r0", "Yes definitely"],
      ["assumptions-confirmation-r0", "Looks good"],
      // Validation phase
      ["validation-summary-present-r0", "Confirmed"],
    ]);

    expect(completed).toBe(true);
    expect(persistence.current()!.status).toBe("completed");
  });

  it("memoizes all steps across runs", async () => {
    const llm: Record<string, unknown> = {
      "opening-greet-extraction-r0": { purpose: "test", stakeholders: ["tester"], domainHints: [] },
      "opening-brownfield-screen": { greenfieldConfidence: 9 },
      "opening-confirmation-classification-0-r0": { approved: true, revisionRequested: null },
      "purpose-initial-extraction": { purpose: "test", advantage: "test", measurement: "test", contradictions: [] },
      "purpose-confirmation-classification-0-r0": { approved: true },
      "goal-seed-extraction": { goals: [{ title: "G", description: "D" }] },
      "goal-seed-classification-r0": { responseInterpretation: "ok", confirmedGoalIds: ["goal_001"], removedGoalIds: [], newGoals: [], waitingRoomItems: [] },
      "goal-refinement-goal_001-clarify-0-composition-r0": { question: "Q", suggestions: ["S"] },
      "goal-refinement-goal_001-clarify-0-extraction-r0": { title: null, description: "D2", rationale: null, contradictions: [], waitingRoomItems: [] },
      "goal-refinement-goal_001-why-0-composition-r0": { question: "Q", suggestions: ["S"] },
      "goal-refinement-goal_001-why-0-extraction-r0": { title: null, description: null, rationale: "R", contradictions: [], waitingRoomItems: [] },
      "goal-refinement-goal_001-negative-0-composition-r0": { question: "Q", suggestions: ["S"] },
      "goal-refinement-goal_001-negative-0-extraction-r0": { title: null, description: "D3", rationale: null, contradictions: [], waitingRoomItems: [] },
      "goal-discovery-composition-0": { question: "Q", suggestions: ["S"] },
      "goal-discovery-classification-0": { hasMoreGoals: false, newGoals: [], waitingRoomItems: [] },
      "goals-confirmation-classification-0-r0": { approved: true },
      // Stakeholders
      "stakeholder-review-classification-r0": {
        updatedTypes: [],
        removedIds: [],
        newStakeholders: [],
      },
      "stakeholder-respondent-present-extraction-r0": { respondentId: "stakeholder_001" },
      "stakeholder-elaboration-stakeholder_001-0-composition-r0": { question: "Q", suggestions: ["S"] },
      "stakeholder-elaboration-stakeholder_001-0-extraction-r0": { role: "User", concerns: ["Ease"], contradictions: [], waitingRoomItems: [] },
      "stakeholders-confirmation-classification-0-r0": { approved: true },
      // Scope
      "scope-seed-extraction": { inScope: [{ description: "Feature", relatedGoals: ["goal_001"] }], outOfScope: [], ambiguous: [] },
      "scope-seed-classification-r0": { confirmedInScope: ["scope_001"], confirmedOutOfScope: [], removedIds: [], newItems: [], waitingRoomItems: [] },
      "scope-constraint-composition-r0": { question: "Q", suggestions: ["S"] },
      "scope-constraint-extraction-r0": { constraints: [], waitingRoomItems: [] },
      "scope-contradiction-check": { contradictions: [], orphans: [] },
      "scope-confirmation-classification-0-r0": { approved: true },
      // Assumptions
      "assumption-seed-extraction": { assumptions: [{ statement: "A", type: "hypothesis" }] },
      "assumption-seed-classification-r0": { confirmedIds: ["assumption_001"], removedIds: [], newAssumptions: [], waitingRoomItems: [] },
      "assumption-validation-assumption_001-composition-r0": { question: "Q", suggestions: ["S"] },
      "assumption-validation-assumption_001-extraction-r0": { verdict: "validated", waitingRoomItems: [] },
      "assumptions-confirmation-classification-0-r0": { approved: true },
      // Validation
      "validation-consistency-check": { contradictions: [] },
      "validation-confirmation-classification-0-r0": { approved: true, revisionRequested: null },
    };

    const persistence = memoryPersistence();
    let resolveCount = 0;
    const trackingResolver: Resolver = async (prompt) => {
      if (prompt.type === "infer") {
        resolveCount++;
        return llm[prompt.id] ?? {};
      }
      throw new Suspend(prompt.id, prompt);
    };

    // Drive to completion
    let done = await step(persistence, session, trackingResolver);
    const promptIds = [
      "opening-greet-r0", "opening-summary-r0", "purpose-confirmation-r0",
      "goal-seed-present-r0",
      "goal-refinement-goal_001-clarify-0-question-r0",
      "goal-refinement-goal_001-why-0-question-r0",
      "goal-refinement-goal_001-negative-0-question-r0",
      "goal-discovery-question-0", "goals-confirmation-r0",
      // Stakeholders
      "stakeholder-review-present-r0",
      "stakeholder-respondent-present-r0",
      "stakeholder-elaboration-stakeholder_001-0-question-r0",
      "stakeholders-confirmation-r0",
      // Scope
      "scope-seed-present-r0",
      "scope-constraint-question-r0",
      "scope-confirmation-r0",
      // Assumptions
      "assumption-seed-present-r0",
      "assumption-validation-assumption_001-question-r0",
      "assumptions-confirmation-r0",
      // Validation
      "validation-summary-present-r0",
    ];
    for (const id of promptIds) {
      if (done) break;
      done = await step(persistence, session, async (prompt) => {
        if (prompt.type === "infer") { resolveCount++; return llm[prompt.id] ?? {}; }
        if (prompt.id === id) return "answer";
        throw new Suspend(prompt.id, prompt);
      });
    }
    expect(done).toBe(true);

    resolveCount = 0;

    // Re-run on completed workflow — should short-circuit
    await execute(persistence, session, trackingResolver);
    expect(resolveCount).toBe(0);
  });
});
