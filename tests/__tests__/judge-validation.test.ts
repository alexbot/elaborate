/**
 * Empirical judge validation — runs 2 scenarios (hard + easy) through
 * candidate judge models and compares rubric completeness, evidence quality,
 * and process compliance detection.
 *
 * Requires: JUDGE_MODEL, ELI_MODEL, SH_MODEL env vars set.
 * Run: npx vitest run --config vitest.eval.config.ts tests/__tests__/judge-validation.test.ts
 *
 * This is an expensive test (~$3-6 per run). Run manually, not in CI.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { loadDriverConfig, loadModelLabels } from "../harness/config.js";
import { loadScenario } from "../harness/loader.js";
import { runScenario } from "../harness/runner.js";
import { evaluateSession } from "../harness/judge.js";
import { extractSessionData, persistResult } from "../harness/evaluate.js";
import { ALL_VALIDATORS } from "../validators/index.js";
import { join } from "node:path";
import type { JudgeResult } from "../harness/types.js";
import type { RunResult } from "../harness/types.js";
import type { Scenario } from "../harness/schema.js";

const SCENARIOS_DIR = join(import.meta.dirname, "..", "scenarios");
const RESULTS_DIR = join(import.meta.dirname, "..", "results");

function hasRequiredEnvVars(): boolean {
  try {
    loadDriverConfig();
    return true;
  } catch {
    return false;
  }
}

describe("empirical judge validation", () => {
  const skip = !hasRequiredEnvVars();

  const scenarios: Array<{ name: string; file: string; expectedDifficulty: string }> = [
    { name: "recycling (easy)", file: "recycling.yaml", expectedDifficulty: "easy" },
    { name: "alfred (medium)", file: "alfred.yaml", expectedDifficulty: "medium" },
    { name: "ski (medium)", file: "ski.yaml", expectedDifficulty: "medium" },
    { name: "scrumalliance (medium)", file: "scrumalliance.yaml", expectedDifficulty: "medium" },
    { name: "rdadmp (medium)", file: "rdadmp.yaml", expectedDifficulty: "medium" },
    { name: "elaborate (hard)", file: "elaborate.yaml", expectedDifficulty: "hard" },
    { name: "cask (hard)", file: "cask.yaml", expectedDifficulty: "hard" },
    { name: "neurohub (hard)", file: "neurohub.yaml", expectedDifficulty: "hard" },
    { name: "federalspending (hard)", file: "federalspending.yaml", expectedDifficulty: "hard" },
    { name: "library (medium)", file: "library.yaml", expectedDifficulty: "medium" },
    { name: "cookies (easy)", file: "cookies.yaml", expectedDifficulty: "easy" },
  ];

  for (const { name, file, expectedDifficulty } of scenarios) {
    describe(name, () => {
      let scenario: Scenario;
      let runResult: RunResult;
      let judgeResult: JudgeResult;

      beforeAll(async () => {
        if (skip) return;

        scenario = loadScenario(join(SCENARIOS_DIR, file));
        expect(scenario.difficulty).toBe(expectedDifficulty);

        const { generation: generationDriver, stakeholder: stakeholderDriver, judge: judgeDriver } = loadDriverConfig();

        console.log(`Running scenario: ${scenario.id}`);
        runResult = await runScenario({
          scenario,
          generationDriver,
          stakeholderDriver,
          maxTurns: 200,
          models: loadModelLabels(),
          onMessage: (msg) => {
            console.log(`  [${msg.role}] turn ${msg.turn}: ${msg.content.slice(0, 80)}...`);
          },
        });

        console.log(`Run complete: status=${runResult.status}, turns=${runResult.turnCount}, ${runResult.durationMs}ms`);
        if (runResult.error) console.error(`Run error: ${runResult.error}`);

        expect(["completed", "truncated"]).toContain(runResult.status);

        const { entries, artifacts } = await extractSessionData(runResult.sessionDir);

        console.log(`Running judge (3x self-consistency)...`);
        judgeResult = await evaluateSession({
          driver: judgeDriver,
          scenario,
          transcript: runResult.transcript,
          artifacts,
          questionCount: runResult.questionCount,
          turnCount: runResult.turnCount,
          runs: 3,
        });

        const validators = ALL_VALIDATORS.map((v) => v({ entries, artifacts }));
        const saved = persistResult({
          scenarioId: scenario.id,
          run: runResult,
          validators,
          judge: judgeResult,
          timestamp: new Date().toISOString(),
        }, RESULTS_DIR);
        console.log(`Results saved: ${saved}`);
      }, 1_200_000);

      it.skipIf(skip)("completes the session", () => {
        expect(["completed", "truncated"]).toContain(runResult.status);
        expect(runResult.turnCount).toBeGreaterThan(0);
        expect(runResult.transcript.length).toBeGreaterThan(0);
      });

      it.skipIf(skip)("judge fills all rubric fields", () => {
        const avg = judgeResult.averaged;

        expect(avg.constraintDiscovery.total).toBe(scenario.hidden_constraints.length);
        expect(avg.constraintDiscovery.perConstraint.length).toBe(scenario.hidden_constraints.length);
        expect(avg.processCompliance.score).toBeGreaterThanOrEqual(0);
        expect(avg.processCompliance.score).toBeLessThanOrEqual(100);
        expect(avg.quality.relevance.score).toBeGreaterThanOrEqual(0);
        expect(avg.quality.completeness.score).toBeGreaterThanOrEqual(0);
        expect(avg.quality.efficiency.score).toBeGreaterThanOrEqual(0);
      });

      it.skipIf(skip)("judge provides evidence for discovered constraints", () => {
        const discovered = judgeResult.averaged.constraintDiscovery.perConstraint
          .filter((c) => c.discovered);

        for (const c of discovered) {
          expect(c.evidence, `No evidence for: ${c.constraint}`).toBeTruthy();
        }
      });

      it.skipIf(skip)("judge produces process compliance findings", () => {
        expect(judgeResult.averaged.processCompliance.findings.length).toBeGreaterThan(0);
      });

      it.skipIf(skip)("self-consistency variance is within bounds", () => {
        expect(judgeResult.scores.length).toBe(3);
        if (judgeResult.highVariance) {
          console.warn(`High variance detected: ${judgeResult.varianceDetails}`);
        }
      });

      it.skipIf(skip)("validators run on the completed session", async () => {
        const { entries, artifacts } = await extractSessionData(runResult.sessionDir);
        const results = ALL_VALIDATORS.map((v) => v({ entries, artifacts }));

        for (const r of results) {
          console.log(`  Validator ${r.name}: ${r.pass ? "PASS" : "FAIL"}${r.details ? ` — ${r.details}` : ""}`);
        }

        expect(results.length).toBe(6);
      });

      it.skipIf(skip)("prints summary report", () => {
        const avg = judgeResult.averaged;
        const discoveryRate = avg.constraintDiscovery.total > 0
          ? (avg.constraintDiscovery.discovered / avg.constraintDiscovery.total * 100).toFixed(0)
          : "N/A";

        console.log(`\n=== ${scenario.id} Judge Report ===`);
        console.log(`Constraint discovery: ${avg.constraintDiscovery.discovered}/${avg.constraintDiscovery.total} (${discoveryRate}%)`);
        console.log(`Process compliance: ${avg.processCompliance.score}/100`);
        console.log(`Quality — relevance: ${avg.quality.relevance.score}, completeness: ${avg.quality.completeness.score}, efficiency: ${avg.quality.efficiency.score}`);
        console.log(`Variance: ${judgeResult.highVariance ? `HIGH — ${judgeResult.varianceDetails}` : "within bounds"}`);
        console.log(`Per-constraint:`);
        for (const c of avg.constraintDiscovery.perConstraint) {
          console.log(`  ${c.discovered ? "+" : "-"} ${c.constraint.slice(0, 80)}`);
        }
        console.log(`Findings:`);
        for (const f of avg.processCompliance.findings) {
          const tag = `${f.polarity.toUpperCase()} [${f.severity}]${f.consensus ? ` (${f.consensus}/3)` : ""}`;
          console.log(`  ${tag}: ${f.finding}`);
        };
        console.log(`===\n`);
      });
    });
  }
});
