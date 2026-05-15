/**
 * Question composition — LLM call that produces an interview question with
 * optional suggested answers, preceded by the composition quality preamble.
 */

import { WorkflowContext } from "../durable/index.js";
import type { ComposeParams } from "./describe.js";
import { compositionPreamble } from "./preambles.js";
import type { QuestionContext } from "./prompt.js";

declare module "../durable/workflow.js" {
  interface WorkflowContext {
    compose(step: ComposeParams): Promise<QuestionContext>;
  }
}

/** Compose a question with suggestions; falls back to step.fallback if agent returns empty. */
WorkflowContext.prototype.compose = async function (step: ComposeParams) {
  const compPre = compositionPreamble();
  const enrichedStep = compPre
    ? { ...step, message: compPre + "\n\n" + step.message }
    : step;
  const { question, suggestions } = await this.infer(enrichedStep);
  return question ? { question, suggestions } : { question: step.fallback };
};

if (typeof (WorkflowContext.prototype as unknown as Record<string, unknown>).compose !== "function") {
  throw new Error("interview/composition.ts self-check failed: WorkflowContext.prototype.compose is not a function.");
}
