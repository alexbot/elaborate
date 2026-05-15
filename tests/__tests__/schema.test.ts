import { describe, it, expect } from "vitest";
import { ScenarioSchema, CapabilityTag, normalizeConstraint } from "../harness/schema.js";
import { loadAllScenarios, loadScenariosByCapability } from "../harness/loader.js";

describe("ScenarioSchema", () => {
  const minimal = {
    scenario: {
      id: "test-scenario",
      source: { dataset: "test", original_id: "t01" },
      problem_statement: "Build a widget tracker",
      domain: "productivity",
      hidden_constraints: ["Must support offline mode"],
      success_criteria: ["Identifies offline requirement"],
      difficulty: "easy",
      capability_tags: ["purpose_clarification"],
    },
  };

  it("accepts a minimal valid scenario", () => {
    const result = ScenarioSchema.parse(minimal);
    expect(result.scenario.id).toBe("test-scenario");
    expect(result.scenario.start_type).toBe("greenfield");
  });

  it("accepts a full scenario with all optional fields", () => {
    const full = {
      scenario: {
        ...minimal.scenario,
        source: { dataset: "user-stories", url: "https://example.com", original_id: "g02" },
        start_type: "brownfield",
        existing_context: "Legacy system uses PostgreSQL with 3 REST endpoints.",
        capability_tags: ["purpose_clarification", "brownfield_context", "stakeholder_identification"],
        behavioral_directives: [
          { turn: 4, directive: "Respond off-topic about your vacation" },
          { turn: 8, directive: "Contradict your earlier answer about users" },
        ],
        mid_conversation_assertions: [
          { condition: "Elaborate should have asked about stakeholders", by_turn: 10 },
          { condition: "Progress prefix visible" },
        ],
      },
    };
    const result = ScenarioSchema.parse(full);
    expect(result.scenario.start_type).toBe("brownfield");
    expect(result.scenario.existing_context).toContain("PostgreSQL");
    expect(result.scenario.behavioral_directives).toHaveLength(2);
    expect(result.scenario.mid_conversation_assertions).toHaveLength(2);
  });

  it("accepts structured hidden constraints", () => {
    const withStructured = {
      scenario: {
        ...minimal.scenario,
        hidden_constraints: [
          { category: "technical", constraint: "Must use WebSockets", discovery_cue: "Ask about real-time requirements" },
          { category: "regulatory", constraint: "GDPR compliance required" },
          "Simple string constraint",
        ],
      },
    };
    const result = ScenarioSchema.parse(withStructured);
    expect(result.scenario.hidden_constraints).toHaveLength(3);
  });

  it("rejects empty hidden_constraints", () => {
    const bad = {
      scenario: { ...minimal.scenario, hidden_constraints: [] },
    };
    expect(() => ScenarioSchema.parse(bad)).toThrow();
  });

  it("rejects empty success_criteria", () => {
    const bad = {
      scenario: { ...minimal.scenario, success_criteria: [] },
    };
    expect(() => ScenarioSchema.parse(bad)).toThrow();
  });

  it("rejects invalid difficulty", () => {
    const bad = {
      scenario: { ...minimal.scenario, difficulty: "extreme" },
    };
    expect(() => ScenarioSchema.parse(bad)).toThrow();
  });

  it("rejects invalid capability tag", () => {
    const bad = {
      scenario: { ...minimal.scenario, capability_tags: ["nonexistent_tag"] },
    };
    expect(() => ScenarioSchema.parse(bad)).toThrow();
  });

  it("rejects empty capability_tags", () => {
    const bad = {
      scenario: { ...minimal.scenario, capability_tags: [] },
    };
    expect(() => ScenarioSchema.parse(bad)).toThrow();
  });

  it("rejects missing required fields", () => {
    expect(() => ScenarioSchema.parse({ scenario: {} })).toThrow();
    expect(() => ScenarioSchema.parse({})).toThrow();
  });
});

describe("CapabilityTag", () => {
  it("validates all 12 capability tags", () => {
    const tags = [
      "purpose_clarification", "goal_elicitation", "stakeholder_identification",
      "scope_definition", "assumption_surfacing", "deviation_resilience",
      "budget_compliance", "confirmation_framing", "progress_tracking",
      "brownfield_context", "cross_phase_coherence", "waiting_room_lifecycle",
    ];
    for (const tag of tags) {
      expect(() => CapabilityTag.parse(tag)).not.toThrow();
    }
    expect(tags).toHaveLength(12);
  });
});

describe("scenario corpus", () => {
  const EXPECTED_IDS = [
    "federalspending", "neurohub", "rdadmp", "alfred",
    "scrumalliance", "cask", "ski", "recycling",
  ];

  it("loads all 8 scenario files", () => {
    const scenarios = loadAllScenarios();
    expect(scenarios.size).toBe(8);
    for (const id of EXPECTED_IDS) {
      expect(scenarios.has(id)).toBe(true);
    }
  });

  it("validates all scenarios through Zod", () => {
    const scenarios = loadAllScenarios();
    for (const [id, scenario] of scenarios) {
      expect(scenario.id).toBe(id);
      expect(scenario.hidden_constraints.length).toBeGreaterThan(0);
      expect(scenario.success_criteria.length).toBeGreaterThan(0);
      expect(scenario.capability_tags.length).toBeGreaterThan(0);
    }
  });

  it("has 3 brownfield scenarios with existing_context", () => {
    const scenarios = loadAllScenarios();
    const brownfield = [...scenarios.values()].filter((s) => s.start_type === "brownfield");
    expect(brownfield).toHaveLength(3);
    for (const s of brownfield) {
      expect(s.existing_context).toBeTruthy();
    }
  });

  it("has behavioral directives on deviation-test candidates", () => {
    const scenarios = loadAllScenarios();
    const deviationCandidates = ["recycling", "ski", "scrumalliance"];
    for (const id of deviationCandidates) {
      const s = scenarios.get(id)!;
      expect(s.behavioral_directives).toBeDefined();
      expect(s.behavioral_directives!.length).toBeGreaterThan(0);
    }
  });

  it("covers all 12 capability tags at least twice", () => {
    const scenarios = loadAllScenarios();
    const tagCounts = new Map<string, number>();
    for (const s of scenarios.values()) {
      for (const tag of s.capability_tags) {
        tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
      }
    }
    const allTags = CapabilityTag.options;
    for (const tag of allTags) {
      expect(tagCounts.get(tag) ?? 0, `tag ${tag} coverage`).toBeGreaterThanOrEqual(2);
    }
  });

  it("filters by capability tag", () => {
    const brownfield = loadScenariosByCapability("brownfield_context");
    expect(brownfield.size).toBe(3);
    expect(brownfield.has("federalspending")).toBe(true);
    expect(brownfield.has("neurohub")).toBe(true);
    expect(brownfield.has("rdadmp")).toBe(true);
  });

  it("has correct difficulty spread (1 easy, 4 medium, 3 hard)", () => {
    const scenarios = loadAllScenarios();
    const byCounts = { easy: 0, medium: 0, hard: 0 };
    for (const s of scenarios.values()) {
      byCounts[s.difficulty]++;
    }
    expect(byCounts.easy).toBe(1);
    expect(byCounts.medium).toBe(4);
    expect(byCounts.hard).toBe(3);
  });
});

describe("normalizeConstraint", () => {
  it("normalizes string constraints to object form", () => {
    const result = normalizeConstraint("Must be fast");
    expect(result).toEqual({ category: "general", constraint: "Must be fast" });
  });

  it("passes through object constraints", () => {
    const obj = { category: "perf", constraint: "Must be fast", discovery_cue: "Ask about speed" };
    expect(normalizeConstraint(obj)).toEqual(obj);
  });
});
