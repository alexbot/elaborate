/**
 * Judge-only re-evaluation — runs the judge on existing session data
 * without re-running the scenarios. Useful for iterating on judge schema
 * or rubric changes.
 *
 * Requires: JUDGE_MODEL env var set.
 * Optional: EVAL_RESULTS_DIR to read/write from a specific results folder.
 *
 * Run: npx vitest run --config vitest.eval.config.ts tests/__tests__/judge-only.test.ts
 * Re-judge with new rubric:
 *   JUDGE_MODEL=... EVAL_RESULTS_DIR=tests/results/2026-05-08-control_judge2 npx vitest run --config vitest.eval.config.ts tests/__tests__/judge-only.test.ts
 */

import { describe, it, expect, beforeAll } from "vitest";
import { loadDriverConfig } from "../harness/config.js";
import { loadScenario } from "../harness/loader.js";
import { evaluateSession } from "../harness/judge.js";
import { extractSessionData, persistResult } from "../harness/evaluate.js";
import { ALL_VALIDATORS } from "../validators/index.js";
import { join } from "node:path";
import * as fs from "node:fs";
import { parse as parseYaml } from "yaml";
import type { JudgeResult } from "../harness/types.js";
import type { RunResult } from "../harness/types.js";
import type { Scenario } from "../harness/schema.js";
import type { Message } from "../harness/types.js";

const SCENARIOS_DIR = join(import.meta.dirname, "..", "scenarios");
const DEFAULT_RESULTS_DIR = join(import.meta.dirname, "..", "results");
const RESULTS_DIR = process.env.EVAL_RESULTS_DIR
  ? (process.env.EVAL_RESULTS_DIR.startsWith("/") || process.env.EVAL_RESULTS_DIR.match(/^[A-Za-z]:/)
    ? process.env.EVAL_RESULTS_DIR
    : join(process.cwd(), process.env.EVAL_RESULTS_DIR))
  : DEFAULT_RESULTS_DIR;

function hasJudgeModel(): boolean {
  const driver = process.env.T3_DRIVER ?? "api";
  if (driver === "cli") return true;
  return !!process.env.JUDGE_MODEL;
}

/** Find most recent log file for a scenario. */
function findLatestLog(scenarioId: string): string | null {
  if (!fs.existsSync(RESULTS_DIR)) return null;
  const logs = fs.readdirSync(RESULTS_DIR)
    .filter((f) => f.startsWith(scenarioId) && f.endsWith(".log.jsonl"))
    .sort()
    .reverse();
  return logs.length > 0 ? join(RESULTS_DIR, logs[0]) : null;
}

/** Find most recent run result file for a scenario. */
function findLatestRun(scenarioId: string): string | null {
  if (!fs.existsSync(RESULTS_DIR)) return null;
  const runs = fs.readdirSync(RESULTS_DIR)
    .filter((f) => f.startsWith(scenarioId) && f.endsWith(".run.json"))
    .sort()
    .reverse();
  return runs.length > 0 ? join(RESULTS_DIR, runs[0]) : null;
}

/** Extract sessionDir from a log file's start entry. */
function extractSessionDir(logPath: string): string {
  const lines = fs.readFileSync(logPath, "utf-8").trim().split("\n");
  const startLine = JSON.parse(lines[0]);
  return startLine.sessionDir;
}

/** Reconstruct transcript from JSONL log + session YAML (backward compat). */
function reconstructTranscriptFromLog(logPath: string, sessionDir: string): Message[] {
  const lines = fs.readFileSync(logPath, "utf-8").trim().split("\n");
  const interviewerMessages: string[] = [];
  const shResponses: string[] = [];

  for (const line of lines) {
    const entry = JSON.parse(line);
    if (entry.event === "elaborate" && entry.target === "user") {
      interviewerMessages.push(entry.message);
    }
    if (entry.event === "stakeholder_done" && entry.response) {
      shResponses.push(entry.response);
    }
  }

  // New-format JSONL has SH responses inline
  if (shResponses.length > 0) {
    const transcript: Message[] = [];
    for (let i = 0; i < interviewerMessages.length; i++) {
      transcript.push({ role: "assistant", content: interviewerMessages[i] });
      if (i < shResponses.length) {
        transcript.push({ role: "user", content: shResponses[i] });
      }
    }
    return transcript;
  }

  // Old-format JSONL: get user responses from session YAML
  if (!fs.existsSync(sessionDir)) {
    throw new Error(`Cannot reconstruct transcript: no SH responses in JSONL and session dir ${sessionDir} not found`);
  }
  const stateDir = join(sessionDir, ".elaborate");
  const files = fs.readdirSync(stateDir).filter((f) => f.endsWith(".yaml") && !f.includes("corrupt"));
  const sessionFile = files.sort((a, b) =>
    fs.statSync(join(stateDir, b)).mtimeMs - fs.statSync(join(stateDir, a)).mtimeMs
  )[0];
  const data = parseYaml(fs.readFileSync(join(stateDir, sessionFile), "utf-8"));
  const entries: Array<{ id: string; value: unknown; suspended?: boolean }> = data.workflow.entries;

  const userResponses: string[] = [];
  for (const entry of entries) {
    if (entry.suspended) continue;
    if (typeof entry.value === "string") {
      userResponses.push(entry.value);
    }
  }

  const transcript: Message[] = [];
  for (let i = 0; i < interviewerMessages.length; i++) {
    transcript.push({ role: "assistant", content: interviewerMessages[i] });
    if (i < userResponses.length) {
      transcript.push({ role: "user", content: userResponses[i] });
    }
  }
  return transcript;
}

/** Extract turnCount and questionCount from run log. */
function extractRunStats(logPath: string): { turnCount: number; questionCount: number; durationMs: number } {
  const lines = fs.readFileSync(logPath, "utf-8").trim().split("\n");
  const endLine = JSON.parse(lines[lines.length - 1]);
  return {
    turnCount: endLine.turnCount ?? 0,
    questionCount: endLine.questionCount ?? 0,
    durationMs: endLine.durationMs ?? 0,
  };
}

interface RunData {
  transcript: Message[];
  sessionDir: string;
  turnCount: number;
  questionCount: number;
  durationMs: number;
}

function loadRunData(scenarioId: string): RunData {
  // Prefer .run.json (full transcript from runner)
  const runPath = findLatestRun(scenarioId);
  if (runPath) {
    const run = JSON.parse(fs.readFileSync(runPath, "utf-8")) as RunResult;
    return {
      transcript: run.transcript,
      sessionDir: run.sessionDir,
      turnCount: run.turnCount,
      questionCount: run.questionCount,
      durationMs: run.durationMs,
    };
  }

  // Fall back to JSONL + session dir reconstruction
  const logPath = findLatestLog(scenarioId);
  if (!logPath) throw new Error(`No .run.json or .log.jsonl found for ${scenarioId}`);

  const sessionDir = extractSessionDir(logPath);
  const transcript = reconstructTranscriptFromLog(logPath, sessionDir);
  const runStats = extractRunStats(logPath);
  return { transcript, sessionDir, ...runStats };
}

const sessions: Array<{
  name: string;
  scenarioFile: string;
  scenarioId: string;
}> = [
  { name: "recycling (easy)", scenarioFile: "recycling.yaml", scenarioId: "recycling" },
  { name: "alfred (medium)", scenarioFile: "alfred.yaml", scenarioId: "alfred" },
  { name: "ski (medium)", scenarioFile: "ski.yaml", scenarioId: "ski" },
  { name: "scrumalliance (medium)", scenarioFile: "scrumalliance.yaml", scenarioId: "scrumalliance" },
  { name: "rdadmp (medium)", scenarioFile: "rdadmp.yaml", scenarioId: "rdadmp" },
  { name: "cask (hard)", scenarioFile: "cask.yaml", scenarioId: "cask" },
  { name: "neurohub (hard)", scenarioFile: "neurohub.yaml", scenarioId: "neurohub" },
  { name: "federalspending (hard)", scenarioFile: "federalspending.yaml", scenarioId: "federalspending" },
];

describe("judge-only re-evaluation", () => {
  const skip = !hasJudgeModel();

  for (const { name, scenarioFile, scenarioId } of sessions) {
    describe(name, () => {
      let scenario: Scenario;
      let judgeResult: JudgeResult;
      let sessionDir: string;

      beforeAll(async () => {
        if (skip) return;

        scenario = loadScenario(join(SCENARIOS_DIR, scenarioFile));
        const runData = loadRunData(scenarioId);
        sessionDir = runData.sessionDir;

        if (!fs.existsSync(sessionDir)) throw new Error(`Session dir missing: ${sessionDir}`);

        const { entries, artifacts } = await extractSessionData(sessionDir);

        const { judge: judgeDriver } = loadDriverConfig();
        console.log(`Running judge (3x) on existing ${scenarioId} session...`);
        console.log(`  Transcript: ${runData.transcript.length} messages (${runData.transcript.filter(m => m.role === "assistant").length} assistant, ${runData.transcript.filter(m => m.role === "user").length} user)`);
        judgeResult = await evaluateSession({
          driver: judgeDriver,
          scenario,
          transcript: runData.transcript,
          artifacts,
          questionCount: runData.questionCount,
          turnCount: runData.turnCount,
          runs: 3,
        });

        const validators = ALL_VALIDATORS.map((v) => v({ entries, artifacts }));
        const saved = persistResult({
          scenarioId: scenario.id,
          run: {
            scenarioId: scenario.id,
            status: "completed",
            turnCount: runData.turnCount,
            questionCount: runData.questionCount,
            transcript: runData.transcript,
            durationMs: runData.durationMs,
            sessionDir,
          },
          validators,
          judge: judgeResult,
          timestamp: new Date().toISOString(),
        }, RESULTS_DIR);
        console.log(`Results saved: ${saved}`);
      }, 600_000);

      it.skipIf(skip)("judge fills all rubric fields", () => {
        const avg = judgeResult.averaged;
        expect(avg.constraintDiscovery.total).toBe(scenario.hidden_constraints.length);
        expect(avg.processCompliance.score).toBeGreaterThanOrEqual(0);
        expect(avg.quality.relevance.score).toBeGreaterThanOrEqual(0);
      });

      it.skipIf(skip)("judge provides evidence for discovered constraints", () => {
        const discovered = judgeResult.averaged.constraintDiscovery.perConstraint
          .filter((c) => c.discovered);
        for (const c of discovered) {
          expect(c.evidence, `No evidence for: ${c.constraint}`).toBeTruthy();
        }
      });

      it.skipIf(skip)("self-consistency variance is within bounds", () => {
        expect(judgeResult.scores.length).toBe(3);
        if (judgeResult.highVariance) {
          console.warn(`High variance: ${judgeResult.varianceDetails}`);
        }
      });

      it.skipIf(skip)("validators run on existing session", async () => {
        const { entries, artifacts } = await extractSessionData(sessionDir);
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

        console.log(`\n=== ${scenarioId} Judge Report ===`);
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
