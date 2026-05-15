/**
 * Progress tracking — step/total/label state on WorkflowContext, a sublabel
 * formatter for human-readable progress prefixes, and a transition-message
 * slot consumed by the next user-facing prompt.
 */

import { WorkflowContext } from "../durable/index.js";

/** Progress state for the current phase. */
export interface ProgressState { step: number; total: number; label: string }

/**
 * Derive a human-readable sublabel from a prompt id.
 * "goal-refinement-question-goal_001-clarify-0" → "refining goal #1"
 * "purpose-confirmation-0" → "confirmation"
 * "scope-constraint-question" → "constraints"
 */
export function formatSublabel(id: string): string {
  const phases = ["opening", "purpose", "goal", "goals", "stakeholder", "stakeholders", "scope", "assumption", "assumptions", "validation"];
  let rest = id;
  for (const p of phases) {
    if (rest.startsWith(p + "-")) { rest = rest.slice(p.length + 1); break; }
  }

  rest = rest.replace(/_0*(\d+)/g, " #$1");
  rest = rest.replace(/-r\d+$/, "").replace(/-\d+$/, "");
  rest = rest.replace(/-?question-?/g, "-").replace(/-?extraction-?/g, "-").replace(/-?composition-?/g, "-");
  rest = rest.replace(/-+/g, " ").trim();
  rest = rest.replace(/\s+\d+$/, "");

  return rest;
}

/** Build a progress prefix string from state and prompt id. */
export function progressPrefix(progress: ProgressState | null, id: string): string {
  if (!progress) return "";
  const { step, total, label } = progress;
  const sub = formatSublabel(id);
  return sub ? `[${step}/${total} ${label} · ${sub}]` : `[${step}/${total} ${label}]`;
}

declare module "../durable/workflow.js" {
  interface WorkflowContext {
    /** Progress state for the current phase. */
    progress: ProgressState | null;
    /** Transition message to prepend to the next user-facing prompt (consumed once). */
    pendingTransition: string | null;
    setProgress(step: number, total: number, label: string): void;
    setTransition(message: string | undefined): void;
  }
}

WorkflowContext.prototype.progress = null;
WorkflowContext.prototype.pendingTransition = null;

WorkflowContext.prototype.setProgress = function (step, total, label) {
  this.progress = { step, total, label };
};

WorkflowContext.prototype.setTransition = function (message) {
  this.pendingTransition = message ?? null;
};

const REQUIRED_PROTOTYPE_METHODS = ["setProgress", "setTransition"] as const;
for (const method of REQUIRED_PROTOTYPE_METHODS) {
  if (typeof (WorkflowContext.prototype as unknown as Record<string, unknown>)[method] !== "function") {
    throw new Error(`interview/progress.ts self-check failed: WorkflowContext.prototype.${method} is not a function.`);
  }
}
