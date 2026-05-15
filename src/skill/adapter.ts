/**
 * Skill adapter — shell interface to the durable session workflow.
 *
 * Translates shell arguments into durable execute calls and returns JSON to stdout.
 * Bundled alongside SKILL.md into a single deployable artifact.
 *
 * Commands:
 *   start                    Create session or resume, return current prompt
 *   response --message="..."    Answer pending prompt with user message (or pipe text to stdin)
 *   inference --data='{...}'  Answer pending infer with extraction data (or pipe JSON to stdin)
 *   status                   Query session state
 *
 * All output is JSON to stdout. Errors: { error: "..." } + exit code 1.
 */

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Suspend, execute } from "../durable/index.js";
import type { Resolver, Prompt, Workflow, FidelityResult } from "../durable/index.js";
import { createSession, ArtifactAggregate, createFilePersistence, archiveSession, archiveCorrupted, CorruptedSessionError } from "../phases/index.js";
import type { ContextSummary, SessionPersistence } from "../phases/index.js";
import { isDeviationError } from "../interview/index.js";
import { createLogger, noopLogger } from "./log.js";
import type { Logger } from "./log.js";

interface AdapterOutput {
  message: string;
  target: "user" | "agent" | "end";
  schema: Record<string, string>;
  context?: ContextSummary;
  existingSession?: boolean;
}

function getArg(args: string[], prefix: string): string | undefined {
  const match = args.find((a) => a.startsWith(`${prefix}=`));
  if (match) return match.slice(prefix.length + 1);

  const idx = args.indexOf(prefix);
  if (idx !== -1 && idx + 1 < args.length) return args[idx + 1];

  return undefined;
}

let logger: Logger = noopLogger;

function output(data: unknown): void {
  console.log(JSON.stringify(data));
}

function error(message: string): never {
  logger.error({ event: "error" }, message);
  output({ error: message });
  process.exit(1);
}

/** Oneshot resolver: resolves one matching response, suspends everything else. No response = suspend all. */
function createResolver(response?: { id: string; value: unknown }): Resolver {
  return async (prompt) => {
    if (response && prompt.id === response.id) return response.value;
    throw new Suspend(prompt.id, prompt);
  };
}

/** prompt → target: user, infer → target: agent */
function formatPrompt(prompt: Prompt): AdapterOutput {
  if (prompt.type === "prompt") {
    return {
      message: prompt.request.message,
      target: "user",
      schema: {},
    };
  }
  return {
    message: prompt.request.message,
    target: "agent",
    schema: (prompt.request.schema ?? {}) as Record<string, string>,
  };
}

const END_OUTPUT: AdapterOutput = {
  message: "This session is complete.",
  target: "end",
  schema: {},
};

/** Bridge session title from aggregate purpose to persistence. */
function bridgeTitle(agg: ArtifactAggregate, persistence: SessionPersistence): void {
  const purpose = agg.data.purpose?.statement;
  if (purpose) persistence.setTitle(purpose);
}

interface HandleOptions {
  includeContext?: boolean;
  existingSession?: boolean;
}

/** Execute workflow; output END on completion, or the suspended prompt on Suspend. */
async function handle(
  cwd: string,
  persistence: SessionPersistence,
  workflow: Workflow,
  resolver: Resolver,
  agg: ArtifactAggregate,
  opts?: HandleOptions,
): Promise<void> {
  try {
    const result = await execute(persistence, workflow, resolver);
    logFidelity(result.fidelity);
    if (agg.userConcern) persistence.setUserConcern(agg.userConcern);
    bridgeTitle(agg, persistence);
    archiveSession(cwd);
    output(END_OUTPUT);
  } catch (e) {
    if (e instanceof Suspend) {
      if (!e.value || typeof e.value !== "object" || !("type" in e.value)) {
        throw new Error(`Suspend at ${e.id} carried non-Prompt value`);
      }
      const prompt = e.value as Prompt;
      logger.info({
        event: "suspend",
        id: e.id,
        type: prompt.type,
        promptMessage: prompt.request.message,
        ...("schema" in prompt.request ? { schema: prompt.request.schema } : {}),
      });
      bridgeTitle(agg, persistence);
      const out = formatPrompt(prompt);
      if (opts?.includeContext) out.context = agg.summarize();
      if (opts?.existingSession) out.existingSession = true;
      output(out);
      return;
    }
    throw e;
  }
}

/** Log per-extraction debug details and a summary warning when mismatches occurred. */
function logFidelity(result: FidelityResult): void {
  if (result.mismatched === 0) return;
  for (const d of result.details) {
    logger.info({
      event: "fidelity:mismatch",
      id: d.id,
      expectedKeys: d.expectedKeys,
      actualKeys: d.actualKeys,
      missingKeys: d.missingKeys,
    });
  }
  logger.error({
    event: "fidelity:summary",
    checked: result.checked,
    mismatched: result.mismatched,
  }, `Extraction fidelity: ${result.mismatched}/${result.checked} extractions had missing keys`);
}

function requireSuspendedId(persistence: SessionPersistence): string {
  const id = persistence.suspendedId();
  if (!id) error("No pending prompt. Run 'start' first.");
  return id;
}

async function handleStart(cwd: string, persistence: SessionPersistence, args: string[]): Promise<void> {
  const isNew = args.includes("--new");

  let existingSession = false;
  try {
    if (persistence.hasSession()) {
      if (persistence.status() === "completed" || isNew) {
        archiveSession(cwd);
      } else {
        existingSession = true;
      }
    }
  } catch (e) {
    if (e instanceof CorruptedSessionError && isNew) {
      // --new on a corrupt session: archive with timestamp and proceed fresh.
      const archived = archiveCorrupted(cwd);
      logger.info({ event: "recover:archive-corrupted", archived });
    } else {
      throw e;
    }
  }

  const agg = new ArtifactAggregate();
  const workflow = createSession(agg);
  const resolver = createResolver();
  await handle(cwd, persistence, workflow, resolver, agg,
    existingSession ? { includeContext: true, existingSession: true } : undefined);
}

async function handleResponse(cwd: string, persistence: SessionPersistence, args: string[]): Promise<void> {
  let message = getArg(args, "--message");
  if (message === undefined) {
    if (process.stdin.isTTY) {
      error("Missing message. Provide --message argument or pipe text to stdin.");
    }
    message = await readStdin();
    if (!message.trim()) {
      error("No message received on stdin.");
    }
  }
  const id = requireSuspendedId(persistence);
  logger.info({ event: "resolve", id, type: "prompt", message });
  const agg = new ArtifactAggregate();
  const workflow = createSession(agg);
  const resolver = createResolver({ id, value: message });
  await handle(cwd, persistence, workflow, resolver, agg);
}

async function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk: string) => (data += chunk));
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", reject);
  });
}

async function handleInference(cwd: string, persistence: SessionPersistence, args: string[]): Promise<void> {
  let dataStr = getArg(args, "--data");
  if (dataStr === undefined) {
    if (process.stdin.isTTY) {
      error("Missing data. Provide --data argument or pipe JSON to stdin.");
    }
    dataStr = await readStdin();
    if (!dataStr.trim()) {
      error("No data received on stdin.");
    }
  }
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(dataStr);
  } catch {
    error("Invalid JSON in --data argument.");
  }
  const id = requireSuspendedId(persistence);
  logger.info({ event: "resolve", id, type: "infer", data });
  const agg = new ArtifactAggregate();
  const workflow = createSession(agg);
  const resolver = createResolver({ id, value: data });
  await handle(cwd, persistence, workflow, resolver, agg);
}

function handleStatus(persistence: SessionPersistence): void {
  if (!persistence.hasSession()) {
    output({ active: false });
    return;
  }
  const status = persistence.status();
  const title = persistence.title();
  output({
    active: true,
    phase: persistence.phase() ?? "unknown",
    sessionId: persistence.sessionId(),
    ...(title ? { title } : {}),
    ...(status === "failed" ? { status: "failed" } : {}),
  });
}

async function main(): Promise<void> {
  const skillDir = typeof __dirname !== "undefined"
    ? __dirname
    : dirname(fileURLToPath(import.meta.url));
  // Drop a .debug file next to the bundle to attach a debugger on launch
  if (existsSync(join(skillDir, ".debug"))) {
    const inspector = await import("node:inspector");
    inspector.default.open(9229, "127.0.0.1", true);
  }

  const args = process.argv.slice(2);
  const command = args[0];
  const cwd = process.cwd();
  const persistence = createFilePersistence(cwd);

  logger = createLogger(skillDir, cwd, {
    sessionId: () => persistence.sessionId(),
  });

  try {
    switch (command) {
      case "start":
        await handleStart(cwd, persistence, args.slice(1));
        break;
      case "response":
        await handleResponse(cwd, persistence, args.slice(1));
        break;
      case "inference":
        await handleInference(cwd, persistence, args.slice(1));
        break;
      case "status":
        handleStatus(persistence);
        break;
      default:
        error(
          `Unknown command: ${command ?? "(none)"}\n\nUsage:\n  elaborate start [--new]             Create session (--new: archive existing)\n  elaborate response --message="..."  Process stakeholder message\n  elaborate inference --data='{...}'  Provide extraction results\n  elaborate status                    Query session state`
        );
    }
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    logger.error({ event: "error", class: err.constructor.name }, err.message);
    if (err instanceof CorruptedSessionError) {
      error(`${err.message}\n\nRun 'elaborate start --new' to archive the corrupt file and start fresh.`);
    }
    if (isDeviationError(err)) {
      output({ error: "deviation_exhausted", deviation: err.name, response: err.response });
      process.exit(1);
    }
    error(err.message);
  }
}

main();
