/**
 * Interview layer barrel — side-effect imports that register all
 * `WorkflowContext` prototype augmentations, plus public re-exports.
 *
 * Consumers that need a phase to "just work" should import this barrel
 * (e.g., `phases/shared.ts`) so every prototype method is available.
 *
 * The API-structure child will prune this barrel to a deliberate
 * public surface; for now it re-exports what cross-layer callers use today.
 */

import "./deviation.js";
import "./progress.js";
import "./prompt.js";
import "./composition.js";
import "./extraction.js";
import "./classification.js";
import "./macros.js";

export { compositionPreamble, classificationPreamble, extractionPreamble, suggestionCloser, confirmationCloser } from "./preambles.js";
export { formatSublabel, type ProgressState } from "./progress.js";
export { type QuestionContext } from "./prompt.js";
export { type ExtractParams, type SeedParams } from "./extraction.js";
export { type ComposePromptExtractOptions, type PromptExtractOptions, type PromptConfirmOptions } from "./macros.js";
export { type DeviationError, type ResponseClass, classifyResponse, deviationMessage, isDeviationError, Confusion, OffTopic, Pushback, TopicChange, Frustration } from "./deviation.js";
export { zodToPromptSchema, inferStep, inferCompositionStep, ComposeSchema, type ComposeParams } from "./describe.js";
