/**
 * Deviation resilience — classification errors and retry primitive.
 *
 * When ctx.extract detects that the stakeholder didn't answer the question
 * (clarification request, off-topic, pushback), it throws a typed error.
 * The retry primitive catches these and gives the callback a chance to re-ask.
 *
 * One error class per deviation type:
 * - Confusion → user is confused, rephrase the question
 * - OffTopic → unrelated information or new idea
 * - Pushback → questioned the process or method
 * - TopicChange → tried to steer to a different subject
 * - Frustration → expressed fatigue or impatience
 */

import { WorkflowContext } from "../durable/index.js";

// ── Response classification ──

/** Detailed classification of the stakeholder's response. */
export type ResponseClass =
  | "answer"           // On-topic, partial, or tangential — extract normally
  | "confusion"        // Asked for rephrase or expressed confusion
  | "off_topic"        // Unrelated information or new idea
  | "pushback"         // Questioned the process or method
  | "topic_change"     // Tried to steer to a different subject
  | "frustration";     // Expressed fatigue or impatience

// ── Error classes ──

/** Thrown when the stakeholder expresses confusion or asks for clarification. */
export class Confusion extends Error {
  readonly response: string;
  constructor(response: string) {
    super(response);
    this.name = "Confusion";
    this.response = response;
  }
}

/** Thrown when the stakeholder provides unrelated information or a new idea. */
export class OffTopic extends Error {
  readonly response: string;
  readonly parkedItems: Array<{ content: string }>;
  constructor(response: string, parkedItems?: Array<{ content: string }>) {
    super(response);
    this.name = "OffTopic";
    this.response = response;
    this.parkedItems = parkedItems ?? [];
  }
}

/** Thrown when the stakeholder questions the process or method. */
export class Pushback extends Error {
  readonly response: string;
  readonly parkedItems: Array<{ content: string }>;
  constructor(response: string, parkedItems?: Array<{ content: string }>) {
    super(response);
    this.name = "Pushback";
    this.response = response;
    this.parkedItems = parkedItems ?? [];
  }
}

/** Thrown when the stakeholder tries to steer to a different subject. */
export class TopicChange extends Error {
  readonly response: string;
  readonly parkedItems: Array<{ content: string }>;
  constructor(response: string, parkedItems?: Array<{ content: string }>) {
    super(response);
    this.name = "TopicChange";
    this.response = response;
    this.parkedItems = parkedItems ?? [];
  }
}

/** Thrown when the stakeholder expresses fatigue or impatience. */
export class Frustration extends Error {
  readonly response: string;
  readonly parkedItems: Array<{ content: string }>;
  constructor(response: string, parkedItems?: Array<{ content: string }>) {
    super(response);
    this.name = "Frustration";
    this.response = response;
    this.parkedItems = parkedItems ?? [];
  }
}

/** Union of all deviation error types. */
export type DeviationError = Confusion | OffTopic | Pushback | TopicChange | Frustration;

/** All deviation error constructors. */
const DEVIATION_CLASSES = [Confusion, OffTopic, Pushback, TopicChange, Frustration] as const;

/** Check if a value is a deviation error. */
export function isDeviationError(e: unknown): e is DeviationError {
  return DEVIATION_CLASSES.some((cls) => e instanceof cls);
}

// ── Classification → Error mapping ──

/** Map a ResponseClass to its error, or null for 'answer'. */
export function classifyResponse(
  responseClass: ResponseClass,
  response: string,
  parkedItems?: Array<{ content: string }>,
): DeviationError | null {
  switch (responseClass) {
    case "answer": return null;
    case "confusion": return new Confusion(response);
    case "off_topic": return new OffTopic(response, parkedItems);
    case "pushback": return new Pushback(response, parkedItems);
    case "topic_change": return new TopicChange(response, parkedItems);
    case "frustration": return new Frustration(response, parkedItems);
    default: return null;
  }
}

// ── Deviation messages ──

/** Human-readable acknowledgment text for the stakeholder after a deviation. */
export function deviationMessage(error: DeviationError): string {
  if (error instanceof Confusion) {
    return "Let me put that differently.";
  }
  if (error instanceof Frustration) {
    return "I understand — we're almost through this part. Let me keep it focused.";
  }
  if (error instanceof Pushback) {
    return "Fair question. This helps us make sure nothing important is missed. Let me continue.";
  }
  return "Thanks for that — I've noted it. Let me come back to what I was asking.";
}

// ── Retry primitive ──

/** Constructor type for any deviation error class. */
type DeviationErrorClass = (typeof DEVIATION_CLASSES)[number];

/** Options for ctx.retryOnDeviation(). */
export interface RetryOptions<T> {
  /** Maximum number of retries after the initial attempt. Default: 2. */
  maxRetries?: number;
  /** Value returned when all retries are exhausted. If absent, the last error is re-thrown. */
  defaults?: T;
  /** Error types to retry on. Default: all deviation errors. */
  retryOn?: DeviationErrorClass[];
}

declare module "../durable/workflow.js" {
  interface WorkflowContext {
    retryOnDeviation<T>(
      callback: (index: number, error?: DeviationError) => Promise<T>,
      options?: RetryOptions<T>,
    ): Promise<T>;
  }
}

/**
 * Retry on deviation errors.
 *
 * Calls the callback. If it throws a deviation error (filtered by retryOn),
 * retries with (index+1, error). The callback uses the error to adjust
 * its prompt (rephrase for clarification, redirect for divergence).
 *
 * Durable-safe: each callback invocation uses index to derive unique
 * prompt/infer IDs. Memoized values replay correctly on resume.
 */
WorkflowContext.prototype.retryOnDeviation = async function <T>(
  callback: (index: number, error?: DeviationError) => Promise<T>,
  options?: RetryOptions<T>,
): Promise<T> {
  const maxRetries = options?.maxRetries ?? 2;
  const retryOn = options?.retryOn;
  let lastError: DeviationError | undefined;

  for (let index = 0; index <= maxRetries; index++) {
    try {
      return await callback(index, lastError);
    } catch (e) {
      if (isDeviationError(e)) {
        if (retryOn && !retryOn.some((cls) => e instanceof cls)) {
          throw e;
        }
        lastError = e;
        continue;
      }
      throw e;
    }
  }

  if (options && "defaults" in options) {
    return options.defaults as T;
  }
  throw lastError!;
};
