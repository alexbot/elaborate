/**
 * Interview macros — compose-prompt-extract orchestration with deviation resilience.
 *
 * Each macro wraps a common interview cycle around `retryOnDeviation`:
 * - `composePromptExtract` — full compose → prompt → extract with rephrase on clarification.
 * - `promptExtract` — prompt → extract.
 * - `promptConfirm` — prompt → classifier thunk. Public-facing wrapper lives here;
 *   the RE-coupled bits are wrapped by `confirmPhase` in phases/shared.ts.
 * - `promptReview` — prompt → review classification.
 * - `promptReextract` — contradiction prompt → reextraction.
 *
 * `promptExtractWithRetry` is the file-private shared backing function for
 * the prompt-then-extract family (promptExtract, promptConfirm, promptReview).
 *
 * ## Call-site convention: prompt-via-factory, infer-inline
 *
 * Phase code uses two visually different patterns at these macros' call sites,
 * by deliberate convention — don't unify them:
 *
 * - **Prompt macros** (`promptExtract`, `promptConfirm`, `promptReview`) take
 *   their `prompt` argument from a named factory call:
 *   `confirmation(artifacts, round)`, `summary(agg)`, `greeting()`,
 *   `seedPresent(items)`, `nudge()`, `respondentPresent(...)`, etc.
 *
 * - **Compose/extract macros** (and direct `ctx.extract` / `ctx.seed` calls)
 *   take their extraction params as an inline object literal:
 *   `{ artifactsContext, schema, guidance? }`.
 *
 * Rationale: prompt args carry multi-line user-facing English (greetings,
 * summaries, confirmation statements). Factoring into a named helper gives
 * the wording a discoverable, testable home and keeps phase control flow
 * uncluttered. Infer args carry mechanical plumbing — no user-facing wording;
 * the wording lives in Zod `.describe()` annotations and the extraction
 * preamble, both centralized. A factory for infer args would rename "object
 * literal" with no readability or DRY win.
 *
 * Rejected alternatives: **unify on functions** — forces `extract(() => ({...}))`
 * everywhere, pure noise; **unify on data** — inlines prompt-wording factories
 * into phase files, losing the discoverable-wording property.
 */

import { z } from "zod";
import { WorkflowContext } from "../durable/index.js";
import type { ComposeParams } from "./describe.js";
import { Confusion, type DeviationError, deviationMessage } from "./deviation.js";
import type { ExtractParams } from "./extraction.js";

/** Options for ctx.composePromptExtract(). */
export interface ComposePromptExtractOptions<S extends z.ZodObject<any>> {
  /** Called with items to park when divergence carries content. */
  park?: (items: Array<{ content: string }>) => void;
  /** Maximum deviation retries. Default: 2. */
  maxRetries?: number;
  /** Returned when all retries are exhausted. If absent, last error re-throws. */
  defaults?: z.infer<S>;
}

/** Options for prompt-extract macros (promptExtract, promptReview). */
export interface PromptExtractOptions<S extends z.ZodObject<any>> {
  park?: (items: Array<{ content: string }>) => void;
  maxRetries?: number;
  defaults?: z.infer<S>;
}

/** Options for promptConfirm and promptReextract. */
export interface PromptConfirmOptions {
  park?: (items: Array<{ content: string }>) => void;
  maxRetries?: number;
  defaults?: Record<string, unknown>;
}

declare module "../durable/workflow.js" {
  interface WorkflowContext {
    composePromptExtract<S extends z.ZodObject<any>>(
      baseId: string,
      compose: () => ComposeParams,
      extractionParams: Omit<ExtractParams<S>, 'id' | 'response' | 'asked'>,
      options?: ComposePromptExtractOptions<S>,
    ): Promise<z.infer<S>>;
    promptExtract<S extends z.ZodObject<any>>(
      prompt: { id: string; message: string },
      extractionParams: Omit<ExtractParams<S>, 'id' | 'response'>,
      options?: PromptExtractOptions<S>,
    ): Promise<z.infer<S>>;
    promptConfirm<T>(
      prompt: { id: string; message: string },
      classifier: (response: string, ri: number) => Promise<T>,
      options?: PromptConfirmOptions,
    ): Promise<T & { response: string }>;
    promptReview<S extends z.ZodObject<any>>(
      prompt: { id: string; message: string },
      reviewId: string,
      itemRef: string,
      artifactsContext: string,
      schema: S,
      options?: PromptExtractOptions<S>,
    ): Promise<z.infer<S>>;
    promptReextract<S extends z.ZodObject<any>>(
      contradictionId: string,
      contradictions: string[],
      artifactsContext: string,
      schema: S,
      options?: PromptConfirmOptions,
    ): Promise<z.infer<S>>;
  }
}

/** Rephrase hint prepended to composition message on clarification retry. */
function rephraseHint(): string {
  return "The respondent asked for clarification. Rephrase the question using simpler language, a concrete example, or a different angle.\n\n";
}

/**
 * Compose → prompt → extract with deviation resilience.
 */
WorkflowContext.prototype.composePromptExtract = async function (baseId, compose, extractionParams, options) {
  return this.retryOnDeviation(
    async (ri: number, error?: DeviationError) => {
      if (error && !(error instanceof Confusion) && "parkedItems" in error && error.parkedItems.length > 0) {
        options?.park?.(error.parkedItems);
      }

      const step = compose();
      const message = error instanceof Confusion
        ? rephraseHint() + step.message
        : step.message;
      const ask = await this.compose({ ...step, message, id: `${baseId}-composition-r${ri}` });

      const question = error && !(error instanceof Confusion)
        ? deviationMessage(error) + "\n\n" + ask.question
        : ask.question;

      const response = await this.promptQuestion(
        `${baseId}-question-r${ri}`,
        { ...ask, question },
      );

      return this.extract({
        ...extractionParams,
        id: `${baseId}-extraction-r${ri}`,
        response,
        asked: ask,
      });
    },
    {
      maxRetries: options?.maxRetries ?? 2,
      ...(options && "defaults" in options ? { defaults: options.defaults } : {}),
    },
  );
};

/**
 * Generic prompt → extract with deviation resilience.
 *
 * Shared backing function for promptExtract, promptConfirm, and promptReview.
 * File-private — prevents the classifier callback shape leaking to callers.
 */
async function promptExtractWithRetry<T>(
  ctx: WorkflowContext,
  prompt: { id: string; message: string },
  extract: (response: string, ri: number) => Promise<T>,
  options?: { park?: (items: Array<{ content: string }>) => void; maxRetries?: number; defaults?: T },
): Promise<T> {
  return ctx.retryOnDeviation(async (ri: number, error?: DeviationError) => {
    if (error && !(error instanceof Confusion) && "parkedItems" in error && error.parkedItems.length > 0) {
      options?.park?.(error.parkedItems);
    }
    const message = error ? deviationMessage(error) + "\n\n" + prompt.message : prompt.message;
    const response = await ctx.promptStep({ ...prompt, id: `${prompt.id}-r${ri}`, message });
    return extract(response, ri);
  }, {
    maxRetries: options?.maxRetries ?? 1,
    ...(options?.defaults !== undefined ? { defaults: options.defaults } : {}),
  });
}

// F005 drift guards: satisfies-checked aliases for the prototype impls.
type PromptExtractImpl = (
  this: WorkflowContext,
  prompt: { id: string; message: string },
  extractionParams: Omit<ExtractParams<any>, 'id' | 'response'>,
  options?: PromptExtractOptions<any>,
) => Promise<any>;

type PromptConfirmImpl = (
  this: WorkflowContext,
  prompt: { id: string; message: string },
  classifier: (response: string, ri: number) => Promise<any>,
  options?: PromptConfirmOptions,
) => Promise<any>;

type PromptReviewImpl = (
  this: WorkflowContext,
  prompt: { id: string; message: string },
  reviewId: string,
  itemRef: string,
  artifactsContext: string,
  schema: z.ZodObject<any>,
  options?: PromptExtractOptions<any>,
) => Promise<any>;

type PromptReextractImpl = (
  this: WorkflowContext,
  contradictionId: string,
  contradictions: string[],
  artifactsContext: string,
  schema: z.ZodObject<any>,
  options?: PromptConfirmOptions,
) => Promise<any>;

/** Prompt → extract with deviation resilience. */
WorkflowContext.prototype.promptExtract = (async function (
  this: WorkflowContext,
  prompt: { id: string; message: string },
  extractionParams: Omit<ExtractParams<any>, 'id' | 'response'>,
  options?: PromptExtractOptions<any>,
) {
  return promptExtractWithRetry(this, prompt, (response, ri) =>
    this.extract({ ...extractionParams, id: `${prompt.id}-extraction-r${ri}`, response }),
    options,
  );
} satisfies PromptExtractImpl) as any;

/**
 * Prompt → classify with deviation resilience. The classifier thunk receives
 * the raw response + retry index and returns the classification payload.
 * Result is the classifier's return merged with `{ response }`.
 *
 * RE-agnostic: keeps the `Artifacts`/`Phase` coupling on the caller's side.
 * Phase code typically goes through the `confirmPhase` helper in `phases/shared.ts`.
 */
WorkflowContext.prototype.promptConfirm = (async function (
  this: WorkflowContext,
  prompt: { id: string; message: string },
  classifier: (response: string, ri: number) => Promise<any>,
  options?: PromptConfirmOptions,
) {
  const wrappedOptions = options?.defaults
    ? { ...options, defaults: { ...options.defaults, response: "" } }
    : options;
  return promptExtractWithRetry(this, prompt, async (response, ri) => {
    const result = await classifier(response, ri);
    return { ...result, response };
  }, wrappedOptions);
} satisfies PromptConfirmImpl) as any;

/** Prompt → review classification with deviation resilience. */
WorkflowContext.prototype.promptReview = (async function (
  this: WorkflowContext,
  prompt: { id: string; message: string },
  reviewId: string,
  itemRef: string,
  artifactsContext: string,
  schema: z.ZodObject<any>,
  options?: PromptExtractOptions<any>,
) {
  return promptExtractWithRetry(this, prompt, (response, ri) =>
    this.review(reviewId, response, itemRef, artifactsContext, schema, ri),
    options,
  );
} satisfies PromptReviewImpl) as any;

/** Contradiction prompt → reextraction with deviation resilience. */
WorkflowContext.prototype.promptReextract = (async function (
  this: WorkflowContext,
  contradictionId: string,
  contradictions: string[],
  artifactsContext: string,
  schema: z.ZodObject<any>,
  options?: PromptConfirmOptions,
) {
  return this.retryOnDeviation(async (ri: number, error?: DeviationError) => {
    if (error && !(error instanceof Confusion) && "parkedItems" in error && error.parkedItems.length > 0) {
      options?.park?.(error.parkedItems);
    }
    const clarification = await this.promptContradiction(`${contradictionId}-r${ri}`, contradictions);
    return this.reextract(`${contradictionId}-reextraction-r${ri}`, clarification, artifactsContext, schema);
  }, {
    maxRetries: options?.maxRetries ?? 1,
    ...(options?.defaults !== undefined ? { defaults: options.defaults } : {}),
  });
} satisfies PromptReextractImpl) as any;

const REQUIRED_PROTOTYPE_METHODS = ["composePromptExtract", "promptExtract", "promptConfirm", "promptReview", "promptReextract"] as const;
for (const method of REQUIRED_PROTOTYPE_METHODS) {
  if (typeof (WorkflowContext.prototype as unknown as Record<string, unknown>)[method] !== "function") {
    throw new Error(`interview/macros.ts self-check failed: WorkflowContext.prototype.${method} is not a function.`);
  }
}
