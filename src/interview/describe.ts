/**
 * Derives LLM prompt schemas from Zod definitions — single source of truth
 * for both TypeScript types (z.infer) and prompt schema strings.
 *
 * Supported Zod types: string, number, boolean, array, object, optional.
 * Throws on unsupported types to surface gaps early.
 */

import {
  type ZodType,
  ZodString,
  ZodNumber,
  ZodBoolean,
  ZodArray,
  ZodObject,
  ZodOptional,
  ZodNullable,
  ZodEnum,
} from "zod";
import { z } from "zod";
import type { InferStep } from "../durable/index.js";

export const ComposeSchema = z.object({
  question: z.string().describe("the question to ask the stakeholder"),
  suggestions: z.array(z.string()).describe("2-3 suggested answers"),
});

/** InferStep pre-loaded with a fallback question — used by ctx.compose. */
export interface ComposeParams extends InferStep<{ question: string; suggestions: string[] }> {
  readonly fallback: string;
}

/** Serialize a Zod type to compact inline notation (e.g. `{ description: string, relatedGoals?: string[] }[]`). */
function zodTypeToString(schema: ZodType, path = ""): string {
  if (schema instanceof ZodOptional) {
    return zodTypeToString(schema._def.innerType, path);
  }
  if (schema instanceof ZodNullable) {
    return `${zodTypeToString(schema._def.innerType, path)} | null`;
  }
  if (schema instanceof ZodString) return "string";
  if (schema instanceof ZodNumber) return "number";
  if (schema instanceof ZodBoolean) return "boolean";
  if (schema instanceof ZodEnum) {
    return (schema._def.values as string[]).map((v) => `"${v}"`).join(" | ");
  }
  if (schema instanceof ZodArray) {
    return `${zodTypeToString(schema._def.type, `${path}[]`)}[]`;
  }
  if (schema instanceof ZodObject) {
    const shape = schema._def.shape() as Record<string, ZodType>;
    const fields = Object.entries(shape).map(([key, val]) => {
      const opt = val instanceof ZodOptional ? "?" : "";
      const desc = getDescription(val);
      const nested = path ? `${path}.${key}` : key;
      const typeStr = zodTypeToString(val, nested);
      return desc ? `${key}${opt}: ${typeStr} - ${desc}` : `${key}${opt}: ${typeStr}`;
    });
    return `{ ${fields.join(", ")} }`;
  }
  const where = path ? ` at "${path}"` : "";
  throw new Error(`zodTypeToString: unsupported Zod type ${(schema as any)._def?.typeName ?? "unknown"}${where}`);
}

/** Get .describe() text from either the outer wrapper or the inner type. */
function getDescription(schema: ZodType): string {
  if (schema.description) return schema.description;
  if (schema instanceof ZodOptional && schema._def.innerType.description) {
    return schema._def.innerType.description;
  }
  if (schema instanceof ZodNullable && schema._def.innerType.description) {
    return schema._def.innerType.description;
  }
  return "";
}

/** Create an InferStep from a Zod schema — converts schema to prompt format, brands return type. */
export function inferStep<S extends ZodObject<any>>(args: {
  id: string,
  schema: S,
  message: string
}): InferStep<S["_output"]> {
  const { id, message, schema } = args;
  return { id, message, schema: zodToPromptSchema(schema) } as InferStep<S["_output"]>;
}

/** Create an inferCompositionStep — inferStep plus a fallback question for when the LLM response is empty. */
export function inferCompositionStep(args: {
  id: string,
  message: string,
  fallback: string,
}): ComposeParams {
  const { fallback, ...rest } = args;
  return { ...inferStep({ schema: ComposeSchema, ...rest }), fallback } as ComposeParams;
}

export function zodToPromptSchema(schema: ZodObject<any>): Record<string, string> {
  const shape = schema._def.shape() as Record<string, ZodType>;
  const result: Record<string, string> = {};
  for (const [key, field] of Object.entries(shape)) {
    const desc = getDescription(field);
    const typeStr = zodTypeToString(field);
    result[key] = desc ? `${typeStr} - ${desc}` : typeStr;
  }
  return result;
}
