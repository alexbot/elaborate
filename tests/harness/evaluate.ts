/**
 * Orchestration — full evaluation pipeline.
 *
 * runScenario → extract artifacts → validators → judge → persist results.
 * Also: baseline computation and regression detection per capability tag.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { parse as parseYaml } from "yaml";
import type { Scenario, CapabilityTag } from "./schema.js";
import type { RunResult, EvaluationResult, ValidatorResult, JudgeResult } from "./types.js";
import type { T3Driver } from "./driver.js";
import type { RunConfig } from "./runner.js";
import { runScenario } from "./runner.js";
import { evaluateSession } from "./judge.js";
import { ALL_VALIDATORS } from "../validators/index.js";
import type { StateEntry } from "../validators/types.js";
import { execute } from "../../src/durable/workflow.js";
import type { WorkflowState, StatePersistence, WorkflowStatus } from "../../src/durable/workflow.js";
import { Suspend } from "../../src/durable/workflow.js";
import { createSession, ArtifactAggregate } from "../../src/phases/index.js";
import { isDeviationError } from "../../src/interview/index.js";
import type { Artifacts } from "../../src/phases/schema.js";

function findSessionFile(sessionDir: string): string | null {
  const stateDir = path.join(sessionDir, ".elaborate");
  if (!fs.existsSync(stateDir)) return null;

  const sessionPath = path.join(stateDir, "session.yaml");
  if (fs.existsSync(sessionPath)) return sessionPath;

  const archived = fs.readdirSync(stateDir)
    .filter((f) => f.endsWith(".yaml") && !f.includes("corrupt"))
    .sort((a, b) => fs.statSync(path.join(stateDir, b)).mtimeMs - fs.statSync(path.join(stateDir, a)).mtimeMs);

  return archived.length > 0 ? path.join(stateDir, archived[0]) : null;
}

function loadState(sessionDir: string): WorkflowState {
  const filePath = findSessionFile(sessionDir);
  if (!filePath) throw new Error(`No session state found in ${sessionDir}`);
  const data = parseYaml(fs.readFileSync(filePath, "utf-8"));
  if (!data?.workflow?.entries) throw new Error(`Invalid session file: ${filePath}`);
  return data.workflow;
}

function createReplayPersistence(state: WorkflowState): StatePersistence {
  const replayState: WorkflowState = { ...state, status: "running" };
  return {
    load: () => replayState,
    save: () => {},
    initialize: () => {},
    setStatus: (_s: WorkflowStatus) => {},
  };
}

export async function extractSessionData(sessionDir: string): Promise<{
  entries: StateEntry[];
  artifacts: Artifacts;
}> {
  const state = loadState(sessionDir);
  const entries = state.entries as StateEntry[];

  const agg = new ArtifactAggregate();
  const persistence = createReplayPersistence(state);
  const neverCalled = async () => {
    throw new Error("Resolver should not be called during replay");
  };

  try {
    await execute(persistence, createSession(agg), neverCalled);
  } catch (e) {
    if (e instanceof Suspend) {
      // Incomplete session — aggregate has partial data up to suspension point
    } else if (e instanceof Error && isDeviationError(e)) {
      // Deviation exhaustion — aggregate has partial data up to exhaustion point
    } else {
      throw e;
    }
  }

  return { entries, artifacts: agg.data };
}

export interface EvaluateConfig {
  scenario: Scenario;
  generationDriver: T3Driver;
  stakeholderDriver: T3Driver;
  judgeDriver: T3Driver;
  runConfig?: Partial<RunConfig>;
  judgeRuns?: number;
  skipJudge?: boolean;
}

export async function evaluateScenario(config: EvaluateConfig): Promise<EvaluationResult> {
  const {
    scenario,
    generationDriver,
    stakeholderDriver,
    judgeDriver,
    runConfig,
    judgeRuns,
    skipJudge,
  } = config;

  const run: RunResult = await runScenario({
    scenario,
    generationDriver,
    stakeholderDriver,
    ...runConfig,
  });

  let validators: ValidatorResult[] = [];
  let judge: JudgeResult | undefined;

  try {
    const { entries, artifacts } = await extractSessionData(run.sessionDir);

    validators = ALL_VALIDATORS.map((v) => v({ entries, artifacts }));

    const shouldJudge = !skipJudge && (run.status === "completed" || run.status === "truncated");
    if (shouldJudge) {
      try {
        judge = await evaluateSession({
          driver: judgeDriver,
          scenario,
          transcript: run.transcript,
          artifacts,
          questionCount: run.questionCount,
          turnCount: run.turnCount,
          runs: judgeRuns,
        });
      } catch {
        judge = undefined;
      }
    }
  } catch {
    // Session data extraction failed — validators/judge skipped
  }

  return {
    scenarioId: scenario.id,
    run,
    validators,
    judge,
    timestamp: new Date().toISOString(),
  };
}

export function persistResult(result: EvaluationResult, outputDir: string): string {
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `${result.scenarioId}_${ts}.json`;
  const filePath = path.join(outputDir, filename);
  fs.writeFileSync(filePath, JSON.stringify(result, null, 2));
  return filePath;
}

export function loadResults(outputDir: string): EvaluationResult[] {
  if (!fs.existsSync(outputDir)) return [];
  return fs.readdirSync(outputDir)
    .filter((f) => f.endsWith(".json") && f !== "baselines.json")
    .map((f) => JSON.parse(fs.readFileSync(path.join(outputDir, f), "utf-8")) as EvaluationResult);
}

export interface CapabilityBaseline {
  tag: string;
  constraintDiscoveryMean: number;
  constraintDiscoverySigma: number;
  processComplianceMean: number;
  processComplianceSigma: number;
  qualityMean: number;
  qualitySigma: number;
  sampleCount: number;
}

export interface Baselines {
  version: string;
  computed: string;
  capabilities: CapabilityBaseline[];
}

function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function sigma(values: number[]): number {
  const m = mean(values);
  const variance = values.reduce((sum, v) => sum + (v - m) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

export function computeBaselines(
  results: EvaluationResult[],
  scenarios: Scenario[],
): Baselines {
  const scenarioMap = new Map(scenarios.map((s) => [s.id, s]));
  const byCapability = new Map<string, EvaluationResult[]>();

  for (const result of results) {
    if (!result.judge) continue;
    const scenario = scenarioMap.get(result.scenarioId);
    if (!scenario) continue;
    for (const tag of scenario.capability_tags) {
      const existing = byCapability.get(tag) ?? [];
      existing.push(result);
      byCapability.set(tag, existing);
    }
  }

  const capabilities: CapabilityBaseline[] = [];
  for (const [tag, tagged] of byCapability) {
    const judged = tagged.filter((r) => r.judge);
    if (judged.length < 3) continue;

    const discoveryRates = judged.map((r) => {
      const j = r.judge!.averaged;
      return j.constraintDiscovery.total > 0
        ? j.constraintDiscovery.discovered / j.constraintDiscovery.total
        : 0;
    });

    const processScores = judged.map((r) => r.judge!.averaged.processCompliance.score);
    const qualityScores = judged.map((r) => {
      const q = r.judge!.averaged.quality;
      return (q.relevance.score + q.completeness.score + q.efficiency.score) / 3;
    });

    capabilities.push({
      tag,
      constraintDiscoveryMean: mean(discoveryRates),
      constraintDiscoverySigma: sigma(discoveryRates),
      processComplianceMean: mean(processScores),
      processComplianceSigma: sigma(processScores),
      qualityMean: mean(qualityScores),
      qualitySigma: sigma(qualityScores),
      sampleCount: judged.length,
    });
  }

  return {
    version: "1",
    computed: new Date().toISOString(),
    capabilities,
  };
}

export function saveBaselines(baselines: Baselines, outputDir: string): string {
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
  const filePath = path.join(outputDir, "baselines.json");
  fs.writeFileSync(filePath, JSON.stringify(baselines, null, 2));
  return filePath;
}

export function loadBaselines(outputDir: string): Baselines | null {
  const filePath = path.join(outputDir, "baselines.json");
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf-8")) as Baselines;
}

export interface RegressionFlag {
  tag: string;
  dimension: string;
  current: number;
  baselineMean: number;
  baselineSigma: number;
  threshold: number;
}

export function detectRegressions(
  result: EvaluationResult,
  baselines: Baselines,
  scenario: Scenario,
): RegressionFlag[] {
  if (!result.judge) return [];

  const flags: RegressionFlag[] = [];
  const judge = result.judge.averaged;

  for (const tag of scenario.capability_tags) {
    const baseline = baselines.capabilities.find((b) => b.tag === tag);
    if (!baseline) continue;

    const discoveryRate = judge.constraintDiscovery.total > 0
      ? judge.constraintDiscovery.discovered / judge.constraintDiscovery.total
      : 0;

    const checks: Array<{ dimension: string; current: number; mean: number; sigma: number }> = [
      { dimension: "constraintDiscovery", current: discoveryRate, mean: baseline.constraintDiscoveryMean, sigma: baseline.constraintDiscoverySigma },
      { dimension: "processCompliance", current: judge.processCompliance.score, mean: baseline.processComplianceMean, sigma: baseline.processComplianceSigma },
      { dimension: "quality", current: (judge.quality.relevance.score + judge.quality.completeness.score + judge.quality.efficiency.score) / 3, mean: baseline.qualityMean, sigma: baseline.qualitySigma },
    ];

    for (const check of checks) {
      const threshold = check.mean - 2 * check.sigma;
      if (check.current < threshold) {
        flags.push({
          tag,
          dimension: check.dimension,
          current: check.current,
          baselineMean: check.mean,
          baselineSigma: check.sigma,
          threshold,
        });
      }
    }
  }

  return flags;
}

export function filterScenariosByCapability(
  scenarios: Scenario[],
  capability: CapabilityTag,
): Scenario[] {
  return scenarios.filter((s) => s.capability_tags.includes(capability));
}
