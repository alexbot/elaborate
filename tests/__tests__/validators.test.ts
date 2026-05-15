import { describe, it, expect } from "vitest";
import { createEmptyArtifacts } from "../../src/phases/schema.js";
import type { Artifacts } from "../../src/phases/schema.js";
import {
  noSelfResolution,
  traceProvenance,
  budgetCompliance,
  waitingRoomLifecycle,
  confidenceMonotonicity,
  chokepointRouting,
  ALL_VALIDATORS,
} from "../validators/index.js";
import type { ValidatorInput, StateEntry } from "../validators/index.js";

function makeInput(
  entries: StateEntry[] = [],
  artifacts: Partial<Artifacts> = {},
): ValidatorInput {
  return {
    entries,
    artifacts: { ...createEmptyArtifacts(), ...artifacts },
  };
}

describe("no-self-resolution", () => {
  it("passes when confirmed artifacts have confirmation prompts", () => {
    const entries: StateEntry[] = [
      { id: "purpose-composition-r0", value: { question: "What?" } },
      { id: "purpose-extraction-r0", value: { statement: "A tool" } },
      { id: "purpose-confirmation-r0", value: "yes, looks good" },
    ];
    const artifacts = { purpose: { statement: "A tool", confidence: 0.9, source: { turnId: 1 } } };
    const result = noSelfResolution(makeInput(entries, artifacts));
    expect(result.pass).toBe(true);
  });

  it("fails when confirmed artifacts lack confirmation prompts", () => {
    const entries: StateEntry[] = [
      { id: "purpose-extraction-r0", value: { statement: "A tool" } },
    ];
    const artifacts = { purpose: { statement: "A tool", confidence: 0.9 } };
    const result = noSelfResolution(makeInput(entries, artifacts));
    expect(result.pass).toBe(false);
    expect(result.details).toContain("purpose");
  });

  it("passes when no artifacts are confirmed", () => {
    const entries: StateEntry[] = [
      { id: "purpose-extraction-r0", value: { statement: "A tool" } },
    ];
    const artifacts = { purpose: { statement: "A tool", confidence: 0.5 } };
    const result = noSelfResolution(makeInput(entries, artifacts));
    expect(result.pass).toBe(true);
  });

  it("checks goals phase", () => {
    const entries: StateEntry[] = [
      { id: "goals-confirmation-r0", value: "confirmed" },
    ];
    const artifacts = {
      goals: [{ id: "g1", title: "G", description: "", status: "confirmed" as const, confidence: 0.9 }],
    };
    const result = noSelfResolution(makeInput(entries, artifacts));
    expect(result.pass).toBe(true);
  });
});

describe("trace-provenance", () => {
  it("passes when all confirmed artifacts have source.promptId", () => {
    const artifacts = {
      purpose: { statement: "A tool", confidence: 0.9, source: { promptId: "purpose-purpose-0-question-r0" } },
      goals: [
        { id: "g1", title: "G", description: "", status: "confirmed" as const, confidence: 0.9, source: { promptId: "goal-seed-present-r0" } },
      ],
    };
    const result = traceProvenance(makeInput([], artifacts));
    expect(result.pass).toBe(true);
  });

  it("fails when confirmed artifact lacks source", () => {
    const artifacts = {
      purpose: { statement: "A tool", confidence: 0.9 },
    };
    const result = traceProvenance(makeInput([], artifacts));
    expect(result.pass).toBe(false);
    expect(result.details).toContain("purpose");
  });

  it("ignores non-confirmed artifacts", () => {
    const artifacts = {
      goals: [
        { id: "g1", title: "G", description: "", status: "fuzzy" as const, confidence: 0.5 },
      ],
    };
    const result = traceProvenance(makeInput([], artifacts));
    expect(result.pass).toBe(true);
  });

  it("checks stakeholders", () => {
    const artifacts = {
      stakeholders: [
        { id: "s1", name: "User", type: "primary" as const, role: "", concerns: [], isRespondent: true, status: "confirmed" as const, confidence: 0.9 },
      ],
    };
    const result = traceProvenance(makeInput([], artifacts));
    expect(result.pass).toBe(false);
    expect(result.details).toContain("stakeholder:s1");
  });
});

describe("budget-compliance", () => {
  it("passes when all phases within budget", () => {
    const entries: StateEntry[] = [
      { id: "opening-greet-r0", value: "hi" },
      { id: "purpose-confirmation-r0", value: "yes" },
    ];
    const result = budgetCompliance(makeInput(entries));
    expect(result.pass).toBe(true);
  });

  it("fails when a phase exceeds budget", () => {
    const entries: StateEntry[] = Array.from({ length: 10 }, (_, i) => ({
      id: `opening-prompt-${i}-r0`,
      value: `response ${i}`,
    }));
    const result = budgetCompliance(makeInput(entries));
    expect(result.pass).toBe(false);
    expect(result.details).toContain("opening");
  });

  it("ignores infer entries (non-string values)", () => {
    const entries: StateEntry[] = [
      { id: "opening-extraction-r0", value: { purpose: "test" } },
      { id: "opening-composition-r0", value: { question: "What?" } },
      { id: "opening-greet-r0", value: "hello" },
    ];
    const result = budgetCompliance(makeInput(entries));
    expect(result.pass).toBe(true);
  });

  it("ignores suspended entries", () => {
    const entries: StateEntry[] = [
      { id: "opening-greet-r0", value: "hello", suspended: true },
    ];
    const result = budgetCompliance(makeInput(entries));
    expect(result.pass).toBe(true);
  });
});

describe("waiting-room-lifecycle", () => {
  it("passes when waiting room is empty", () => {
    const result = waitingRoomLifecycle(makeInput([]));
    expect(result.pass).toBe(true);
  });

  it("fails when items remain undrained", () => {
    const artifacts = {
      waitingRoom: [{ id: "wr1", content: "Orphaned item" }],
    };
    const result = waitingRoomLifecycle(makeInput([], artifacts));
    expect(result.pass).toBe(false);
    expect(result.details).toContain("wr1");
  });

  it("passes when remaining items appear in findings", () => {
    const artifacts = {
      waitingRoom: [{ id: "wr1", content: "Security concern" }],
      findings: [{ id: "f1", content: "Security concern was noted during scope phase", phase: "scope" }],
    };
    const result = waitingRoomLifecycle(makeInput([], artifacts));
    expect(result.pass).toBe(true);
  });
});

describe("confidence-monotonicity", () => {
  it("passes with valid confidence values", () => {
    const artifacts = {
      goals: [
        { id: "g1", title: "G1", description: "", status: "confirmed" as const, confidence: 0.9 },
        { id: "g2", title: "G2", description: "", status: "fuzzy" as const, confidence: 0.5 },
      ],
    };
    const result = confidenceMonotonicity(makeInput([], artifacts));
    expect(result.pass).toBe(true);
  });

  it("fails with invalid confidence value", () => {
    const artifacts = {
      goals: [
        { id: "g1", title: "G1", description: "", status: "fuzzy" as const, confidence: 0.3 },
      ],
    };
    const result = confidenceMonotonicity(makeInput([], artifacts));
    expect(result.pass).toBe(false);
    expect(result.details).toContain("invalid confidence 0.3");
  });

  it("fails when status and confidence disagree", () => {
    const artifacts = {
      goals: [
        { id: "g1", title: "G1", description: "", status: "confirmed" as const, confidence: 0.5 },
      ],
    };
    const result = confidenceMonotonicity(makeInput([], artifacts));
    expect(result.pass).toBe(false);
    expect(result.details).toContain("status=confirmed but confidence=0.5");
  });

  it("checks stakeholder status-confidence mapping", () => {
    const artifacts = {
      stakeholders: [
        { id: "s1", name: "U", type: "primary" as const, role: "", concerns: [], isRespondent: true, status: "identified" as const, confidence: 0.5 },
      ],
    };
    const result = confidenceMonotonicity(makeInput([], artifacts));
    expect(result.pass).toBe(true);
  });
});

describe("chokepoint-routing", () => {
  it("passes when all infer entries follow naming patterns", () => {
    const entries: StateEntry[] = [
      { id: "opening-greet-composition-r0", value: { question: "Hi" } },
      { id: "opening-greet-extraction-r0", value: { purpose: "test" } },
      { id: "opening-greet-r0", value: "hello" },
      { id: "purpose-confirmation-classification-r0", value: { action: "confirm" } },
    ];
    const result = chokepointRouting(makeInput(entries));
    expect(result.pass).toBe(true);
  });

  it("passes for known raw infer exceptions", () => {
    const entries: StateEntry[] = [
      { id: "goals-sort-r0", value: { sorted: ["g1", "g2"] } },
      { id: "stakeholders-sort-r0", value: { sorted: ["s1"] } },
      { id: "scope-ambiguous-sort-r0", value: { sorted: ["i1"] } },
      { id: "scope-contradiction-check-r0", value: { contradictions: [] } },
    ];
    const result = chokepointRouting(makeInput(entries));
    expect(result.pass).toBe(true);
  });

  it("fails for unrecognized infer patterns", () => {
    const entries: StateEntry[] = [
      { id: "goals-mystery-call-r0", value: { something: true } },
    ];
    const result = chokepointRouting(makeInput(entries));
    expect(result.pass).toBe(false);
    expect(result.details).toContain("goals-mystery-call-r0");
  });

  it("ignores prompt entries", () => {
    const entries: StateEntry[] = [
      { id: "any-random-id", value: "user text" },
    ];
    const result = chokepointRouting(makeInput(entries));
    expect(result.pass).toBe(true);
  });
});

describe("ALL_VALIDATORS", () => {
  it("contains all 6 validators", () => {
    expect(ALL_VALIDATORS).toHaveLength(6);
  });

  it("all pass on empty input", () => {
    const input = makeInput();
    const results = ALL_VALIDATORS.map((v) => v(input));
    for (const r of results) {
      expect(r.pass).toBe(true);
    }
  });
});
