/**
 * Scenario runner — drives an Elaborate session through the adapter API.
 *
 * The runner accepts a SessionDriver that resolves adapter outputs.
 * Level 2 (default): mechanical routing based on adapter target type.
 * Level 3 (future): an orchestrator LLM interpreting SKILL.md.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { Scenario } from "./schema.js";
import type { SessionDriver, RunResult, ResultStatus, Message } from "./types.js";
import type { T3Driver } from "./driver.js";
import type { AdapterOutput } from "./adapter.js";
import { adapterStart, adapterResponse, adapterInference } from "./adapter.js";
import { createStakeholder } from "./stakeholder.js";
import type { StakeholderAgent } from "./stakeholder.js";

export interface RunConfig {
  scenario: Scenario;
  generationDriver: T3Driver;
  stakeholderDriver: T3Driver;
  driver?: SessionDriver;
  maxTurns?: number;
  costBudgetCents?: number;
  logFile?: string;
  models?: import("./types.js").ModelLabels;
  onMessage?: (msg: { role: string; content: string; turn: number }) => void;
}

const DEFAULT_MAX_TURNS = 200;
const LOOP_DETECTION_THRESHOLD = 3;
const LOG_DIR = path.join(process.cwd(), "tests", "results");

interface RunLogger {
  log(entry: Record<string, unknown>): void;
  flush(): void;
  readonly filePath: string;
}

function createRunLogger(scenarioId: string, logFile?: string): RunLogger {
  const target = logFile ?? path.join(LOG_DIR, `${scenarioId}_${new Date().toISOString().replace(/[:.]/g, "-")}.log.jsonl`);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const lines: string[] = [];

  return {
    filePath: target,
    log(entry: Record<string, unknown>) {
      const line = JSON.stringify({ ts: new Date().toISOString(), ...entry });
      lines.push(line);
      fs.appendFileSync(target, line + "\n");
    },
    flush() {
      // already written per-line
    },
  };
}

/** Level 2 adapter driver: mechanical routing by target type. */
function createAdapterDriver(
  generationDriver: T3Driver,
  stakeholder: StakeholderAgent,
): SessionDriver {
  return {
    async resolveInfer(output: AdapterOutput, _history: Message[]): Promise<Record<string, unknown>> {
      const schemaDesc = Object.entries(output.schema)
        .map(([k, v]) => `${k}: ${v}`)
        .join("\n");

      const prompt = `${output.message}\n\nRespond with a JSON object matching this schema:\n${schemaDesc}`;
      const response = await generationDriver.chat("You are a precise extraction assistant. Return valid JSON only.", [
        { role: "user", content: prompt },
      ], { temperature: 0.3 });

      try {
        return JSON.parse(response);
      } catch {
        const jsonMatch = response.match(/\{[\s\S]*\}/);
        if (jsonMatch) return JSON.parse(jsonMatch[0]);
        throw new Error(`Failed to parse generation model response as JSON: ${response.slice(0, 200)}`);
      }
    },

    async resolvePrompt(output: AdapterOutput, _history: Message[]): Promise<string> {
      return stakeholder.respond(output.message, _history.length);
    },
  };
}

export async function runScenario(config: RunConfig): Promise<RunResult> {
  const {
    scenario,
    generationDriver,
    stakeholderDriver,
    maxTurns = DEFAULT_MAX_TURNS,
    onMessage,
  } = config;

  const sessionDir = fs.mkdtempSync(path.join(os.tmpdir(), `elaborate-eval-${scenario.id}-`));
  const stakeholder = createStakeholder(stakeholderDriver, scenario);
  const driver = config.driver ?? createAdapterDriver(generationDriver, stakeholder);
  const transcript: Message[] = [];
  const recentPrompts: string[] = [];
  const log = createRunLogger(scenario.id, config.logFile);

  let turnCount = 0;
  let questionCount = 0;
  let status: ResultStatus = "completed";
  let error: string | undefined;
  const startTime = Date.now();

  log.log({ event: "start", scenarioId: scenario.id, sessionDir, maxTurns, models: config.models });

  let currentPhase = "";
  function parsePhase(message: string): string {
    const match = message.match(/^\[(\d+\/\d+)\s+([^\]·]+)/);
    return match ? match[2].trim() : currentPhase;
  }

  try {
    let output = await withRetry(() => adapterStart(sessionDir), 3, log);
    if (output.target === "user") questionCount++;
    currentPhase = parsePhase(output.message);
    log.log({ event: "elaborate", turn: 0, question: questionCount, phase: currentPhase, target: output.target, messageLen: output.message.length, message: output.message });
    onMessage?.({ role: "elaborate", content: output.message, turn: 0 });

    while (output.target !== "end") {
      turnCount++;

      if (turnCount > maxTurns) {
        log.log({ event: "truncated", turn: turnCount });
        status = "truncated";
        break;
      }

      if (detectLoop(output.message, recentPrompts)) {
        status = "loop_detected";
        error = `Same prompt repeated ${LOOP_DETECTION_THRESHOLD}+ times: ${output.message.slice(0, 100)}`;
        log.log({ event: "loop_detected", turn: turnCount, error });
        break;
      }
      recentPrompts.push(output.message);
      if (recentPrompts.length > LOOP_DETECTION_THRESHOLD + 2) recentPrompts.shift();

      if (output.target !== "agent") {
        transcript.push({ role: "assistant", content: output.message });
      }

      if (output.target === "agent") {
        const t0 = Date.now();
        log.log({ event: "infer_start", turn: turnCount, promptLen: output.message.length, schemaKeys: Object.keys(output.schema) });
        const data = await withRetry(() => driver.resolveInfer(output, transcript), 3, log);
        const inferMs = Date.now() - t0;
        log.log({ event: "infer_done", turn: turnCount, ms: inferMs, keys: Object.keys(data) });
        onMessage?.({ role: "agent-infer", content: `[${inferMs}ms] ${JSON.stringify(data).slice(0, 180)}`, turn: turnCount });

        output = await withRetry(() => adapterInference(sessionDir, data), 3, log);
        if (output.target === "user") questionCount++;
        currentPhase = parsePhase(output.message);
        log.log({ event: "elaborate", turn: turnCount, question: questionCount, phase: currentPhase, target: output.target, messageLen: output.message.length, message: output.message });
      } else if (output.target === "user") {
        const t0 = Date.now();
        const historyLen = stakeholder.history.length;
        log.log({ event: "stakeholder_start", turn: turnCount, promptLen: output.message.length, historyLen });
        const response = await withRetry(() => driver.resolvePrompt(output, transcript), 3, log);
        const shMs = Date.now() - t0;
        log.log({ event: "stakeholder_done", turn: turnCount, ms: shMs, responseLen: response.length, response });
        onMessage?.({ role: "stakeholder", content: `[${shMs}ms] ${response.slice(0, 180)}`, turn: turnCount });
        transcript.push({ role: "user", content: response });

        output = await withRetry(() => adapterResponse(sessionDir, response), 3, log);
        if (output.target === "user") questionCount++;
        currentPhase = parsePhase(output.message);
        log.log({ event: "elaborate", turn: turnCount, question: questionCount, phase: currentPhase, target: output.target, messageLen: output.message.length, message: output.message });
      } else {
        error = `Unexpected target: ${output.target}`;
        status = "error";
        log.log({ event: "error", turn: turnCount, error });
        break;
      }

      onMessage?.({ role: "elaborate", content: output.message, turn: turnCount });
    }

    if (status === "completed" && output.message.startsWith("[deviation_exhausted]")) {
      status = "deviation_exhausted";
      error = output.message;
      log.log({ event: "deviation_exhausted", turn: turnCount, error });
    }
  } catch (e) {
    status = "error";
    error = e instanceof Error ? e.message : String(e);
    log.log({ event: "fatal", turn: turnCount, error, stack: e instanceof Error ? e.stack : undefined });
  }

  const durationMs = Date.now() - startTime;
  log.log({ event: "end", status, turnCount, questionCount, durationMs, error });

  const result: RunResult = {
    scenarioId: scenario.id,
    status,
    turnCount,
    questionCount,
    transcript,
    error,
    durationMs,
    sessionDir,
    models: config.models,
  };

  const runFilePath = log.filePath.replace(".log.jsonl", ".run.json");
  fs.writeFileSync(runFilePath, JSON.stringify(result, null, 2));

  // Copy session YAML alongside the run file. archiveSession() renames
  // session.yaml on completion, so fall back to the first .yaml in .elaborate/.
  const elaborateDir = path.join(sessionDir, ".elaborate");
  let sessionSrc: string | undefined;
  const directPath = path.join(elaborateDir, "session.yaml");
  if (fs.existsSync(directPath)) {
    sessionSrc = directPath;
  } else if (fs.existsSync(elaborateDir)) {
    const yamlFile = fs.readdirSync(elaborateDir).find((f) => f.endsWith(".yaml"));
    if (yamlFile) sessionSrc = path.join(elaborateDir, yamlFile);
  }
  if (sessionSrc) {
    const sessionDest = log.filePath.replace(".log.jsonl", ".session.yaml");
    fs.copyFileSync(sessionSrc, sessionDest);
    log.log({ event: "session_saved", path: sessionDest });
  }

  return result;
}

function detectLoop(message: string, recent: string[]): boolean {
  const normalized = message.trim().toLowerCase();
  let matches = 0;
  for (const prev of recent) {
    if (prev.trim().toLowerCase() === normalized) matches++;
  }
  return matches >= LOOP_DETECTION_THRESHOLD;
}

async function withRetry<T>(fn: () => Promise<T>, maxRetries = 3, log?: RunLogger): Promise<T> {
  let lastError: Error | undefined;
  for (let i = 0; i <= maxRetries; i++) {
    try {
      return await fn();
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
      log?.log({ event: "retry", attempt: i + 1, maxRetries, error: lastError.message });
      if (i < maxRetries) {
        const delay = Math.pow(2, i) * 1000;
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  throw lastError;
}
