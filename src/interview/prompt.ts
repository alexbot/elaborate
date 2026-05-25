/**
 * Prompt formatters — wrap ctx.prompt() with progress prefix, pending transition,
 * suggestion lists, and contradiction formatting.
 */

import { WorkflowContext } from "../durable/index.js";
import { progressPrefix } from "./progress.js";
import { suggestionCloser } from "./preambles.js";

/** Agent-composed question with optional suggested answers. */
export type QuestionContext = { question: string; suggestions?: string[] };

declare module "../durable/workflow.js" {
  interface WorkflowContext {
    promptStep(step: { id: string; message: string }): Promise<string>;
    promptQuestion(id: string, ask: QuestionContext): Promise<string>;
    promptContradiction(id: string, contradictions: string[]): Promise<string>;
  }
}

/** Prompt with a PromptStep, auto-applying progress prefix and pending transition. */
WorkflowContext.prototype.promptStep = async function (step) {
  let message = step.message;
  if (this.pendingTransition) {
    message = this.pendingTransition + "\n\n" + message;
    this.pendingTransition = null;
  }
  const prefix = progressPrefix(this.progress, step.id);
  return this.prompt({ ...step, message: prefix ? `${prefix}\n\n${message}` : message });
};

/** Format a QuestionContext with lettered suggestions and prompt the respondent. */
WorkflowContext.prototype.promptQuestion = async function (id: string, ask: QuestionContext) {
  let message = ask.question;
  if (ask.suggestions && ask.suggestions.length > 0) {
    const letters = "abcdefghijklmnopqrstuvwxyz";
    message += "\n\nFor example:";
    for (let i = 0; i < ask.suggestions.length; i++) {
      message += `\n\n${letters[i]}) ${ask.suggestions[i]}`;
    }
    if (suggestionCloser()) message += `\n\n${suggestionCloser()}`;
  }
  if (this.pendingTransition) {
    message = this.pendingTransition + "\n\n" + message;
    this.pendingTransition = null;
  }
  const prefix = progressPrefix(this.progress, id);
  return this.prompt({ id, message: prefix ? `${prefix}\n\n${message}` : message, suggestions: ask.suggestions });
};

/** Present detected contradictions to the respondent and ask for clarification. */
WorkflowContext.prototype.promptContradiction = async function (id: string, contradictions: string[]) {
  const parts = ["I noticed something that might be inconsistent with what you said earlier:"];
  for (const c of contradictions) {
    parts.push(`\n- ${c}`);
  }
  parts.push("\n\nCould you help me understand what changed?");
  let message = parts.join("");
  if (this.pendingTransition) {
    message = this.pendingTransition + "\n\n" + message;
    this.pendingTransition = null;
  }
  const prefix = progressPrefix(this.progress, id);
  return this.prompt({ id, message: prefix ? `${prefix}\n\n${message}` : message });
};

const REQUIRED_PROTOTYPE_METHODS = ["promptStep", "promptQuestion", "promptContradiction"] as const;
for (const method of REQUIRED_PROTOTYPE_METHODS) {
  if (typeof (WorkflowContext.prototype as unknown as Record<string, unknown>)[method] !== "function") {
    throw new Error(`interview/prompt.ts self-check failed: WorkflowContext.prototype.${method} is not a function.`);
  }
}
