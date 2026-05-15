import { describe, it, expect } from "vitest";
import { ArtifactAggregate } from "../aggregate/index.js";

describe("ArtifactAggregate", () => {
  // PAM singletons

  describe("PAM singletons", () => {
    it("sets purpose", () => {
      const agg = new ArtifactAggregate();
      agg.setPurpose("solve X", 0.5);
      expect(agg.data.purpose).toEqual({ statement: "solve X", confidence: 0.5 });
    });

    it("sets advantage with source", () => {
      const agg = new ArtifactAggregate();
      agg.setAdvantage("faster", 0.7, { promptId: "p3" });
      expect(agg.data.advantage).toEqual({ statement: "faster", confidence: 0.7, source: { promptId: "p3" } });
    });

    it("sets measurement", () => {
      const agg = new ArtifactAggregate();
      agg.setMeasurement("50% less errors", 0.7);
      expect(agg.data.measurement).toEqual({ statement: "50% less errors", confidence: 0.7 });
    });

    it("confirmPam sets all non-absent slots to 0.9", () => {
      const agg = new ArtifactAggregate();
      agg.setPurpose("p", 0.5);
      agg.setMeasurement("m", 0.7);
      // advantage not set
      agg.confirmPam();
      expect(agg.data.purpose!.confidence).toBe(0.9);
      expect(agg.data.measurement!.confidence).toBe(0.9);
      expect(agg.data.advantage).toBeUndefined();
    });
  });

  // Goals

  describe("goals", () => {
    it("addFuzzyGoals generates sequential IDs and returns them", () => {
      const agg = new ArtifactAggregate();
      const ids = agg.addFuzzyGoals([
        { title: "G1", description: "d1" },
        { title: "G2", description: "d2", rationale: "r2" },
      ]);
      expect(ids).toEqual(["goal_001", "goal_002"]);
      expect(agg.data.goals).toHaveLength(2);
      expect(agg.data.goals[0]).toMatchObject({ id: "goal_001", status: "fuzzy", confidence: 0.5 });
      expect(agg.data.goals[1].rationale).toBe("r2");
    });

    it("updateGoal updates fields and returns true", () => {
      const agg = new ArtifactAggregate();
      agg.addFuzzyGoals([{ title: "old", description: "old" }]);
      const changed = agg.updateGoal("goal_001", { title: "new" });
      expect(changed).toBe(true);
      expect(agg.data.goals[0].title).toBe("new");
      expect(agg.data.goals[0].description).toBe("old"); // unchanged
    });

    it("updateGoal returns false for missing ID", () => {
      const agg = new ArtifactAggregate();
      expect(agg.updateGoal("nope", { title: "x" })).toBe(false);
    });

    it("setGoalStatus pairs status and confidence", () => {
      const agg = new ArtifactAggregate();
      agg.addFuzzyGoals([{ title: "G", description: "d" }]);
      agg.setGoalStatus("goal_001", "elaborated");
      expect(agg.data.goals[0].status).toBe("elaborated");
      expect(agg.data.goals[0].confidence).toBe(0.7);
    });

    it("removeGoals filters by ID set", () => {
      const agg = new ArtifactAggregate();
      agg.addFuzzyGoals([{ title: "A", description: "" }, { title: "B", description: "" }]);
      agg.removeGoals(new Set(["goal_001"]));
      expect(agg.data.goals).toHaveLength(1);
      expect(agg.data.goals[0].id).toBe("goal_002");
    });

    it("confirmElaboratedGoals batch-confirms", () => {
      const agg = new ArtifactAggregate();
      agg.addFuzzyGoals([{ title: "A", description: "" }, { title: "B", description: "" }]);
      agg.setGoalStatus("goal_001", "elaborated");
      // goal_002 stays fuzzy
      agg.confirmElaboratedGoals();
      expect(agg.data.goals[0].status).toBe("confirmed");
      expect(agg.data.goals[0].confidence).toBe(0.9);
      expect(agg.data.goals[1].status).toBe("fuzzy"); // unchanged
    });

    it("goal() looks up by ID", () => {
      const agg = new ArtifactAggregate();
      agg.addFuzzyGoals([{ title: "G", description: "d" }]);
      expect(agg.goal("goal_001")?.title).toBe("G");
      expect(agg.goal("nope")).toBeUndefined();
    });
  });

  // Stakeholders

  describe("stakeholders", () => {
    it("addIdentifiedStakeholders with defaults", () => {
      const agg = new ArtifactAggregate();
      agg.addIdentifiedStakeholders([{ name: "Alice", type: "primary" }]);
      expect(agg.data.stakeholders).toHaveLength(1);
      expect(agg.data.stakeholders[0]).toMatchObject({
        id: "stakeholder_001", name: "Alice", type: "primary",
        role: "", concerns: [], isRespondent: false, status: "identified", confidence: 0.5,
      });
    });

    it("updateStakeholder changes role", () => {
      const agg = new ArtifactAggregate();
      agg.addIdentifiedStakeholders([{ name: "A", type: "primary" }]);
      expect(agg.updateStakeholder("stakeholder_001", { role: "admin" })).toBe(true);
      expect(agg.data.stakeholders[0].role).toBe("admin");
    });

    it("addConcerns deduplicates", () => {
      const agg = new ArtifactAggregate();
      agg.addIdentifiedStakeholders([{ name: "A", type: "primary" }]);
      expect(agg.addConcerns("stakeholder_001", ["perf", "cost"])).toBe(2);
      expect(agg.addConcerns("stakeholder_001", ["perf", "security"])).toBe(1);
      expect(agg.data.stakeholders[0].concerns).toEqual(["perf", "cost", "security"]);
    });

    it("setRespondent marks respondent", () => {
      const agg = new ArtifactAggregate();
      agg.addIdentifiedStakeholders([{ name: "A", type: "primary" }]);
      agg.setRespondent("stakeholder_001");
      expect(agg.data.stakeholders[0].isRespondent).toBe(true);
    });

    it("setStakeholderStatus pairs status and confidence", () => {
      const agg = new ArtifactAggregate();
      agg.addIdentifiedStakeholders([{ name: "A", type: "primary" }]);
      agg.setStakeholderStatus("stakeholder_001", "elaborated");
      expect(agg.data.stakeholders[0].status).toBe("elaborated");
      expect(agg.data.stakeholders[0].confidence).toBe(0.7);
    });

    it("removeStakeholders filters", () => {
      const agg = new ArtifactAggregate();
      agg.addIdentifiedStakeholders([{ name: "A", type: "primary" }, { name: "B", type: "secondary" }]);
      agg.removeStakeholders(new Set(["stakeholder_001"]));
      expect(agg.data.stakeholders).toHaveLength(1);
      expect(agg.data.stakeholders[0].name).toBe("B");
    });

    it("confirmElaboratedStakeholders batch-confirms", () => {
      const agg = new ArtifactAggregate();
      agg.addIdentifiedStakeholders([{ name: "A", type: "primary" }, { name: "B", type: "secondary" }]);
      agg.setStakeholderStatus("stakeholder_001", "elaborated");
      agg.confirmElaboratedStakeholders();
      expect(agg.data.stakeholders[0].status).toBe("confirmed");
      expect(agg.data.stakeholders[0].confidence).toBe(0.9);
      expect(agg.data.stakeholders[1].status).toBe("identified"); // unchanged
    });
  });

  // Scope

  describe("scope", () => {
    it("addInScopeItems with shared scope ID space", () => {
      const agg = new ArtifactAggregate();
      agg.addInScopeItems([{ description: "in1" }]);
      agg.addOutOfScopeItems([{ description: "out1", reason: "not needed" }]);
      agg.addInScopeItems([{ description: "in2" }]);
      expect(agg.data.inScope[0].id).toBe("scope_001");
      expect(agg.data.outOfScope[0].id).toBe("scope_002");
      expect(agg.data.inScope[1].id).toBe("scope_003");
    });

    it("addInScopeItems uses default confidence 0.7", () => {
      const agg = new ArtifactAggregate();
      agg.addInScopeItems([{ description: "x", relatedGoals: ["goal_001"] }]);
      expect(agg.data.inScope[0].confidence).toBe(0.7);
      expect(agg.data.inScope[0].relatedGoals).toEqual(["goal_001"]);
    });

    it("addOutOfScopeItems defaults reason to empty", () => {
      const agg = new ArtifactAggregate();
      agg.addOutOfScopeItems([{ description: "x" }]);
      expect(agg.data.outOfScope[0].reason).toBe("");
    });

    it("addConstraints generates separate IDs", () => {
      const agg = new ArtifactAggregate();
      agg.addConstraints([{ description: "budget limit" }, { description: "deadline" }]);
      expect(agg.data.constraints[0].id).toBe("constraint_001");
      expect(agg.data.constraints[1].id).toBe("constraint_002");
    });

    it("removeScopeItems filters both in and out", () => {
      const agg = new ArtifactAggregate();
      agg.addInScopeItems([{ description: "a" }, { description: "b" }]);
      agg.addOutOfScopeItems([{ description: "c" }]);
      agg.removeScopeItems(new Set(["scope_001", "scope_003"]));
      expect(agg.data.inScope).toHaveLength(1);
      expect(agg.data.inScope[0].description).toBe("b");
      expect(agg.data.outOfScope).toHaveLength(0);
    });

    it("skips exact-duplicate in-scope items", () => {
      const agg = new ArtifactAggregate();
      agg.addInScopeItems([{ description: "Task board" }]);
      agg.addInScopeItems([{ description: "Task board" }]);
      expect(agg.data.inScope).toHaveLength(1);
    });

    it("skips exact-duplicate out-of-scope items", () => {
      const agg = new ArtifactAggregate();
      agg.addOutOfScopeItems([{ description: "Payroll" }]);
      agg.addOutOfScopeItems([{ description: "Payroll" }]);
      expect(agg.data.outOfScope).toHaveLength(1);
    });

    it("skips cross-list duplicates (in matches existing out)", () => {
      const agg = new ArtifactAggregate();
      agg.addOutOfScopeItems([{ description: "Chat feature" }]);
      agg.addInScopeItems([{ description: "Chat feature" }]);
      expect(agg.data.inScope).toHaveLength(0);
      expect(agg.data.outOfScope).toHaveLength(1);
    });

    it("dedup is case-insensitive and whitespace-normalized", () => {
      const agg = new ArtifactAggregate();
      agg.addInScopeItems([{ description: "Task  Board" }]);
      agg.addInScopeItems([{ description: "task board" }]);
      expect(agg.data.inScope).toHaveLength(1);
    });

    it("confirmScope sets confidence to 0.9", () => {
      const agg = new ArtifactAggregate();
      agg.addInScopeItems([{ description: "x" }]);
      agg.addOutOfScopeItems([{ description: "y" }]);
      agg.confirmScope();
      expect(agg.data.inScope[0].confidence).toBe(0.9);
      expect(agg.data.outOfScope[0].confidence).toBe(0.9);
    });
  });

  // Assumptions

  describe("assumptions", () => {
    it("addAssumptions with defaults", () => {
      const agg = new ArtifactAggregate();
      agg.addAssumptions([{ statement: "users have internet" }]);
      expect(agg.data.assumptions[0]).toMatchObject({
        id: "assumption_001", statement: "users have internet",
        type: "hypothesis", status: "unvalidated", confidence: 0.5,
      });
    });

    it("addAssumptions respects invariant type", () => {
      const agg = new ArtifactAggregate();
      agg.addAssumptions([{ statement: "x", type: "invariant" }]);
      expect(agg.data.assumptions[0].type).toBe("invariant");
    });

    it("addAssumptions with validated status", () => {
      const agg = new ArtifactAggregate();
      agg.addAssumptions([{ statement: "x" }], 0.9, "validated");
      expect(agg.data.assumptions[0].status).toBe("validated");
      expect(agg.data.assumptions[0].confidence).toBe(0.9);
    });

    it("setAssumptionStatus pairs status and confidence", () => {
      const agg = new ArtifactAggregate();
      agg.addAssumptions([{ statement: "x" }]);
      agg.setAssumptionStatus("assumption_001", "flagged");
      expect(agg.data.assumptions[0].status).toBe("flagged");
      expect(agg.data.assumptions[0].confidence).toBe(0.7);
    });

    it("removeAssumptions filters", () => {
      const agg = new ArtifactAggregate();
      agg.addAssumptions([{ statement: "a" }, { statement: "b" }]);
      agg.removeAssumptions(new Set(["assumption_001"]));
      expect(agg.data.assumptions).toHaveLength(1);
      expect(agg.data.assumptions[0].statement).toBe("b");
    });
  });

  // Waiting Room

  describe("waiting room", () => {
    it("addWaitingRoomItems generates IDs", () => {
      const agg = new ArtifactAggregate();
      agg.addWaitingRoomItems([{ content: "hint A" }, { content: "hint B" }]);
      expect(agg.data.waitingRoom).toHaveLength(2);
      expect(agg.data.waitingRoom[0].id).toBe("waiting_001");
      expect(agg.data.waitingRoom[1].id).toBe("waiting_002");
    });

    it("drainWaitingRoom filters by ID set", () => {
      const agg = new ArtifactAggregate();
      agg.addWaitingRoomItems([{ content: "a" }, { content: "b" }, { content: "c" }]);
      agg.drainWaitingRoom(new Set(["waiting_001", "waiting_003"]));
      expect(agg.data.waitingRoom).toHaveLength(1);
      expect(agg.data.waitingRoom[0].content).toBe("b");
    });

    it("drainWaitingRoom no-ops on empty set", () => {
      const agg = new ArtifactAggregate();
      agg.addWaitingRoomItems([{ content: "a" }]);
      agg.drainWaitingRoom(new Set());
      expect(agg.data.waitingRoom).toHaveLength(1);
    });
  });

  // Findings

  describe("findings", () => {
    it("addFinding generates IDs", () => {
      const agg = new ArtifactAggregate();
      agg.addFinding("gap A", "goals");
      agg.addFinding("gap B", "scope");
      expect(agg.data.findings).toHaveLength(2);
      expect(agg.data.findings[0]).toMatchObject({ id: "finding_001", content: "gap A", phase: "goals" });
    });

    it("findingsByPhase filters", () => {
      const agg = new ArtifactAggregate();
      agg.addFinding("a", "goals");
      agg.addFinding("b", "scope");
      agg.addFinding("c", "goals");
      expect(agg.findingsByPhase("goals")).toHaveLength(2);
      expect(agg.findingsByPhase("scope")).toHaveLength(1);
      expect(agg.findingsByPhase("purpose")).toHaveLength(0);
    });
  });

  // Session

  describe("user concern", () => {
    it("defaults to undefined", () => {
      const agg = new ArtifactAggregate();
      expect(agg.userConcern).toBeUndefined();
    });

    it("setUserConcern records the concern", () => {
      const agg = new ArtifactAggregate();
      agg.setUserConcern("Goals need more detail");
      expect(agg.userConcern).toBe("Goals need more detail");
    });
  });

  // ID safety

  describe("summarize", () => {
    it("returns empty summary for fresh aggregate", () => {
      const agg = new ArtifactAggregate();
      const s = agg.summarize();
      expect(s.purpose).toBeUndefined();
      expect(s.advantage).toBeUndefined();
      expect(s.measurement).toBeUndefined();
      expect(s.goals).toEqual([]);
      expect(s.stakeholders).toEqual([]);
      expect(s.inScope).toEqual([]);
      expect(s.outOfScope).toEqual([]);
      expect(s.constraints).toEqual([]);
      expect(s.assumptionCount).toBe(0);
      expect(s.findingCount).toBe(0);
    });

    it("includes PAM statements as strings", () => {
      const agg = new ArtifactAggregate();
      agg.setPurpose("track reading habits", 0.7);
      agg.setAdvantage("better than spreadsheets", 0.5);
      agg.setMeasurement("books per month", 0.5);
      const s = agg.summarize();
      expect(s.purpose).toBe("track reading habits");
      expect(s.advantage).toBe("better than spreadsheets");
      expect(s.measurement).toBe("books per month");
    });

    it("includes goal headlines", () => {
      const agg = new ArtifactAggregate();
      agg.addFuzzyGoals([
        { title: "Track books", description: "..." },
        { title: "Share reviews", description: "..." },
      ]);
      agg.setGoalStatus("goal_001", "elaborated");
      const s = agg.summarize();
      expect(s.goals).toEqual([
        { id: "goal_001", title: "Track books", status: "elaborated" },
        { id: "goal_002", title: "Share reviews", status: "fuzzy" },
      ]);
    });

    it("includes stakeholder headlines", () => {
      const agg = new ArtifactAggregate();
      agg.addIdentifiedStakeholders([
        { name: "Reader", type: "primary" },
        { name: "Librarian", type: "secondary" },
      ]);
      const s = agg.summarize();
      expect(s.stakeholders).toEqual([
        { id: "stakeholder_001", name: "Reader", type: "primary" },
        { id: "stakeholder_002", name: "Librarian", type: "secondary" },
      ]);
    });

    it("includes scope and constraint descriptions", () => {
      const agg = new ArtifactAggregate();
      agg.addInScopeItems([{ description: "Book catalog" }]);
      agg.addOutOfScopeItems([{ description: "E-commerce", reason: "not needed" }]);
      agg.addConstraints([{ description: "Must work offline" }]);
      const s = agg.summarize();
      expect(s.inScope).toEqual(["Book catalog"]);
      expect(s.outOfScope).toEqual(["E-commerce"]);
      expect(s.constraints).toEqual(["Must work offline"]);
    });

    it("counts assumptions and findings", () => {
      const agg = new ArtifactAggregate();
      agg.addAssumptions([
        { statement: "Users own smartphones" },
        { statement: "Internet available" },
      ]);
      agg.addFinding("Gap in offline scenario", "scope");
      const s = agg.summarize();
      expect(s.assumptionCount).toBe(2);
      expect(s.findingCount).toBe(1);
    });
  });

  describe("ID generation safety", () => {
    it("nextId scans remaining items for max suffix", () => {
      const agg = new ArtifactAggregate();
      agg.addFuzzyGoals([{ title: "A", description: "" }, { title: "B", description: "" }, { title: "C", description: "" }]);
      // remove middle item — max is still 3
      agg.removeGoals(new Set(["goal_002"]));
      const ids = agg.addFuzzyGoals([{ title: "D", description: "" }]);
      expect(ids).toEqual(["goal_004"]);
    });
  });

  describe("source provenance", () => {
    const src = { promptId: "opening-greet-r0" };

    it("addFuzzyGoals propagates source", () => {
      const agg = new ArtifactAggregate();
      agg.addFuzzyGoals([{ title: "G", description: "d" }], src);
      expect(agg.data.goals[0].source).toEqual(src);
    });

    it("addFuzzyGoals without source leaves field absent", () => {
      const agg = new ArtifactAggregate();
      agg.addFuzzyGoals([{ title: "G", description: "d" }]);
      expect(agg.data.goals[0].source).toBeUndefined();
    });

    it("addIdentifiedStakeholders propagates source", () => {
      const agg = new ArtifactAggregate();
      agg.addIdentifiedStakeholders([{ name: "User", type: "primary" }], src);
      expect(agg.data.stakeholders[0].source).toEqual(src);
    });

    it("addInScopeItems propagates source", () => {
      const agg = new ArtifactAggregate();
      agg.addInScopeItems([{ description: "item" }], undefined, src);
      expect(agg.data.inScope[0].source).toEqual(src);
    });

    it("addOutOfScopeItems propagates source", () => {
      const agg = new ArtifactAggregate();
      agg.addOutOfScopeItems([{ description: "item" }], undefined, src);
      expect(agg.data.outOfScope[0].source).toEqual(src);
    });

    it("addConstraints propagates source", () => {
      const agg = new ArtifactAggregate();
      agg.addConstraints([{ description: "budget limit" }], src);
      expect(agg.data.constraints[0].source).toEqual(src);
    });

    it("addAssumptions propagates source", () => {
      const agg = new ArtifactAggregate();
      agg.addAssumptions([{ statement: "users have internet" }], undefined, undefined, src);
      expect(agg.data.assumptions[0].source).toEqual(src);
    });

    it("setPurpose preserves existing source on update", () => {
      const agg = new ArtifactAggregate();
      agg.setPurpose("original", 0.5, { promptId: "p1" });
      agg.setPurpose("updated", 0.7, { promptId: "p9" });
      expect(agg.data.purpose!.statement).toBe("updated");
      expect(agg.data.purpose!.source).toEqual({ promptId: "p1" });
    });

    it("applyPamExtraction preserves existing source", () => {
      const agg = new ArtifactAggregate();
      agg.setPurpose("first", 0.5, { promptId: "p2" });
      agg.applyPamExtraction({ purpose: "second" }, { promptId: "p8" });
      expect(agg.data.purpose!.statement).toBe("second");
      expect(agg.data.purpose!.source).toEqual({ promptId: "p2" });
    });

    it("applyPamExtraction sets source on first fill", () => {
      const agg = new ArtifactAggregate();
      agg.applyPamExtraction({ purpose: "new" }, { promptId: "p3" });
      expect(agg.data.purpose!.source).toEqual({ promptId: "p3" });
    });

    it("confirmPam preserves source through confidence bump", () => {
      const agg = new ArtifactAggregate();
      agg.setPurpose("p", 0.5, { promptId: "p1" });
      agg.setAdvantage("a", 0.7, { promptId: "p2" });
      agg.confirmPam();
      expect(agg.data.purpose!.confidence).toBe(0.9);
      expect(agg.data.purpose!.source).toEqual({ promptId: "p1" });
      expect(agg.data.advantage!.source).toEqual({ promptId: "p2" });
    });

    it("confirmElaboratedGoals preserves source", () => {
      const agg = new ArtifactAggregate();
      agg.addFuzzyGoals([{ title: "G", description: "d" }], { promptId: "p4" });
      agg.setGoalStatus("goal_001", "elaborated");
      agg.confirmElaboratedGoals();
      expect(agg.data.goals[0].confidence).toBe(0.9);
      expect(agg.data.goals[0].source).toEqual({ promptId: "p4" });
    });

    it("confirmScope preserves source", () => {
      const agg = new ArtifactAggregate();
      agg.addInScopeItems([{ description: "x" }], undefined, { promptId: "p6" });
      agg.confirmScope();
      expect(agg.data.inScope[0].confidence).toBe(0.9);
      expect(agg.data.inScope[0].source).toEqual({ promptId: "p6" });
    });
  });
});
