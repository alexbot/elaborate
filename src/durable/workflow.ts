/**
 * Durable workflow framework — memoized coroutine execution with suspend/resume.
 *
 * Workflows call infer (LLM) and prompt (user) through a context object. All calls
 * are logged to an ordered state array; on re-execution, recorded values replay
 * and only new calls hit the resolver. Any call can suspend via Suspend throw,
 * which persists the suspension point and propagates to the caller.
 */

// Errors

/** Thrown by a resolver (or call fn) to signal that a call cannot be fulfilled now. */
export class Suspend {
  constructor(public readonly id: string, public readonly value?: unknown) { }
}

/** Thrown when a replayed call id doesn't match the recorded sequence. */
export class NonDeterminismError extends Error {
  constructor(position: number, expected: string, got: string) {
    super(`Non-determinism at position ${position}: expected "${expected}", got "${got}"`);
  }
}

/** Thrown when the same call id is used more than once in a single execution. */
export class DuplicateCallIdError extends Error {
  constructor(id: string) {
    super(`Duplicate call id: "${id}"`);
  }
}

// State

/** A single entry in the state log — either completed (has value) or suspended. */
export type StateEntry =
  | { id: string; value: unknown }
  | { id: string; suspended: true };

/** Lifecycle status of a workflow execution. */
export type WorkflowStatus = "running" | "suspended" | "completed" | "failed";

/** Serializable snapshot of a workflow's progress — status plus ordered call log. */
export interface WorkflowState {
  status: WorkflowStatus;
  entries: StateEntry[];
}

/** Storage adapter for persisting workflow state between executions. */
export interface StatePersistence {
  load(): WorkflowState | null;
  save(state: WorkflowState): void;
  /** Create initial empty state with "running" status. */
  initialize(): void;
  /** Transition workflow to a new status. */
  setStatus(status: WorkflowStatus): void;
}

// Prompts

/** Payload for an infer call — semantic processing by the resolver (typically LLM). */
export interface InferRequest {
  message: string;
  schema?: Record<string, unknown>;
}

/** Phantom brand — carries result type without runtime presence. */
declare const INFER_STEP_RESULT: unique symbol;

/** Pre-built infer request with embedded id and phantom return type. */
export interface InferStep<T = unknown> extends InferRequest {
  readonly id: string;
  readonly [INFER_STEP_RESULT]?: T;
}

/** Payload for a prompt call — user-facing message with optional suggested answers. */
export interface PromptRequest {
  message: string;
  suggestions?: string[];
}

/** Pre-built prompt request with embedded id — mirrors InferStep for prompt calls. */
export interface PromptStep extends PromptRequest {
  readonly id: string;
}

/** A prompt emitted by the framework — either an infer or prompt request tagged with its call id. */
export type Prompt =
  | { id: string; type: "infer"; request: InferRequest }
  | { id: string; type: "prompt"; request: PromptRequest };

/** Callback that fulfills prompts — the single adapter interface for all non-compute calls. */
export type Resolver = (prompt: Prompt) => Promise<unknown>;

// Fidelity

/** Per-extraction mismatch detail — which keys were expected but missing. */
export interface FidelityDetail {
  id: string;
  expectedKeys: string[];
  actualKeys: string[];
  missingKeys: string[];
  reason?: "non-object" | "missing-keys";
}

/** Accumulated fidelity result across all schema-bearing infer calls. */
export interface FidelityResult {
  checked: number;
  mismatched: number;
  details: FidelityDetail[];
}

/** Result of a workflow execution — extensible container for execution-level concerns. */
export interface ExecutionResult {
  fidelity: FidelityResult;
}

// Context

/**
 * Execution context passed to workflow functions.
 *
 * Provides three call primitives (call, infer, prompt) that memoize results
 * in an ordered state log and replay on re-execution.
 */
export class WorkflowContext {
  private cursor = 0;
  private seen = new Set<string>();
  private state: WorkflowState;
  private fidelity: FidelityResult = { checked: 0, mismatched: 0, details: [] };
  private lastPrompt: string | null = null;

  constructor(
    private persistence: StatePersistence,
    private resolver: Resolver,
  ) {
    const state = persistence.load();
    if (!state) throw new Error("WorkflowContext requires initialized persistence; call persistence.initialize() first");
    this.state = state;
  }

  /**
   * Deterministic compute — runs fn, memoizes, replays from log on re-execution.
   * If fn throws Suspend, a suspended entry is written before propagating.
   */
  async call<T>(id: string, fn: () => T | Promise<T>): Promise<T> {
    // Replay path: entry exists in state log
    if (this.cursor < this.state.entries.length) {
      const entry = this.state.entries[this.cursor];
      if (entry.id !== id) throw new NonDeterminismError(this.cursor, entry.id, id);
      this.seen.add(entry.id);
      this.cursor++;

      // Suspended entry — try to fulfill
      if ("suspended" in entry) {
        try {
          const result = await fn();
          this.state.entries[this.cursor - 1] = { id, value: result };
          this.persistence.save(this.state);
          return result;
        } catch (e) {
          if (e instanceof Suspend) {
            this.state.status = "suspended";
            this.persistence.save(this.state);
            throw e;
          }
          throw e;
        }
      }

      // Completed entry — return cached value
      return entry.value as T;
    }

    // First-hit path: new call not yet in state log
    if (this.seen.has(id)) throw new DuplicateCallIdError(id);
    this.seen.add(id);

    try {
      const result = await fn();
      this.state.entries.push({ id, value: result });
      this.cursor++;
      this.persistence.save(this.state);
      return result;
    } catch (e) {
      if (e instanceof Suspend) {
        this.state.entries.push({ id, suspended: true as const });
        this.state.status = "suspended";
        this.cursor++;
        this.persistence.save(this.state);
        throw e;
      }
      throw e;
    }
  }

  /** ID of the most recent prompt() call, or null before any prompt. */
  get lastPromptId(): string | null { return this.lastPrompt; }

  get currentSource(): { promptId: string } | undefined {
    return this.lastPrompt ? { promptId: this.lastPrompt } : undefined;
  }

  /** Accumulated fidelity result for all schema-bearing infer calls in this execution. */
  fidelityResult(): FidelityResult {
    return this.fidelity;
  }

  /** Non-deterministic semantic processing — delegates to resolver, memoized. */
  async infer<T>(step: InferStep<T>): Promise<T>;
  async infer<T>(id: string, request: InferRequest): Promise<T>;
  async infer<T>(first: string | InferStep<T>, second?: InferRequest): Promise<T> {
    const id = typeof first === "string" ? first : first.id;
    const request: InferRequest = typeof first === "string"
      ? second!
      : { message: first.message, schema: first.schema };
    const prompt: Prompt = { id, type: "infer", request };
    const result = await this.call<T>(id, () => this.resolver(prompt) as Promise<T>);
    if (request.schema && (result == null || typeof result !== "object")) {
      const expectedKeys = Object.keys(request.schema as Record<string, unknown>);
      this.fidelity.checked++;
      this.fidelity.mismatched++;
      this.fidelity.details.push({
        id, expectedKeys, actualKeys: [], missingKeys: expectedKeys, reason: "non-object",
      });
      return {} as T;
    }
    if (request.schema && result != null && typeof result === "object") {
      this.checkFidelity(id, request.schema, result as Record<string, unknown>);
    }
    return result;
  }

  /** Check result keys against schema keys; accumulate fidelity counters. */
  private checkFidelity(id: string, schema: Record<string, unknown>, result: Record<string, unknown>): void {
    const expectedKeys = Object.keys(schema);
    const actualKeys = Object.keys(result);
    const missingKeys = expectedKeys.filter((k) => !(k in result));
    this.fidelity.checked++;
    if (missingKeys.length > 0) {
      this.fidelity.mismatched++;
      this.fidelity.details.push({ id, expectedKeys, actualKeys, missingKeys, reason: "missing-keys" });
    }
  }

  /** Human interaction — delegates to resolver, memoized. May cause suspension. */
  async prompt(step: PromptStep): Promise<string>;
  async prompt(id: string, request: PromptRequest): Promise<string>;
  async prompt(first: string | PromptStep, second?: PromptRequest): Promise<string> {
    const id = typeof first === "string" ? first : first.id;
    const request: PromptRequest = typeof first === "string"
      ? second!
      : { message: first.message, ...(first.suggestions ? { suggestions: first.suggestions } : {}) };
    request.message = normalizeMessage(request.message);
    this.lastPrompt = id;
    const p: Prompt = { id, type: "prompt", request };
    const result = await this.call<string>(id, () => this.resolver(p) as Promise<string>);
    if (typeof result !== "string") return "";
    return result;
  }
}

function normalizeMessage(text: string): string {
  return text
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Workflow

/** A workflow function — receives a context, performs calls, returns when complete. */
export type Workflow = (ctx: WorkflowContext) => Promise<void>;

// Execute

const EMPTY_FIDELITY: FidelityResult = { checked: 0, mismatched: 0, details: [] };

/**
 * Run (or resume) a workflow. Replays memoized calls, then continues execution.
 * Returns execution result on completion. Throws Suspend on suspension (already
 * persisted by the context). Throws other errors on failure.
 *
 * If status is already `completed`, returns `{ fidelity: EMPTY_FIDELITY }`
 * without re-executing. Callers that need to distinguish fresh completion
 * from a no-op should check `persistence.status()` before calling.
 *
 * Suspension is a throw, not a return. A `Suspend` instance carries the id of
 * the suspending call and the pending `Prompt` payload as its `value` field.
 * Callers must handle both paths:
 *
 *     try {
 *       const result = await execute(persistence, workflow, resolver);
 *       // Workflow completed — `result.fidelity` has the extraction stats.
 *     } catch (e) {
 *       if (e instanceof Suspend) {
 *         // Workflow paused on a prompt — `e.value` is the `Prompt` payload,
 *         // `e.id` is the suspended call's id. Persist-and-return so the
 *         // next invocation resumes from this point.
 *       } else {
 *         // Real failure — persistence has already been flagged "failed".
 *         throw e;
 *       }
 *     }
 */
export async function execute(
  persistence: StatePersistence,
  workflow: Workflow,
  resolver: Resolver,
): Promise<ExecutionResult> {
  const state = persistence.load();
  if (!state) {
    persistence.initialize();
  } else if (state.status === "completed") {
    return { fidelity: EMPTY_FIDELITY };
  } else if (state.status !== "running") {
    persistence.setStatus("running");
  }

  const ctx = new WorkflowContext(persistence, resolver);

  try {
    await workflow(ctx);
    persistence.setStatus("completed");
    return { fidelity: ctx.fidelityResult() };
  } catch (e) {
    if (e instanceof Suspend) throw e;
    persistence.setStatus("failed");
    throw e;
  }
}
