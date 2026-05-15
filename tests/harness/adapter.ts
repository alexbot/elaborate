/**
 * Programmatic adapter functions for driving Elaborate sessions.
 *
 * Mirrors the adapter's CLI flow (start/response/inference) without
 * the CLI argument parsing or process.exit calls. Each function creates
 * fresh persistence for the same directory, matching the real adapter's
 * cross-process boundary.
 *
 * Extracted from src/skill/__tests__/adapter.test.ts to share between
 * adapter tests and the T3 evaluation runner.
 */

import { Suspend, execute } from "../../src/durable/workflow.js";
import type { Resolver, Prompt, Workflow } from "../../src/durable/workflow.js";
import { createSession, ArtifactAggregate } from "../../src/phases/index.js";
import { isDeviationError } from "../../src/interview/index.js";
import type { ContextSummary } from "../../src/phases/index.js";
import { createFilePersistence, archiveSession } from "../../src/phases/session/index.js";

export interface AdapterOutput {
  message: string;
  target: "user" | "agent" | "end";
  schema: Record<string, string>;
  context?: ContextSummary;
  existingSession?: boolean;
}

const END_OUTPUT: AdapterOutput = {
  message: "This session is complete.",
  target: "end",
  schema: {},
};

function createResolver(response?: { id: string; value: unknown }): Resolver {
  return async (prompt) => {
    if (response && prompt.id === response.id) return response.value;
    throw new Suspend(prompt.id, prompt);
  };
}

function formatPrompt(prompt: Prompt): AdapterOutput {
  if (prompt.type === "prompt") {
    return { message: prompt.request.message, target: "user", schema: {} };
  }
  return {
    message: prompt.request.message,
    target: "agent",
    schema: (prompt.request.schema ?? {}) as Record<string, string>,
  };
}

function bridgeOnComplete(
  agg: ArtifactAggregate,
  persistence: ReturnType<typeof createFilePersistence>,
  dir: string,
): void {
  if (agg.userConcern) persistence.setUserConcern(agg.userConcern);
  const purpose = agg.data.purpose?.statement;
  if (purpose) persistence.setTitle(purpose);
  archiveSession(dir);
}

function bridgeOnSuspend(
  agg: ArtifactAggregate,
  persistence: ReturnType<typeof createFilePersistence>,
): void {
  const purpose = agg.data.purpose?.statement;
  if (purpose) persistence.setTitle(purpose);
}

async function run(
  dir: string,
  response?: { id: string; value: unknown },
  opts?: { includeContext?: boolean; existingSession?: boolean },
): Promise<AdapterOutput> {
  const persistence = createFilePersistence(dir);
  const agg = new ArtifactAggregate();
  try {
    await execute(persistence, createSession(agg), createResolver(response));
    bridgeOnComplete(agg, persistence, dir);
    return END_OUTPUT;
  } catch (e) {
    if (e instanceof Suspend) {
      bridgeOnSuspend(agg, persistence);
      const out = formatPrompt(e.value as Prompt);
      if (opts?.includeContext) out.context = agg.summarize();
      if (opts?.existingSession) out.existingSession = true;
      return out;
    }
    if (e instanceof Error && isDeviationError(e)) {
      return {
        message: `[deviation_exhausted] ${e.name}: ${(e as any).response ?? ""}`,
        target: "end",
        schema: {},
      };
    }
    throw e;
  }
}

export async function adapterStart(dir: string): Promise<AdapterOutput> {
  const persistence = createFilePersistence(dir);
  if (persistence.hasSession()) {
    const status = persistence.status();
    if (status === "completed") {
      archiveSession(dir);
    } else {
      return run(dir, undefined, { includeContext: true, existingSession: true });
    }
  }
  return run(dir);
}

export async function adapterResponse(dir: string, message: string): Promise<AdapterOutput> {
  const persistence = createFilePersistence(dir);
  const id = persistence.suspendedId();
  if (!id) throw new Error("No pending prompt. Run adapterStart first.");
  return run(dir, { id, value: message });
}

export async function adapterInference(dir: string, data: Record<string, unknown>): Promise<AdapterOutput> {
  const persistence = createFilePersistence(dir);
  const id = persistence.suspendedId();
  if (!id) throw new Error("No pending prompt. Run adapterStart first.");
  return run(dir, { id, value: data });
}

export function adapterStatus(dir: string): {
  active: boolean;
  phase?: string;
  sessionId?: string;
  title?: string;
  status?: string;
} {
  const persistence = createFilePersistence(dir);
  if (!persistence.hasSession()) return { active: false };
  const status = persistence.status();
  const title = persistence.title();
  return {
    active: true,
    phase: persistence.phase() ?? "unknown",
    sessionId: persistence.sessionId() ?? undefined,
    ...(title ? { title } : {}),
    ...(status === "failed" ? { status: "failed" } : {}),
  };
}

/** Load final session state for post-session validation. */
export function loadSessionState(dir: string): {
  persistence: ReturnType<typeof createFilePersistence>;
  aggregate: ArtifactAggregate;
} {
  const persistence = createFilePersistence(dir);
  const aggregate = new ArtifactAggregate();
  return { persistence, aggregate };
}
