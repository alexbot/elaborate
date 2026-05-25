/**
 * Structural tests verifying that all phases route through shared chokepoints.
 *
 * Approach: intercept ctx.infer() and ctx.prompt() at the WorkflowContext level.
 * When a call arrives, inspect the call stack for the expected chokepoint function
 * based on the schema shape / suggestion presence. Fails immediately at the call
 * site if a chokepoint is bypassed.
 *
 * See ADR: composition-quality.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { WorkflowContext, Suspend, type Prompt } from "../../durable/workflow.js";
import { session, memoryPersistence, step } from "../../phases/__tests__/helpers.js";
import { ComposeSchema, zodToPromptSchema } from "../describe.js";
import { compositionPreamble, classificationPreamble, extractionPreamble, suggestionCloser, confirmationCloser } from "../preambles.js";
import { formatSublabel } from "../progress.js";
import { ConfirmClassifySchema } from "../../phases/shared.js";

// Canonical schema shapes — derived from actual Zod schemas, not hand-coded keys
const COMPOSE_SCHEMA = zodToPromptSchema(ComposeSchema);
const CONFIRM_SCHEMA = zodToPromptSchema(ConfirmClassifySchema);

function schemaEquals(a?: Record<string, unknown>, b?: Record<string, unknown>): boolean {
  if (!a || !b) return false;
  const aKeys = Object.keys(a).sort();
  const bKeys = Object.keys(b).sort();
  return aKeys.length === bKeys.length && aKeys.every((k, i) => k === bKeys[i] && a[k] === b[k]);
}

describe("chokepoint enforcement", () => {
  const violations: string[] = [];

  const origInfer = WorkflowContext.prototype.infer;
  const origPrompt = WorkflowContext.prototype.prompt;

  beforeEach(() => {
    violations.length = 0;

    // Intercept infer: check call stack for correct chokepoint
    (WorkflowContext.prototype as any).infer = async function (...args: any[]) {
      const first = args[0];
      const schema: Record<string, unknown> | undefined =
        typeof first === "string" ? args[1]?.schema : first?.schema;

      const stack = new Error().stack ?? "";

      if (schemaEquals(schema, COMPOSE_SCHEMA) && !stack.includes("compose")) {
        const id = typeof first === "string" ? first : first?.id;
        violations.push(`Composition-schema infer "${id}" bypassed compose`);
      }

      if (schemaEquals(schema, CONFIRM_SCHEMA) && !stack.includes("confirm")) {
        const id = typeof first === "string" ? first : first?.id;
        violations.push(`Confirmation-schema infer "${id}" bypassed confirm`);
      }

      return origInfer.apply(this, args as any);
    };

    // Intercept prompt: check call stack for promptQuestion when suggestions present
    (WorkflowContext.prototype as any).prompt = async function (...args: any[]) {
      const first = args[0];
      const suggestions = typeof first === "string" ? args[1]?.suggestions : first?.suggestions;

      if (suggestions && suggestions.length > 0) {
        const stack = new Error().stack ?? "";
        if (!stack.includes("promptQuestion")) {
          const id = typeof first === "string" ? first : first?.id;
          violations.push(`Prompt with suggestions "${id}" bypassed promptQuestion`);
        }
      }

      return origPrompt.apply(this, args as any);
    };
  });

  afterEach(() => {
    WorkflowContext.prototype.infer = origInfer;
    WorkflowContext.prototype.prompt = origPrompt;
  });

  // Full pipeline LLM map — exercises all phases
  const llm: Record<string, unknown> = {
    "opening-greet-extraction-r0": { purpose: "track reading habits", stakeholders: ["readers"], domainHints: ["books"] },
    "opening-brownfield-extraction-r0": { isBrownfield: false, sourceIndicators: [] },
    "opening-confirmation-classification-0-r0": { approved: true, revisionRequested: null },
    "purpose-initial-extraction": { purpose: "track reading", advantage: "simpler than spreadsheets", measurement: "books per month", contradictions: [] },
    "purpose-confirmation-classification-0-r0": { approved: true, revisionRequested: null },
    "goal-seed-extraction": { goals: [{ title: "Track progress", description: "Monitor books" }] },
    "goal-seed-classification-r0": { responseInterpretation: "ok", confirmedGoalIds: ["goal_001"], removedGoalIds: [], newGoals: [], waitingRoomItems: [] },
    "goal-refinement-goal_001-clarify-0-composition-r0": { question: "What?", suggestions: ["A"] },
    "goal-refinement-goal_001-clarify-0-extraction-r0": { title: null, description: "Track books", rationale: null, contradictions: [], waitingRoomItems: [] },
    "goal-refinement-goal_001-why-0-composition-r0": { question: "Why?", suggestions: ["B"] },
    "goal-refinement-goal_001-why-0-extraction-r0": { title: null, description: null, rationale: "Motivation", contradictions: [], waitingRoomItems: [] },
    "goal-refinement-goal_001-negative-0-composition-r0": { question: "What if not?", suggestions: ["C"] },
    "goal-refinement-goal_001-negative-0-extraction-r0": { title: null, description: "Lose awareness", rationale: null, contradictions: [], waitingRoomItems: [] },
    "goal-discovery-composition-0": { question: "More?", suggestions: ["X"] },
    "goal-discovery-classification-0": { hasMoreGoals: false, newGoals: [], waitingRoomItems: [] },
    "goals-confirmation-classification-0-r0": { approved: true, revisionRequested: null },
    "stakeholder-review-classification-r0": { updatedTypes: [], removedIds: [], newStakeholders: [] },
    "stakeholder-respondent-present-extraction-r0": { respondentId: "stakeholder_001" },
    "stakeholder-elaboration-stakeholder_001-0-composition-r0": { question: "Role?", suggestions: ["Reader"] },
    "stakeholder-elaboration-stakeholder_001-0-extraction-r0": { role: "User", concerns: ["Ease"], contradictions: [], waitingRoomItems: [] },
    "stakeholders-confirmation-classification-0-r0": { approved: true, revisionRequested: null },
    "scope-seed-extraction": { inScope: [{ description: "Reading log", relatedGoals: ["goal_001"] }], outOfScope: [], ambiguous: [] },
    "scope-seed-classification-r0": { confirmedInScope: ["scope_001"], confirmedOutOfScope: [], removedIds: [], newItems: [], waitingRoomItems: [] },
    "scope-constraint-composition-r0": { question: "Constraints?", suggestions: ["Time"] },
    "scope-constraint-extraction-r0": { constraints: [], waitingRoomItems: [] },
    "scope-contradiction-check": { contradictions: [], orphans: [] },
    "scope-confirmation-classification-0-r0": { approved: true, revisionRequested: null },
    "assumption-seed-extraction": { assumptions: [{ statement: "Users read regularly", type: "hypothesis", relatedGoals: ["goal_001"] }] },
    "assumption-seed-classification-r0": { confirmedIds: ["assumption_001"], removedIds: [], newAssumptions: [], waitingRoomItems: [] },
    "assumption-validation-assumption_001-composition-r0": { question: "Do users read?", suggestions: ["Yes"] },
    "assumption-validation-assumption_001-extraction-r0": { verdict: "validated", waitingRoomItems: [] },
    "assumptions-confirmation-classification-0-r0": { approved: true, revisionRequested: null },
    "validation-consistency-check": { contradictions: [] },
    "validation-confirmation-classification-0-r0": { approved: true, revisionRequested: null },
  };

  const promptSequence: [string, string][] = [
    ["opening-greet-r0", "Reading tracker"],
    ["opening-brownfield-r0", "No"],
    ["opening-summary-r0", "Yes"],
    ["purpose-confirmation-r0", "Good"],
    ["goal-seed-present-r0", "Good"],
    ["goal-refinement-goal_001-clarify-0-question-r0", "Books finished"],
    ["goal-refinement-goal_001-why-0-question-r0", "Motivation"],
    ["goal-refinement-goal_001-negative-0-question-r0", "Lose track"],
    ["goal-discovery-question-0", "No more"],
    ["goals-confirmation-r0", "Good"],
    ["stakeholder-review-present-r0", "Good"],
    ["stakeholder-respondent-present-r0", "I'm the reader"],
    ["stakeholder-elaboration-stakeholder_001-0-question-r0", "Main user"],
    ["stakeholders-confirmation-r0", "Good"],
    ["scope-seed-present-r0", "Good"],
    ["scope-constraint-question-r0", "None"],
    ["scope-confirmation-r0", "Good"],
    ["assumption-seed-present-r0", "Good"],
    ["assumption-validation-assumption_001-question-r0", "Yes"],
    ["assumptions-confirmation-r0", "Good"],
    ["validation-summary-present-r0", "Confirmed"],
  ];

  function resolver(llmMap: Record<string, unknown>, env?: Record<string, unknown>) {
    return async (prompt: Prompt) => {
      if (prompt.type === "infer") return llmMap[prompt.id] ?? {};
      if (env && prompt.id in env) return env[prompt.id];
      throw new Suspend(prompt.id, prompt);
    };
  }

  async function driveToCompletion(llmMap: Record<string, unknown>, prompts: [string, string][]) {
    const persistence = memoryPersistence();
    let done = await step(persistence, session, resolver(llmMap));
    for (const [id, value] of prompts) {
      if (done) break;
      done = await step(persistence, session, resolver(llmMap, { [id]: value }));
    }
    expect(done).toBe(true);
  }

  it("composition-schema infer calls route through compose", async () => {
    await driveToCompletion(llm, promptSequence);
    expect(violations.filter(v => v.includes("bypassed compose"))).toEqual([]);
  });

  it("confirmation-schema infer calls route through confirm", async () => {
    await driveToCompletion(llm, promptSequence);
    expect(violations.filter(v => v.includes("bypassed confirm"))).toEqual([]);
  });

  it("prompt calls with suggestions route through promptQuestion", async () => {
    await driveToCompletion(llm, promptSequence);
    expect(violations.filter(v => v.includes("promptQuestion"))).toEqual([]);
  });

  // ── Preamble content ──

  it("compositionPreamble is non-empty and contains expected category tags", () => {
    const preamble = compositionPreamble();
    expect(preamble.length).toBeGreaterThan(0);
    for (const tag of ["<questioning>", "<formatting>", "<bias>", "<register>"]) {
      expect(preamble, `missing ${tag}`).toContain(tag);
    }
  });

  it("classificationPreamble is non-empty and contains expected category tags", () => {
    const preamble = classificationPreamble();
    expect(preamble.length).toBeGreaterThan(0);
    expect(preamble).toContain("<bias_correction>");
  });

  it("extractionPreamble is non-empty and contains expected category tags", () => {
    const preamble = extractionPreamble();
    expect(preamble.length).toBeGreaterThan(0);
    expect(preamble).toContain("<fidelity>");
  });

  it("suggestionCloser is non-empty", () => {
    expect(suggestionCloser().length).toBeGreaterThan(0);
  });

  // ── Preamble content assertions (deterministic-test-gaps) ──

  it("classificationPreamble contains bias-correction guidance", () => {
    const preamble = classificationPreamble();
    expect(preamble).toContain("correction signals");
    expect(preamble).toContain("ambiguous responses as revision");
    expect(preamble).toContain("hedging language");
    expect(preamble).toContain("clearly and unambiguously endorses");
  });

  it("confirmationCloser contains correction-inviting text", () => {
    const text = confirmationCloser();
    expect(text).toContain("change or add");
  });

  it("suggestionCloser contains open-ended language", () => {
    expect(suggestionCloser()).toContain("own words");
  });

  it("compositionPreamble contains suggestion diversity guidance", () => {
    const preamble = compositionPreamble();
    expect(preamble).toContain("Vary suggested answers");
  });

  // ── Static analysis catch-all ──

  it("no raw ctx.infer() calls in phase files beyond known exceptions", async () => {
    const fs = await import("fs");
    const path = await import("path");

    const phaseDir = path.resolve(import.meta.dirname, "..", "..", "phases");
    const phaseFiles = ["opening.ts", "purpose.ts", "goals.ts", "stakeholders.ts", "scope.ts", "assumptions.ts", "validation.ts"];

    // Known raw ctx.infer() call counts per file (non-composition schemas only)
    // goals.ts: 1 (goal-sort, GoalSortSchema)
    // stakeholders.ts: 3 (stakeholder-sort + followup-assessment + stakeholder-dedup)
    // scope.ts: 4 (scope-ambiguous-sort + scope-contradiction-check + scope-dedup + scope-dedup-post-revision)
    // validation.ts: 2 (validation-wr-classify + validation-consistency-check)
    // All others: 0
    const allowedCounts: Record<string, number> = {
      "opening.ts": 1,
      "goals.ts": 1,
      "stakeholders.ts": 3,
      "scope.ts": 4,
      "validation.ts": 2,
    };

    for (const file of phaseFiles) {
      const content = fs.readFileSync(path.join(phaseDir, file), "utf-8");
      const rawInferCalls = [...content.matchAll(/ctx\.infer(?![A-Z])\s*\(/g)];
      const expected = allowedCounts[file] ?? 0;

      expect(
        rawInferCalls.length,
        `${file}: expected ${expected} raw ctx.infer() call(s), found ${rawInferCalls.length}. ` +
        `New raw ctx.infer() calls must use a chokepoint method instead.`,
      ).toBe(expected);
    }
  });

  it("no static strings with 2+ question marks in source files", async () => {
    const fs = await import("fs");
    const path = await import("path");

    const srcDir = path.resolve(import.meta.dirname, "..", "..", "phases");
    const sourceFiles = ["opening.ts", "purpose.ts", "goals.ts", "stakeholders.ts", "scope.ts", "assumptions.ts", "validation.ts", "shared.ts"];

    // Extract string literals and check each for 2+ question marks.
    // For template literals, strip ${...} expressions first (they contain code-level ? operators).
    const stringLiterals = /`[^`]*`|"[^"]*"|'[^']*'/g;
    const templateExpr = /\$\{[^}]*\}/g;

    for (const file of sourceFiles) {
      const content = fs.readFileSync(path.join(srcDir, file), "utf-8");
      const lines = content.split("\n");

      const violations: string[] = [];
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (/^\s*(\/\/|\/\*|\*)/.test(line)) continue;
        let match;
        stringLiterals.lastIndex = 0;
        while ((match = stringLiterals.exec(line)) !== null) {
          // Strip template expressions so ternary ? inside ${} isn't counted
          const str = match[0].replace(templateExpr, "");
          const questionMarks = (str.match(/\?/g) || []).length;
          if (questionMarks >= 2) {
            violations.push(`  line ${i + 1}: ${match[0].slice(0, 80)}${match[0].length > 80 ? "…" : ""}`);
          }
        }
      }

      expect(
        violations.length,
        `${file}: found ${violations.length} string(s) with 2+ question marks (single-question-per-turn rule):\n${violations.join("\n")}`,
      ).toBe(0);
    }
  });

  // ── Progress and transitions ──

  describe("formatSublabel", () => {
    it("strips phase prefix and formats entity IDs", () => {
      expect(formatSublabel("goal-refinement-goal_001-clarify-0-question-r0")).toBe("refinement goal #1 clarify");
      expect(formatSublabel("stakeholder-elaboration-stakeholder_001-0-question-r0")).toBe("elaboration stakeholder #1");
      expect(formatSublabel("assumption-validation-assumption_001-question-r0")).toBe("validation assumption #1");
    });

    it("handles simple ids", () => {
      expect(formatSublabel("purpose-confirmation-r0")).toBe("confirmation");
      expect(formatSublabel("scope-constraint-question")).toBe("constraint");
      expect(formatSublabel("goals-confirmation-r0")).toBe("confirmation");
    });

    it("handles discovery and seed ids", () => {
      expect(formatSublabel("goal-discovery-question-0")).toBe("discovery");
      expect(formatSublabel("goal-seed-present-r0")).toBe("seed present");
    });
  });

  describe("promptStep progress", () => {
    let captured: { id: string; message: string } | null = null;
    const origPrompt = WorkflowContext.prototype.prompt;

    beforeEach(() => {
      captured = null;
      (WorkflowContext.prototype as any).prompt = async function (first: any) {
        captured = typeof first === "string" ? { id: first, message: "" } : { id: first.id, message: first.message };
        return "ok";
      };
    });
    afterEach(() => { WorkflowContext.prototype.prompt = origPrompt; });

    function makeCtx() {
      const p = memoryPersistence();
      p.initialize();
      return new WorkflowContext(p, async () => "ok");
    }

    it("returns message unchanged when no progress is set", async () => {
      const ctx = makeCtx();
      await ctx.promptStep({ id: "test-id", message: "Hello" });
      expect(captured!.message).toBe("Hello");
    });

    it("prepends progress prefix", async () => {
      const ctx = makeCtx();
      ctx.setProgress(3, 7, "Goals");
      await ctx.promptStep({ id: "goals-confirmation-r0", message: "Summary here" });
      expect(captured!.message).toBe("[3/7 Goals · confirmation]\n\nSummary here");
    });

    it("uses blank lines between prompt sections", async () => {
      const ctx = makeCtx();
      ctx.setProgress(2, 6, "Purpose");

      await ctx.promptQuestion("purpose-r0", {
        question: "What makes opening a pet shop more appealing to you than other paths you could take?",
        suggestions: [
          "I want to work with animals directly",
          "There is demand in my area",
          "I am not sure yet",
        ],
      });

      expect(captured!.message).toContain("[2/6 Purpose]\n\nWhat makes opening a pet shop");
      expect(captured!.message).toContain(
        "For example:\n\na) I want to work with animals directly\n\nb) There is demand in my area\n\nc) I am not sure yet\n\n...or better yet",
      );
    });

    it("consumes transition once", async () => {
      const ctx = makeCtx();
      ctx.setProgress(3, 7, "Goals");
      ctx.setTransition("Now let's talk about goals.");

      await ctx.promptStep({ id: "goal-seed-present-r0", message: "Here are your goals:" });
      expect(captured!.message).toContain("Now let's talk about goals.");
      expect(captured!.message).toContain("[3/7 Goals");

      await ctx.promptStep({ id: "goals-confirmation-r0", message: "Summary" });
      expect(captured!.message).not.toContain("Now let's talk about goals.");
    });
  });
});
