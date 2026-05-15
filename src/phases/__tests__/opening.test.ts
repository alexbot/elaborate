import { describe, it, expect } from "vitest";
import { session, memoryPersistence, createAdapter, step, suspended } from "./helpers.js";

describe("opening phase", () => {
  const greenfieldScreen = {
    "opening-brownfield-screen": { greenfieldConfidence: 9 },
  };
  const brownfieldScreen = {
    "opening-brownfield-screen": { greenfieldConfidence: 3 },
  };
  const summaryApproved = {
    "opening-confirmation-classification-0-r0": { approved: true, revisionRequested: null },
  };

  it("suspends at greeting on first run", async () => {
    const persistence = memoryPersistence();
    const prompt = await suspended(persistence, session, createAdapter({}));

    expect(prompt.type).toBe("prompt");
    expect(prompt.id).toBe("opening-greet-r0");
    expect(prompt.request).toHaveProperty("message");
    if (prompt.type === "prompt") {
      expect(prompt.request.message).toContain("What are you building");
      expect(prompt.request.message).toContain("Elaborate");
    }
  });

  it("suspends at brownfield prompt when screen confidence is low", async () => {
    const persistence = memoryPersistence();
    const llm = {
      "opening-greet-extraction-r0": {
        purpose: "track reading habits",
        stakeholders: ["readers"],
        domainHints: ["books"],
      },
      ...brownfieldScreen,
    };

    await step(persistence, session, createAdapter(llm));
    const prompt = await suspended(
      persistence, session,
      createAdapter(llm, { "opening-greet-r0": "I want to build a reading tracker" }),
    );

    expect(prompt.type).toBe("prompt");
    expect(prompt.id).toBe("opening-brownfield-r0");
    if (prompt.type === "prompt") {
      expect(prompt.request.message).toContain("existing work");
    }
  });

  it("skips brownfield prompt and presents summary when greenfield confidence is high", async () => {
    const persistence = memoryPersistence();
    const llm = {
      "opening-greet-extraction-r0": {
        purpose: "track reading habits",
        stakeholders: ["readers"],
        domainHints: ["books"],
      },
      ...greenfieldScreen,
    };

    await step(persistence, session, createAdapter(llm));
    const prompt = await suspended(
      persistence, session,
      createAdapter(llm, { "opening-greet-r0": "I want to build a reading tracker" }),
    );

    expect(prompt.type).toBe("prompt");
    expect(prompt.id).toBe("opening-summary-r0");
    if (prompt.type === "prompt") {
      expect(prompt.request.message).toContain("track reading habits");
      expect(prompt.request.message).toContain("readers");
    }

    // No brownfield-related entries in state
    const state = persistence.current()!;
    const brownfieldEntries = state.entries.filter((e: any) => e.id.startsWith("opening-brownfield-extraction"));
    expect(brownfieldEntries).toHaveLength(0);
  });

  it("transitions to purpose phase after summary response", async () => {
    const persistence = memoryPersistence();
    const llm = {
      "opening-greet-extraction-r0": {
        purpose: "track reading habits",
        stakeholders: ["readers"],
        domainHints: ["books"],
      },
      ...greenfieldScreen,
      ...summaryApproved,
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
    };

    await step(persistence, session, createAdapter(llm));
    await step(persistence, session, createAdapter(llm, { "opening-greet-r0": "Reading tracker" }));
    await step(persistence, session, createAdapter(llm, { "opening-summary-r0": "Yes, that's right" }));
    const prompt = await suspended(
      persistence, session,
      createAdapter(llm),
    );

    expect(prompt.type).toBe("prompt");
    expect(prompt.id).toBe("purpose-advantage-0-question-r0");
    if (prompt.type === "prompt") {
      expect(prompt.request.message).toContain("What makes this better?");
    }
  });

  it("deposits brownfield items to waiting room", async () => {
    const persistence = memoryPersistence();
    const llm = {
      "opening-greet-extraction-r0": {
        purpose: "improve the checkout flow",
        stakeholders: ["shoppers"],
        domainHints: ["e-commerce"],
      },
      ...brownfieldScreen,
      "opening-brownfield-extraction-r0": {
        isBrownfield: true,
        sourceIndicators: ["/src/checkout/README.md"],
      },
      "opening-brownfield-extraction": {
        items: [
          "Goal: reduce cart abandonment rate",
          "Stakeholder: payment processing team",
          "Constraint: must integrate with Stripe API v3",
        ],
      },
    };

    await step(persistence, session, createAdapter(llm));
    await step(persistence, session, createAdapter(llm, { "opening-greet-r0": "Improve our checkout" }));

    const prompt = await suspended(
      persistence, session,
      createAdapter(llm, { "opening-brownfield-r0": "Yes, check /src/checkout/README.md" }),
    );

    expect(prompt.id).toBe("opening-summary-r0");

    // Verify waiting room was populated via the state log
    const state = persistence.current()!;
    const extractionEntry = state.entries.find((e: any) => e.id === "opening-brownfield-extraction");
    expect(extractionEntry).toBeDefined();
    expect((extractionEntry as any).value.items).toHaveLength(3);
  });

  it("skips extraction when user confirms greenfield after screen", async () => {
    const persistence = memoryPersistence();
    const llm = {
      "opening-greet-extraction-r0": {
        purpose: "track reading habits",
        stakeholders: ["readers"],
        domainHints: ["books"],
      },
      ...brownfieldScreen,
      "opening-brownfield-extraction-r0": { isBrownfield: false, sourceIndicators: [] },
    };

    await step(persistence, session, createAdapter(llm));
    await step(persistence, session, createAdapter(llm, { "opening-greet-r0": "Reading tracker" }));

    const prompt = await suspended(
      persistence, session,
      createAdapter(llm, { "opening-brownfield-r0": "Nah, starting fresh" }),
    );

    expect(prompt.id).toBe("opening-summary-r0");

    // No brownfield extraction entry in state
    const state = persistence.current()!;
    const extractionEntry = state.entries.find((e: any) => e.id === "opening-brownfield-extraction");
    expect(extractionEntry).toBeUndefined();
  });

  it("retries summary on nonsense response via deviation resilience", async () => {
    const persistence = memoryPersistence();
    const llm = {
      "opening-greet-extraction-r0": {
        purpose: "track reading habits",
        stakeholders: ["readers"],
        domainHints: ["books"],
      },
      ...greenfieldScreen,
      "opening-confirmation-classification-0-r0": {
        approved: false, revisionRequested: null, responseClass: "off_topic",
      },
      "opening-confirmation-classification-0-r1": {
        approved: true, revisionRequested: null,
      },
    };

    await step(persistence, session, createAdapter(llm));
    await step(persistence, session, createAdapter(llm, { "opening-greet-r0": "Reading tracker" }));

    // First attempt: user says nonsense → deviation → retry prompt appears
    const retry = await suspended(
      persistence, session,
      createAdapter(llm, { "opening-summary-r0": "zuzu" }),
    );
    expect(retry.id).toBe("opening-summary-r1");

    // Second attempt: user gives valid response → proceeds past opening
    await step(persistence, session, createAdapter(llm, { "opening-summary-r1": "Yes, that's right" }));
    const state = persistence.current()!;
    const ids = state.entries.map((e: any) => e.id);
    expect(ids).toContain("opening-confirmation-classification-0-r1");
  });
});
