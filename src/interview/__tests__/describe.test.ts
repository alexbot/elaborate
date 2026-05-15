import { describe, it, expect } from "vitest";
import { z } from "zod";
import { zodToPromptSchema, inferStep } from "../describe.js";
import { WorkflowContext } from "../../durable/workflow.js";
import { type StatePersistence, type WorkflowState, type Prompt } from "../../durable/workflow.js";

describe("zodToPromptSchema", () => {
  it("serializes SeedExtraction shape to match hand-written SEED_SCHEMA", () => {
    const SeedExtractionSchema = z.object({
      inScope: z.array(z.object({
        description: z.string(),
        relatedGoals: z.array(z.string()).optional(),
      })).optional().describe("items clearly in scope from the conversation, empty if none"),
      outOfScope: z.array(z.object({
        description: z.string(),
        reason: z.string().optional(),
        relatedGoals: z.array(z.string()).optional(),
      })).optional().describe("items clearly excluded, empty if none"),
      ambiguous: z.array(z.object({
        description: z.string(),
        relatedGoals: z.array(z.string()).optional(),
      })).optional().describe("items mentioned but unclear if in or out, empty if none"),
      drainedWaitingRoomIds: z.array(z.string()).optional()
        .describe('IDs of waiting room items classified into scope (e.g. ["waiting_001"]), empty if none'),
    });

    const result = zodToPromptSchema(SeedExtractionSchema);

    expect(result).toEqual({
      inScope: "{ description: string, relatedGoals?: string[] }[] - items clearly in scope from the conversation, empty if none",
      outOfScope: "{ description: string, reason?: string, relatedGoals?: string[] }[] - items clearly excluded, empty if none",
      ambiguous: "{ description: string, relatedGoals?: string[] }[] - items mentioned but unclear if in or out, empty if none",
      drainedWaitingRoomIds: 'string[] - IDs of waiting room items classified into scope (e.g. ["waiting_001"]), empty if none',
    });
  });

  it("handles flat scalar fields", () => {
    const schema = z.object({
      name: z.string().describe("the name"),
      count: z.number().describe("how many"),
      active: z.boolean().describe("whether enabled"),
    });
    expect(zodToPromptSchema(schema)).toEqual({
      name: "string - the name",
      count: "number - how many",
      active: "boolean - whether enabled",
    });
  });

  it("omits description separator when no describe()", () => {
    const schema = z.object({
      id: z.string(),
    });
    expect(zodToPromptSchema(schema)).toEqual({ id: "string" });
  });

  it("finds description on inner type when describe() before optional()", () => {
    const schema = z.object({
      items: z.array(z.string()).describe("the items").optional(),
    });
    expect(zodToPromptSchema(schema)).toEqual({
      items: "string[] - the items",
    });
  });

  it("handles nullable fields", () => {
    const schema = z.object({
      name: z.string().nullable().describe("name or null"),
    });
    expect(zodToPromptSchema(schema)).toEqual({
      name: "string | null - name or null",
    });
  });

  it("handles nullable + optional (describe on inner)", () => {
    const schema = z.object({
      value: z.string().describe("the value").nullable().optional(),
    });
    expect(zodToPromptSchema(schema)).toEqual({
      value: "string | null - the value",
    });
  });

  it("handles enum fields", () => {
    const schema = z.object({
      verdict: z.enum(["validated", "flagged", "unsure"]).describe("the verdict"),
    });
    expect(zodToPromptSchema(schema)).toEqual({
      verdict: '"validated" | "flagged" | "unsure" - the verdict',
    });
  });

  it("includes descriptions in nested object fields", () => {
    const schema = z.object({
      items: z.array(z.object({
        statement: z.string().describe("the assumption text"),
        type: z.enum(["hypothesis", "invariant"]).optional().describe("hypothesis or invariant"),
      })).optional().describe("assumptions extracted"),
    });
    expect(zodToPromptSchema(schema)).toEqual({
      items: '{ statement: string - the assumption text, type?: "hypothesis" | "invariant" - hypothesis or invariant }[] - assumptions extracted',
    });
  });

  it("throws on unsupported Zod types", () => {
    const schema = z.object({
      value: z.date().describe("a date"),
    });
    expect(() => zodToPromptSchema(schema)).toThrow("unsupported Zod type");
  });
});

// inferStep

describe("inferStep", () => {
  it("converts Zod schema to prompt schema and embeds id + message", () => {
    const schema = z.object({
      name: z.string().describe("the name"),
    });
    const step = inferStep({ id: "test-step", schema, message: "Extract a name." });
    expect(step.id).toBe("test-step");
    expect(step.message).toBe("Extract a name.");
    expect(step.schema).toEqual({ name: "string - the name" });
  });
});

// WorkflowContext.infer with InferStep

function memoryPersistence(): StatePersistence {
  let data: WorkflowState | null = null;
  const save = (d: WorkflowState) => { data = JSON.parse(JSON.stringify(d)); };
  return {
    load: () => (data ? JSON.parse(JSON.stringify(data)) : null),
    save,
    initialize: () => save({ status: "running", entries: [] }),
    setStatus: (s) => { if (data) { data.status = s; save(data); } },
  };
}

describe("WorkflowContext.infer", () => {
  it("accepts InferStep and forwards as InferRequest to resolver", async () => {
    const persistence = memoryPersistence();
    persistence.initialize();

    let captured: Prompt | null = null;
    const resolver = async (prompt: Prompt) => {
      captured = prompt;
      return { name: "test" };
    };

    const ctx = new WorkflowContext(persistence, resolver);
    const schema = z.object({
      name: z.string().describe("the name"),
    });

    const result = await ctx.infer(inferStep({ id: "test-step", schema, message: "Extract a name." }));

    expect(result).toEqual({ name: "test" });
    expect(captured!.id).toBe("test-step");
    expect(captured!.type).toBe("infer");
    expect((captured!.request as any).schema).toEqual({
      name: "string - the name",
    });
  });

  it("still supports legacy infer<T>(id, request) API", async () => {
    const persistence = memoryPersistence();
    persistence.initialize();

    const resolver = async () => ({ count: 42 });
    const ctx = new WorkflowContext(persistence, resolver);

    const result = await ctx.infer<{ count: number }>("legacy-step", {
      message: "Count something.",
      schema: { count: "number" },
    });

    expect(result).toEqual({ count: 42 });
  });
});
