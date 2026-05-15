/**
 * Review classification — LLM call that classifies the respondent's reaction
 * to a presented item list (confirmed / removed / new items). Schema shape is
 * phase-specific and passed by the caller.
 *
 * The base confirmation schema (`ConfirmClassifySchema` with `targetId`) and
 * `ctx.confirm` live in `phases/shared.ts` because the classification takes
 * the RE `Phase` and `Artifacts` types.
 */

import { z } from "zod";
import { WorkflowContext } from "../durable/index.js";

declare module "../durable/workflow.js" {
  interface WorkflowContext {
    review<S extends z.ZodObject<any>>(id: string, response: string, itemRef: string, artifactsContext: string, schema: S, ri?: number): Promise<z.infer<S>>;
  }
}

/** Classify the respondent's reaction to a presented item list (confirmed/removed/new items). */
WorkflowContext.prototype.review = async function (id, response, itemRef, artifactsContext, schema, ri?) {
  const fullId = ri !== undefined ? `${id}-r${ri}` : id;
  return this.extract({
    id: fullId,
    response,
    artifactsContext,
    schema,
    guidance: `The respondent reacted to the presented list.\n${itemRef ? `Item IDs: ${itemRef}` : "No items existed yet."}`,
  });
};

if (typeof (WorkflowContext.prototype as unknown as Record<string, unknown>).review !== "function") {
  throw new Error("interview/classification.ts self-check failed: WorkflowContext.prototype.review is not a function.");
}
