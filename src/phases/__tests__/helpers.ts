/**
 * Shared test infrastructure for session tests.
 *
 * Re-exports framework symbols so test files only import from vitest + this module.
 */

import {
  type StatePersistence,
  type WorkflowState,
  type Resolver,
  type Prompt,
  Suspend,
  execute,
} from "../../durable/workflow.js";
import type { Workflow } from "../../durable/workflow.js";
import { session } from "../index.js";

export { type StatePersistence, type WorkflowState, type Resolver, type Prompt, Suspend, execute, session };

export function memoryPersistence(): StatePersistence & { current(): WorkflowState | null } {
  let data: WorkflowState | null = null;
  const save = (d: WorkflowState) => { data = JSON.parse(JSON.stringify(d)); };
  return {
    load: () => (data ? JSON.parse(JSON.stringify(data)) : null),
    save,
    initialize: () => save({ status: "running", entries: [] }),
    setStatus: (s) => { if (data) { data.status = s; save(data); } },
    current: () => data,
  };
}

/**
 * createAdapter: infer resolves from llm map, prompt resolves from env map or suspends.
 * This mirrors how the real adapter works: LLM calls resolve inline,
 * user interaction resolves only when env provides a response for that prompt.id.
 */
export function createAdapter(llm: Record<string, unknown>, env?: Record<string, unknown>): Resolver {
  return async (prompt) => {
    if (prompt.type === "infer") return llm[prompt.id] ?? {};
    if (env && prompt.id in env) return env[prompt.id];
    throw new Suspend(prompt.id, prompt);
  };
}

/** Execute, silently absorb Suspend. Returns true if completed, false if suspended. */
export async function step(
  persistence: StatePersistence,
  workflow: Workflow,
  resolver: Resolver,
): Promise<boolean> {
  try {
    await execute(persistence, workflow, resolver);
    return true;
  } catch (e) {
    if (e instanceof Suspend) return false;
    throw e;
  }
}

/** Execute, expect Suspend, return the Prompt. Throws if workflow completes. */
export async function suspended(
  persistence: StatePersistence,
  workflow: Workflow,
  resolver: Resolver,
): Promise<Prompt> {
  try {
    await execute(persistence, workflow, resolver);
    throw new Error("Expected suspension but workflow completed");
  } catch (e) {
    if (e instanceof Suspend) return e.value as Prompt;
    throw e;
  }
}

/** Drive the workflow through multiple rounds with sequential prompt responses */
export async function driveToCompletion(
  llm: Record<string, unknown>,
  promptResponses: [string, string][],
) {
  const persistence = memoryPersistence();
  let completed = await step(persistence, session, createAdapter(llm));

  for (const [id, value] of promptResponses) {
    if (completed) break;
    completed = await step(persistence, session, createAdapter(llm, { [id]: value }));
  }

  return { completed, persistence };
}
