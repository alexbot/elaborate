/**
 * Durable workflow framework — public barrel.
 *
 * Memoized coroutine execution with suspend/resume. See workflow.ts for the
 * full implementation; this file is the public surface for cross-layer and
 * external consumers.
 */

export {
  Suspend,
  NonDeterminismError,
  DuplicateCallIdError,
  WorkflowContext,
  execute,
} from "./workflow.js";

export type {
  StateEntry,
  WorkflowStatus,
  WorkflowState,
  StatePersistence,
  InferRequest,
  InferStep,
  PromptRequest,
  PromptStep,
  Prompt,
  Resolver,
  Workflow,
  FidelityDetail,
  FidelityResult,
  ExecutionResult,
} from "./workflow.js";
