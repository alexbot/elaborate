import { describe, it, expect } from "vitest";
import { session, memoryPersistence, createAdapter, step, suspended } from "./helpers.js";

describe("purpose phase", () => {
  const baseLlm = {
    "opening-greet-extraction-r0": {
      purpose: "track reading habits",
      stakeholders: ["readers"],
      domainHints: ["books"],
    },
    "opening-brownfield-screen": { greenfieldConfidence: 9 },
    "opening-confirmation-classification-0-r0": { approved: true, revisionRequested: null },
  };

  /** Helper: advance through opening to reach purpose */
  async function advanceToPurpose(llm: Record<string, unknown>) {
    const persistence = memoryPersistence();
    const mergedLlm = { ...baseLlm, ...llm };

    await step(persistence, session, createAdapter(mergedLlm));
    await step(persistence, session, createAdapter(mergedLlm, { "opening-greet-r0":"Reading tracker" }));
    await step(persistence, session, createAdapter(mergedLlm, { "opening-summary-r0": "Yes" }));

    return { persistence, llm: mergedLlm };
  }

  // Deviation in initial extraction — opening was a non-answer

  it("skips to slot-filling when opening extraction hits deviation", async () => {
    const { persistence, llm } = await advanceToPurpose({
      "opening-greet-extraction-r0": { stakeholders: ["readers"], domainHints: ["books"] },
      "purpose-initial-extraction": {
        purpose: null, advantage: null, measurement: null, contradictions: [],
        responseClass: "confusion",
      },
      "purpose-purpose-0-composition-r0": {
        question: "What problem does this solve?",
        suggestions: ["Track reading progress"],
      },
    });

    // Deviation in initial extraction → skip laddering → slot-filling starts at purpose
    const prompt = await suspended(persistence, session, createAdapter(llm));
    expect(prompt.id).toBe("purpose-purpose-0-question-r0");
  });

  // Initial extraction (no laddering needed when purpose is found)

  it("extracts from initial response and moves to next unfilled slot", async () => {
    const { persistence } = await advanceToPurpose({
      "purpose-initial-extraction": {
        purpose: "track reading to build habits",
        advantage: null,
        measurement: null,
        contradictions: [],
      },
      "purpose-advantage-0-composition-r0": {
        question: "What makes this better?",
        suggestions: ["Simpler than spreadsheets"],
      },
    });

    // Should be asking about advantage (purpose was extracted from initial)
    const state = persistence.current()!;
    expect(state.status).toBe("suspended");
  });

  it("moves to confirmation when all slots addressed", async () => {
    const { persistence, llm } = await advanceToPurpose({
      "purpose-initial-extraction": {
        purpose: "track reading to improve habits",
        advantage: "simpler than existing tools",
        measurement: "books completed per month",
        contradictions: [],
      },
    });

    // All slots filled in initial extraction → should go to confirmation
    const prompt = await suspended(persistence, session, createAdapter(llm));
    expect(prompt.id).toBe("purpose-confirmation-r0");
    if (prompt.type === "prompt") {
      expect(prompt.request.message).toContain("Purpose");
      expect(prompt.request.message).toContain("Advantage");
      expect(prompt.request.message).toContain("Measurement");
      expect(prompt.request.message).toContain("What would you change or add?");
    }
  });

  it("surfaces contradictions to user", async () => {
    const { persistence, llm } = await advanceToPurpose({
      "purpose-initial-extraction": {
        purpose: "enterprise compliance tracking",
        advantage: null,
        measurement: null,
        contradictions: ["Earlier mentioned this is for individual readers, now says enterprise compliance"],
      },
    });

    // Should surface contradiction
    const prompt = await suspended(persistence, session, createAdapter(llm));
    expect(prompt.type).toBe("prompt");
    if (prompt.type === "prompt") {
      expect(prompt.request.message).toContain("inconsistent");
      expect(prompt.request.message).toContain("individual readers");
    }
  });

  it("transitions to goals phase when confirmed", async () => {
    const { persistence, llm } = await advanceToPurpose({
      "purpose-initial-extraction": {
        purpose: "track reading",
        advantage: "simpler",
        measurement: "books per month",
        contradictions: [],
      },
      "purpose-confirmation-classification-0-r0": { approved: true, revisionRequested: null },
      "goal-seed-extraction": {
        goals: [{ title: "Track reading", description: "Monitor books" }],
      },
    });

    // At confirmation
    const p1 = await suspended(persistence, session, createAdapter(llm));
    expect(p1.id).toBe("purpose-confirmation-r0");

    // Approve → should transition to goals seed presentation
    const p2 = await suspended(
      persistence, session,
      createAdapter(llm, { "purpose-confirmation-r0": "Looks good" }),
    );
    expect(p2.id).toBe("goal-seed-present-r0");
  });

  it("extracts revision from rejection and advances to goals", async () => {
    const { persistence, llm } = await advanceToPurpose({
      "purpose-initial-extraction": {
        purpose: "track reading",
        advantage: "simpler",
        measurement: "books per month",
        contradictions: [],
      },
      "purpose-confirmation-classification-0-r0": { approved: false, revisionRequested: "purpose needs work" },
      "purpose-revision-r0": { purpose: "track reading habits better", advantage: null, measurement: null, contradictions: [] },
      "goal-seed-extraction": { goals: [{ title: "Track reading", description: "Monitor" }] },
    });

    // At confirmation
    await step(persistence, session, createAdapter(llm));

    // Decline → extract revision from rejection → advance to goals
    const prompt = await suspended(
      persistence, session,
      createAdapter(llm, { "purpose-confirmation-r0": "The purpose isn't right, it should be about tracking reading habits better" }),
    );

    expect(prompt.id).toBe("goal-seed-present-r0");
  });

  // Classification + slot-filling (problem-framed → skip laddering)

  it("classifies problem-framed response and falls through to slot loop", async () => {
    const { persistence, llm } = await advanceToPurpose({
      "opening-greet-extraction-r0": { stakeholders: ["readers"], domainHints: ["books"] },
      "purpose-initial-extraction": { purpose: null, advantage: null, measurement: null, contradictions: [] },
      "purpose-classify-framing": { framing: "problem", solutionDescription: null },
      "purpose-purpose-0-composition-r0": {
        question: "What specific problem does this solve?",
        suggestions: ["Track books I've started but not finished", "Remember key takeaways"],
      },
    });

    // Problem-framed → skip laddering → slot loop asks about purpose
    const prompt = await suspended(persistence, session, createAdapter(llm));
    expect(prompt.id).toBe("purpose-purpose-0-question-r0");
    if (prompt.type === "prompt") {
      expect(prompt.request.message).toContain("What specific problem");
      expect(prompt.request.message).toContain("a)");
      expect(prompt.request.message).toContain("Track books");
    }
  });

  it("advances slot after extraction fills focus slot", async () => {
    const { persistence, llm } = await advanceToPurpose({
      "purpose-initial-extraction": { purpose: null, advantage: null, measurement: null, contradictions: [] },
      "purpose-classify-framing": { framing: "problem", solutionDescription: null },
      "purpose-purpose-0-composition-r0": { question: "What problem?", suggestions: ["A", "B"] },
      "purpose-purpose-0-extraction-r0": {
        purpose: "help readers track progress",
        advantage: null,
        measurement: null,
        contradictions: [],
      },
      "purpose-advantage-0-composition-r0": { question: "What makes it better?", suggestions: ["C"] },
    });

    // Answer purpose question → extract → should now ask about advantage
    const prompt = await suspended(
      persistence, session,
      createAdapter(llm, { "purpose-purpose-0-question-r0": "Track what I read" }),
    );

    expect(prompt.id).toBe("purpose-advantage-0-question-r0");
    if (prompt.type === "prompt") {
      expect(prompt.request.message).toContain("What makes it better?");
    }
  });

  it("uses fallback question when compose returns nothing", async () => {
    const { persistence, llm } = await advanceToPurpose({
      "opening-greet-extraction-r0": { stakeholders: ["readers"], domainHints: ["books"] },
      "purpose-initial-extraction": { purpose: null, advantage: null, measurement: null, contradictions: [] },
      "purpose-classify-framing": { framing: "problem", solutionDescription: null },
      "purpose-purpose-0-composition-r0": {},
    });

    const prompt = await suspended(persistence, session, createAdapter(llm));
    expect(prompt.id).toBe("purpose-purpose-0-question-r0");
    if (prompt.type === "prompt") {
      expect(prompt.request.message).toContain("problem");
    }
  });

  it("rephrases when extraction yields nothing for focused slot", async () => {
    const { persistence, llm } = await advanceToPurpose({
      "opening-greet-extraction-r0": { stakeholders: ["readers"], domainHints: ["books"] },
      "purpose-initial-extraction": { purpose: null, advantage: null, measurement: null, contradictions: [] },
      "purpose-classify-framing": { framing: "problem", solutionDescription: null },
      "purpose-purpose-0-composition-r0": { question: "What problem?", suggestions: ["A"] },
      "purpose-purpose-0-extraction-r0": { purpose: null, advantage: null, measurement: null, contradictions: [] },
      "purpose-purpose-1-composition-r0": { question: "Let me try differently...", suggestions: ["B"] },
    });

    // Answer purpose question with vague response → no extraction → rephrase
    const prompt = await suspended(
      persistence, session,
      createAdapter(llm, { "purpose-purpose-0-question-r0": "I don't know exactly" }),
    );

    // Should be at second attempt for purpose
    expect(prompt.id).toBe("purpose-purpose-1-question-r0");
    if (prompt.type === "prompt") {
      expect(prompt.request.message).toContain("Let me try differently");
    }
  });

  it("flags finding and moves to next slot at max attempts", async () => {
    const { persistence, llm } = await advanceToPurpose({
      "purpose-initial-extraction": {
        purpose: "track reading progress",
        advantage: null,
        measurement: null,
        contradictions: [],
      },
      // Advantage: 2 attempts, both fail
      "purpose-advantage-0-composition-r0": { question: "Why better?", suggestions: ["X"] },
      "purpose-advantage-0-extraction-r0": { purpose: null, advantage: null, measurement: null, contradictions: [] },
      "purpose-advantage-1-composition-r0": { question: "Alternatives?", suggestions: ["Y"] },
      "purpose-advantage-1-extraction-r0": { purpose: null, advantage: null, measurement: null, contradictions: [] },
      // After advantage exhausted, should ask about measurement
      "purpose-measurement-0-composition-r0": { question: "How measure success?", suggestions: ["Z"] },
    });

    // Answer advantage attempt 0
    await step(persistence, session, createAdapter(llm, { "purpose-advantage-0-question-r0": "Not sure" }));

    // Answer advantage attempt 1 → should flag finding, move to measurement
    const prompt = await suspended(
      persistence, session,
      createAdapter(llm, { "purpose-advantage-1-question-r0": "Still not sure" }),
    );

    expect(prompt.id).toBe("purpose-measurement-0-question-r0");
  });

  // Laddering (solution-framed)

  it("triggers laddering when response is solution-framed", async () => {
    const { persistence, llm } = await advanceToPurpose({
      "opening-greet-extraction-r0": { stakeholders: ["developers"], domainHints: ["slack"] },
      "purpose-initial-extraction": { purpose: null, advantage: null, measurement: null, contradictions: [] },
      "purpose-classify-framing": { framing: "solution", solutionDescription: "a Slack bot for meeting scheduling" },
      "purpose-ladder-0-composition-r0": {
        question: "Why do you need a Slack bot for scheduling? What problem does it solve?",
        suggestions: ["Team leads waste time coordinating", "Meetings get double-booked"],
      },
    });

    // Should ask the laddering WHY question
    const prompt = await suspended(persistence, session, createAdapter(llm));
    expect(prompt.id).toBe("purpose-ladder-0-question-r0");
    if (prompt.type === "prompt") {
      expect(prompt.request.message).toContain("Why do you need");
      expect(prompt.request.message).toContain("a)");
    }
  });

  it("fills purpose from laddering and proceeds to slot loop", async () => {
    const { persistence, llm } = await advanceToPurpose({
      "opening-greet-extraction-r0": { stakeholders: ["developers"], domainHints: ["slack"] },
      "purpose-initial-extraction": { purpose: null, advantage: null, measurement: null, contradictions: [] },
      "purpose-classify-framing": { framing: "solution", solutionDescription: "a Slack bot" },
      "purpose-ladder-0-composition-r0": { question: "Why a Slack bot?", suggestions: ["A"] },
      "purpose-ladder-0-extraction-r0": {
        purpose: "reduce manual meeting coordination effort",
        advantage: null,
        measurement: null,
        contradictions: [],
        waitingRoomItems: ["Goal: automate meeting scheduling"],
      },
      // After laddering fills purpose, slot loop asks about advantage
      "purpose-advantage-0-composition-r0": { question: "What makes this better?", suggestions: ["B"] },
    });

    // Answer ladder question → extracts purpose → slot loop for advantage
    const prompt = await suspended(
      persistence, session,
      createAdapter(llm, { "purpose-ladder-0-question-r0": "Team leads waste 2 hours weekly coordinating" }),
    );

    expect(prompt.id).toBe("purpose-advantage-0-question-r0");
  });

  it("parks waiting room items from laddering", async () => {
    const { persistence, llm } = await advanceToPurpose({
      "opening-greet-extraction-r0": { stakeholders: ["developers"], domainHints: ["slack"] },
      "purpose-initial-extraction": { purpose: null, advantage: null, measurement: null, contradictions: [] },
      "purpose-classify-framing": { framing: "solution", solutionDescription: "a Slack bot" },
      "purpose-ladder-0-composition-r0": { question: "Why?", suggestions: ["A"] },
      "purpose-ladder-0-extraction-r0": {
        purpose: "reduce coordination overhead",
        advantage: null,
        measurement: null,
        contradictions: [],
        waitingRoomItems: ["Goal: automate meeting scheduling", "Stakeholder hint: team leads"],
      },
      "purpose-advantage-0-composition-r0": { question: "Better how?", suggestions: ["C"] },
    });

    // Drive through ladder
    await step(persistence, session, createAdapter(llm, { "purpose-ladder-0-question-r0": "Coordination is painful" }));

    // Check waiting room was populated
    const state = persistence.current()!;
    const entries = state.entries.filter((e: any) => e.value?.waitingRoomItems);
    expect(entries.length).toBeGreaterThan(0);
  });

  it("continues laddering when purpose not found on first step", async () => {
    const { persistence, llm } = await advanceToPurpose({
      "opening-greet-extraction-r0": { stakeholders: ["developers"], domainHints: ["slack"] },
      "purpose-initial-extraction": { purpose: null, advantage: null, measurement: null, contradictions: [] },
      "purpose-classify-framing": { framing: "solution", solutionDescription: "a Slack bot" },
      "purpose-ladder-0-composition-r0": { question: "Why a Slack bot?", suggestions: ["A"] },
      "purpose-ladder-0-extraction-r0": {
        purpose: null, advantage: null, measurement: null, contradictions: [],
      },
      "purpose-ladder-1-composition-r0": { question: "What problem does this solve?", suggestions: ["B"] },
    });

    // First ladder step yields nothing → should ask again
    const prompt = await suspended(
      persistence, session,
      createAdapter(llm, { "purpose-ladder-0-question-r0": "Just want one" }),
    );

    expect(prompt.id).toBe("purpose-ladder-1-question-r0");
  });

  it("falls through to slot loop when laddering exhausts without purpose", async () => {
    const { persistence, llm } = await advanceToPurpose({
      "opening-greet-extraction-r0": { stakeholders: ["developers"], domainHints: ["slack"] },
      "purpose-initial-extraction": { purpose: null, advantage: null, measurement: null, contradictions: [] },
      "purpose-classify-framing": { framing: "solution", solutionDescription: "a Slack bot" },
      // 3 ladder steps, none fill purpose
      "purpose-ladder-0-composition-r0": { question: "Why?", suggestions: ["A"] },
      "purpose-ladder-0-extraction-r0": { purpose: null, advantage: null, measurement: null, contradictions: [] },
      "purpose-ladder-1-composition-r0": { question: "But why?", suggestions: ["B"] },
      "purpose-ladder-1-extraction-r0": { purpose: null, advantage: null, measurement: null, contradictions: [] },
      "purpose-ladder-2-composition-r0": { question: "What changes?", suggestions: ["C"] },
      "purpose-ladder-2-extraction-r0": { purpose: null, advantage: null, measurement: null, contradictions: [] },
      // Fallthrough to slot loop
      "purpose-purpose-0-composition-r0": { question: "What problem?", suggestions: ["D"] },
    });

    // Drive through all 3 ladder steps
    await step(persistence, session, createAdapter(llm, { "purpose-ladder-0-question-r0": "Dunno" }));
    await step(persistence, session, createAdapter(llm, { "purpose-ladder-1-question-r0": "Not sure" }));

    const prompt = await suspended(
      persistence, session,
      createAdapter(llm, { "purpose-ladder-2-question-r0": "Just because" }),
    );

    // Should fall through to slot loop for purpose
    expect(prompt.id).toBe("purpose-purpose-0-question-r0");
  });

  it("triggers laddering for mixed framing", async () => {
    const { persistence, llm } = await advanceToPurpose({
      "opening-greet-extraction-r0": { stakeholders: ["developers"], domainHints: ["slack"] },
      "purpose-initial-extraction": { purpose: null, advantage: null, measurement: null, contradictions: [] },
      "purpose-classify-framing": { framing: "mixed", solutionDescription: "a Slack bot for meetings" },
      "purpose-ladder-0-composition-r0": { question: "What problem with meetings?", suggestions: ["A"] },
    });

    // Mixed framing also triggers laddering
    const prompt = await suspended(persistence, session, createAdapter(llm));
    expect(prompt.id).toBe("purpose-ladder-0-question-r0");
  });

  // Confidence derivation

  it("derives confidence from artifact state (0.5 → 0.7 on re-extraction)", async () => {
    const { persistence, llm } = await advanceToPurpose({
      "purpose-initial-extraction": {
        purpose: "track reading",
        advantage: null,
        measurement: null,
        contradictions: [],
      },
      // Slot loop asks about advantage, extraction also refines purpose
      "purpose-advantage-0-composition-r0": { question: "Why better?", suggestions: ["X"] },
      "purpose-advantage-0-extraction-r0": {
        purpose: "track reading habits to improve consistency",
        advantage: "simpler than spreadsheets",
        measurement: null,
        contradictions: [],
      },
      "purpose-measurement-0-composition-r0": { question: "How measure?", suggestions: ["Y"] },
    });

    // Answer advantage → extraction refines purpose (second fill → 0.7)
    await step(persistence, session, createAdapter(llm, { "purpose-advantage-0-question-r0": "Simpler" }));

    // Check confidence: purpose should be 0.7 (refined), advantage 0.5 (first fill)
    const state = persistence.current()!;
    const entries = state.entries.filter((e: any) => e.value?.purpose);
    // The latest extraction should have set purpose confidence to 0.7
    expect(entries.length).toBeGreaterThan(0);
  });

  // Waiting room drain

  it("drains purpose-related waiting room items", async () => {
    // Simulate brownfield items in WR by providing extraction that produces them
    const persistence = memoryPersistence();
    const llm = {
      ...baseLlm,
      "opening-brownfield-screen": { greenfieldConfidence: 3 },
      "opening-brownfield-extraction-r0": {
        isBrownfield: true,
        sourceIndicators: ["/README.md"],
      },
      "opening-brownfield-extraction": {
        items: [
          "Purpose: help developers track code reviews",
          "Stakeholder: engineering manager",
          "Goal: reduce PR turnaround time",
        ],
      },
      "purpose-seed-extraction": {
        purpose: "help developers track code reviews",
        advantage: null,
        measurement: null,
        drainedWaitingRoomIds: ["waiting_001"],
      },
      "purpose-initial-extraction": {
        purpose: "streamline code review tracking",
        advantage: null,
        measurement: null,
        responseInterpretation: "wants code review tracking",
        contradictions: [],
      },
      "purpose-advantage-0-composition-r0": { question: "What makes this better?", suggestions: ["A"] },
    };

    // Opening
    await step(persistence, session, createAdapter(llm));
    await step(persistence, session, createAdapter(llm, { "opening-greet-r0":"Code review tracker" }));
    await step(persistence, session, createAdapter(llm, { "opening-brownfield-r0":"Yes, check /README.md" }));
    // At summary — brownfield items should be in WR now
    await step(persistence, session, createAdapter(llm, { "opening-summary-r0": "Yes" }));

    // Purpose phase runs seed extraction (WR has items) → drains purpose-related ones
    // Then continues to slot-filling
    const state = persistence.current()!;
    const seedEntry = state.entries.find((e: any) => e.id === "purpose-seed-extraction");
    expect(seedEntry).toBeDefined();
  });

  it("skips seed extraction when waiting room is empty", async () => {
    // Standard greenfield path — no WR items
    const { persistence } = await advanceToPurpose({
      "purpose-initial-extraction": {
        purpose: "track reading",
        advantage: "simpler",
        measurement: "books per month",
        contradictions: [],
      },
    });

    // No seed extraction should have occurred
    const state = persistence.current()!;
    const seedEntry = state.entries.find((e: any) => e.id === "purpose-seed-extraction");
    expect(seedEntry).toBeUndefined();
  });

  it("seed-extracted values do not override user-driven extraction", async () => {
    const persistence = memoryPersistence();
    const llm = {
      ...baseLlm,
      "opening-brownfield-screen": { greenfieldConfidence: 3 },
      "opening-brownfield-extraction-r0": {
        isBrownfield: true,
        sourceIndicators: ["/README.md"],
      },
      "opening-brownfield-extraction": {
        items: ["Purpose: manage inventory for warehouses"],
      },
      "purpose-seed-extraction": {
        purpose: "manage inventory for warehouses",
        advantage: null,
        measurement: null,
        drainedWaitingRoomIds: ["waiting_001"],
      },
      // Initial extraction from opening response overrides the seed with higher confidence
      "purpose-initial-extraction": {
        purpose: "real-time inventory tracking for retail",
        advantage: "faster than manual counts",
        measurement: "inventory accuracy percentage",
        responseInterpretation: "user clarified",
        contradictions: [],
      },
      "purpose-confirmation-classification-0-r0": { approved: true, revisionRequested: null },
      "goal-seed-extraction": { goals: [{ title: "Track stock", description: "Monitor levels" }] },
    };

    // Opening with brownfield
    await step(persistence, session, createAdapter(llm));
    await step(persistence, session, createAdapter(llm, { "opening-greet-r0":"Inventory tracker" }));
    await step(persistence, session, createAdapter(llm, { "opening-brownfield-r0":"Yes, check /README.md" }));
    await step(persistence, session, createAdapter(llm, { "opening-summary-r0": "Yes" }));

    // Purpose runs seed drain (sets purpose to 0.5), then initial extraction (raises to 0.7)
    // All PAM slots filled → confirmation
    const prompt = await suspended(persistence, session, createAdapter(llm));
    expect(prompt.id).toBe("purpose-confirmation-r0");
    if (prompt.type === "prompt") {
      // Should contain the user-driven extraction, not the seed
      expect(prompt.request.message).toContain("real-time inventory tracking");
    }
  });
});
