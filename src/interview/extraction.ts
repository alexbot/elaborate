/**
 * Response extraction — LLM calls that parse the respondent's words into
 * structured data via a Zod schema, with extraction-quality preamble and
 * response classification (deviation detection).
 */

import { z } from "zod";
import { WorkflowContext } from "../durable/index.js";
import { inferStep } from "./describe.js";
import { extractionPreamble } from "./preambles.js";
import type { QuestionContext } from "./prompt.js";
import { classifyResponse, type ResponseClass } from "./deviation.js";

/** Parameters for `ctx.extract` — unified response-parsing template. */
export interface ExtractParams<S extends z.ZodObject<any>> {
  id: string;
  response: string;
  artifactsContext: string;
  schema: S;
  asked?: QuestionContext;
  focus?: string;
  guidance?: string;
}

/** Parameters for `ctx.seed` — unified artifact-mining template. */
export interface SeedParams<S extends z.ZodObject<any>> {
  id: string;
  artifactsContext: string;
  schema: S;
  guidance?: string;
}

declare module "../durable/workflow.js" {
  interface WorkflowContext {
    extract<S extends z.ZodObject<any>>(params: ExtractParams<S>): Promise<z.infer<S>>;
    seed<S extends z.ZodObject<any>>(params: SeedParams<S>): Promise<z.infer<S>>;
    reextract<S extends z.ZodObject<any>>(id: string, clarification: string, artifactsContext: string, schema: S): Promise<z.infer<S>>;
  }
}

/** Schema field added to every extraction to classify the stakeholder's response. */
const ResponseClassField = z.enum([
  "answer", "confusion", "off_topic", "pushback", "topic_change", "frustration",
]).describe("Classify the respondent's response: answer (addressed the question, even partially — includes disagreeing with content, pointing out conflicts, suggesting corrections, or challenging captured artifacts), confusion (asked what you mean or expressed confusion), off_topic (unrelated information), pushback (rejected the interview process itself — e.g. 'why are you asking me this' or 'this is pointless'), topic_change (steered to different subject), frustration (expressed fatigue/impatience). If in doubt, classify as answer.");

type HasWaitingRoom = { waitingRoomItems?: Array<{ content: string }> };

/** Common response + artifact context block for extraction prompts */
function extractionBody(response: string, artifactsContext: string, asked?: QuestionContext): string[] {
  const parts: string[] = [];
  if (asked?.question) {
    parts.push(`Question asked: "${asked.question}"`);
    if (asked.suggestions && asked.suggestions.length > 0) {
      const letters = "abcdefghijklmnopqrstuvwxyz";
      const formatted = asked.suggestions.map((s, i) => `${letters[i]}) ${s}`).join(", ");
      parts.push(`Suggestions offered: ${formatted}`);
    }
  }
  parts.push(`Their response: "${response}"`);
  parts.push("");
  parts.push(`Existing artifacts: ${artifactsContext}`);
  return parts;
}

/** Extract structured data from a user response. Schema drives what to extract. */
WorkflowContext.prototype.extract = async function (params) {
  const message = buildExtractionMessage(params);
  const augmented = params.schema.extend({ responseClass: ResponseClassField });
  const result = await this.infer(inferStep({ id: params.id, message, schema: augmented }));
  return extractOrThrowOnDeviation(result, params.response);
};

/** Assemble the extraction prompt: preamble + classification block + focus + body + guidance. */
function buildExtractionMessage<S extends z.ZodObject<any>>(params: ExtractParams<S>): string {
  const { response, artifactsContext, asked, focus, guidance } = params;
  const parts: string[] = [];
  const extPre = extractionPreamble();
  if (extPre) parts.push(extPre);
  parts.push(`<response_classification>
Before extracting, classify the respondent's response:
- "answer": They addressed the question (even partially or tangentially). This includes disagreeing with captured content, pointing out conflicts between items, suggesting corrections or restructuring, or challenging the substance of what was discussed. Content-level engagement is always an answer.
- "confusion": They asked what you mean, requested rephrasing, or expressed confusion about the question
- "off_topic": They provided unrelated information or introduced a new idea
- "pushback": They rejected the interview process itself — e.g. "why are you asking me this?", "this is pointless", "I don't see the point of this exercise". Challenging content or disagreeing with artifacts is NOT pushback — that is an answer.
- "topic_change": They tried to steer the conversation to a different subject
- "frustration": They expressed fatigue, impatience, or annoyance
Set responseClass accordingly. If in doubt, classify as "answer".
When responseClass is NOT "answer", deposit the respondent's actual content into waitingRoomItems (if the schema has that field) so it is preserved for later phases.
</response_classification>`);
  if (focus) parts.push(`Focus: ${focus}`);
  parts.push(...extractionBody(response, artifactsContext, asked));
  if (guidance) parts.push(guidance);
  return parts.join("\n");
}

/** Strip responseClass; if non-answer, throw the matching deviation error. */
function extractOrThrowOnDeviation<T extends { responseClass?: unknown; waitingRoomItems?: Array<{ content: string }> }>(
  result: T,
  response: string,
): Omit<T, "responseClass"> {
  const { responseClass = "answer", ...extraction } = result;
  const error = classifyResponse(responseClass as ResponseClass, response, (extraction as Partial<HasWaitingRoom>).waitingRoomItems);
  if (error) throw error;
  return extraction;
}

/**
 * Mine artifacts for initial items. Schema drives what to extract.
 *
 * Callers opting to include waiting-room items for drain/seeding pass
 * `buildFullContext(artifacts, { includeWaitingRoom: true })` so the items
 * surface under the `waitingRoom` JSON field within `artifactsContext`.
 */
WorkflowContext.prototype.seed = async function (params) {
  const { id, artifactsContext, schema, guidance } = params;
  const parts: string[] = [];
  if (guidance) parts.push(guidance);
  parts.push(`\nConversation context:\n${artifactsContext}`);
  return this.infer(inferStep({ id, message: parts.join("\n"), schema }));
};

/** Re-extract artifacts after a contradiction clarification, using the same schema as the original extraction. */
WorkflowContext.prototype.reextract = async function (id, clarification, artifactsContext, schema) {
  return this.extract({
    id,
    response: clarification,
    artifactsContext,
    schema,
    guidance: "The respondent clarified a contradiction. Re-extract incorporating the clarification.",
  });
};

const REQUIRED_PROTOTYPE_METHODS = ["extract", "seed", "reextract"] as const;
for (const method of REQUIRED_PROTOTYPE_METHODS) {
  if (typeof (WorkflowContext.prototype as unknown as Record<string, unknown>)[method] !== "function") {
    throw new Error(`interview/extraction.ts self-check failed: WorkflowContext.prototype.${method} is not a function.`);
  }
}
