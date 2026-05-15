import { describe, it, expect } from "vitest";
import {
  type StatePersistence,
  type WorkflowState,
  type Resolver,
  type Prompt,
  Suspend,
  execute,
  WorkflowContext,
} from "../../durable/workflow.js";
import { Confusion, OffTopic, Pushback, TopicChange, Frustration, deviationMessage } from "../deviation.js";
import "../deviation.js"; // register retry prototype

// ── Helpers ──

function memoryPersistence(): StatePersistence & {
  current(): WorkflowState | null;
  entry(id: string): unknown;
} {
  let data: WorkflowState | null = null;
  const save = (d: WorkflowState) => { data = JSON.parse(JSON.stringify(d)); };
  return {
    load: () => (data ? JSON.parse(JSON.stringify(data)) : null),
    save,
    initialize: () => save({ status: "running", entries: [] }),
    setStatus: (s) => { if (data) { data.status = s; save(data); } },
    current: () => data,
    entry: (id) => {
      const e = data?.entries.find((e) => e.id === id);
      return e && "value" in e ? e.value : undefined;
    },
  };
}

function testResolver(answers: Record<string, unknown>): Resolver {
  return async (prompt) => answers[prompt.id] ?? {};
}

async function step(
  persistence: StatePersistence,
  workflow: (ctx: WorkflowContext) => Promise<void>,
  resolver: Resolver,
): Promise<boolean> {
  try {
    await execute(persistence, workflow, resolver);
    return true;
  } catch (e) {
    if (e instanceof Suspend) return false;
    throw e;
  }
}

// ── Error classes ──

describe("Confusion", () => {
  it("carries the original response", () => {
    const err = new Confusion("What do you mean?");
    expect(err.response).toBe("What do you mean?");
  });
});

describe("OffTopic", () => {
  it("carries the original response and parked items", () => {
    const items = [{ content: "dark mode" }];
    const err = new OffTopic("Oh and we need dark mode", items);
    expect(err.response).toBe("Oh and we need dark mode");
    expect(err.parkedItems).toEqual(items);
  });

  it("defaults to empty parked items", () => {
    const err = new OffTopic("Why are you asking this?");
    expect(err.parkedItems).toEqual([]);
  });
});

describe("deviation classes extend Error", () => {
  it.each([
    ["Confusion", new Confusion("msg")],
    ["OffTopic", new OffTopic("msg")],
    ["Pushback", new Pushback("msg")],
    ["TopicChange", new TopicChange("msg")],
    ["Frustration", new Frustration("msg")],
  ] as const)("%s is instanceof Error", (_name, err) => {
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe(_name);
    expect(err.message).toBe("msg");
  });
});

describe("deviationMessage", () => {
  it("returns rephrase message for clarification", () => {
    const msg = deviationMessage(new Confusion("huh?"));
    expect(msg).toContain("differently");
  });

  it("returns redirect message for off-topic", () => {
    const msg = deviationMessage(new OffTopic("dark mode"));
    expect(msg).toContain("noted");
    expect(msg).toContain("come back");
  });

  it("returns empathetic message for frustration", () => {
    const msg = deviationMessage(new Frustration("this is taking too long"));
    expect(msg).toContain("almost through");
  });

  it("returns explanatory message for pushback", () => {
    const msg = deviationMessage(new Pushback("why are you asking this?"));
    expect(msg).toContain("nothing important is missed");
  });
});

// ── Retry primitive ──

describe("retryOnDeviation", () => {
  it("returns result on first success (answer)", async () => {
    const persistence = memoryPersistence();
    let callCount = 0;

    const workflow = async (ctx: WorkflowContext) => {
      const result = await ctx.retryOnDeviation(
        async (index) => {
          callCount++;
          return { value: "ok", index };
        },
      );
      expect(result).toEqual({ value: "ok", index: 0 });
    };

    await execute(persistence, workflow, testResolver({}));
    expect(callCount).toBe(1);
  });

  it("retries on Confusion", async () => {
    const persistence = memoryPersistence();
    const calls: Array<{ index: number; error?: Confusion | OffTopic }> = [];

    const workflow = async (ctx: WorkflowContext) => {
      const result = await ctx.retryOnDeviation(
        async (index, error?) => {
          calls.push({ index, error });
          if (index === 0) throw new Confusion("What do you mean?");
          return { value: "answered" };
        },
      );
      expect(result).toEqual({ value: "answered" });
    };

    await execute(persistence, workflow, testResolver({}));
    expect(calls).toHaveLength(2);
    expect(calls[0].index).toBe(0);
    expect(calls[0].error).toBeUndefined();
    expect(calls[1].index).toBe(1);
    expect(calls[1].error).toBeInstanceOf(Confusion);
  });

  it("retries on OffTopic", async () => {
    const persistence = memoryPersistence();
    const calls: Array<{ index: number; error?: Confusion | OffTopic }> = [];

    const workflow = async (ctx: WorkflowContext) => {
      const result = await ctx.retryOnDeviation(
        async (index, error?) => {
          calls.push({ index, error });
          if (index === 0) throw new OffTopic("dark mode", [{ content: "dark mode feature" }]);
          return { value: "on topic now" };
        },
      );
      expect(result).toEqual({ value: "on topic now" });
    };

    await execute(persistence, workflow, testResolver({}));
    expect(calls).toHaveLength(2);
    expect(calls[1].error).toBeInstanceOf(OffTopic);
    expect((calls[1].error as OffTopic).parkedItems).toEqual([{ content: "dark mode feature" }]);
  });

  it("returns defaults when retries exhausted", async () => {
    const persistence = memoryPersistence();
    let callCount = 0;

    const workflow = async (ctx: WorkflowContext) => {
      const result = await ctx.retryOnDeviation(
        async () => {
          callCount++;
          throw new Confusion("still confused");
        },
        { maxRetries: 2, defaults: { fallback: true } },
      );
      expect(result).toEqual({ fallback: true });
    };

    await execute(persistence, workflow, testResolver({}));
    // 1 initial + 2 retries = 3 calls
    expect(callCount).toBe(3);
  });

  it("re-throws last error when no defaults provided and retries exhausted", async () => {
    const persistence = memoryPersistence();

    const workflow = async (ctx: WorkflowContext) => {
      await ctx.retryOnDeviation(
        async () => {
          throw new OffTopic("off topic");
        },
        { maxRetries: 1 },
      );
    };

    await expect(execute(persistence, workflow, testResolver({}))).rejects.toBeInstanceOf(OffTopic);
  });

  it("handles mixed deviation types across retries", async () => {
    const persistence = memoryPersistence();
    const errors: Array<Confusion | OffTopic | undefined> = [];

    const workflow = async (ctx: WorkflowContext) => {
      const result = await ctx.retryOnDeviation(
        async (index, error?) => {
          errors.push(error);
          if (index === 0) throw new OffTopic("off topic", [{ content: "idea" }]);
          if (index === 1) throw new Confusion("what?");
          return { value: "finally" };
        },
      );
      expect(result).toEqual({ value: "finally" });
    };

    await execute(persistence, workflow, testResolver({}));
    expect(errors).toHaveLength(3);
    expect(errors[0]).toBeUndefined();
    expect(errors[1]).toBeInstanceOf(OffTopic);
    expect(errors[2]).toBeInstanceOf(Confusion);
  });

  it("propagates non-deviation errors immediately", async () => {
    const persistence = memoryPersistence();

    const workflow = async (ctx: WorkflowContext) => {
      await ctx.retryOnDeviation(async () => {
        throw new Error("real bug");
      });
    };

    await expect(execute(persistence, workflow, testResolver({}))).rejects.toThrow("real bug");
  });

  it("respects custom maxRetries", async () => {
    const persistence = memoryPersistence();
    let callCount = 0;

    const workflow = async (ctx: WorkflowContext) => {
      await ctx.retryOnDeviation(
        async () => {
          callCount++;
          throw new Confusion("confused");
        },
        { maxRetries: 0, defaults: { empty: true } },
      );
    };

    await execute(persistence, workflow, testResolver({}));
    // maxRetries 0 means only the initial attempt, no retries
    expect(callCount).toBe(1);
  });

  it("retryOn filters which errors trigger retry", async () => {
    const persistence = memoryPersistence();

    const workflow = async (ctx: WorkflowContext) => {
      await ctx.retryOnDeviation(
        async (index) => {
          if (index === 0) throw new Pushback("why are you asking this?");
          return { value: "ok" };
        },
        { retryOn: [Confusion] }, // only retry clarification, not pushback
      );
    };

    // Pushback should propagate since it's not in retryOn
    await expect(execute(persistence, workflow, testResolver({}))).rejects.toBeInstanceOf(Pushback);
  });

  it("retryOn allows specified error types through", async () => {
    const persistence = memoryPersistence();
    let callCount = 0;

    const workflow = async (ctx: WorkflowContext) => {
      const result = await ctx.retryOnDeviation(
        async (index) => {
          callCount++;
          if (index === 0) throw new Frustration("too long");
          return { value: "done" };
        },
        { retryOn: [Frustration, Confusion] },
      );
      expect(result).toEqual({ value: "done" });
    };

    await execute(persistence, workflow, testResolver({}));
    expect(callCount).toBe(2);
  });
});

// ── Durability ──

describe("retryOnDeviation durability", () => {
  it("replays correctly after suspend mid-retry", async () => {
    const persistence = memoryPersistence();
    const promptIds: string[] = [];

    /** Workflow: retry wrapping prompt + infer, deviation on first attempt */
    const workflow = async (ctx: WorkflowContext) => {
      const result = await ctx.retryOnDeviation(
        async (ri, error?) => {
          // First attempt: infer returns clarification → throw
          if (ri === 0) {
            const response = await ctx.prompt({ id: `q-r${ri}`, message: "question" });
            // Simulate ctx.extract throwing Confusion
            throw new Confusion(response);
          }
          // Second attempt: prompt suspends (waiting for user input)
          const response = await ctx.prompt({ id: `q-r${ri}`, message: "rephrased question" });
          return { answer: response };
        },
      );
      // Store result for assertion
      await ctx.call("final", () => result);
    };

    // Run 1: prompt q-r0 needs an answer
    const resolver1: Resolver = async (prompt) => {
      promptIds.push(prompt.id);
      if (prompt.id === "q-r0") return "what do you mean?";
      throw new Suspend(prompt.id, prompt);
    };
    await step(persistence, workflow, resolver1);

    // State should have: q-r0 answered, then q-r1 suspended
    const state = persistence.current()!;
    expect(state.status).toBe("suspended");
    expect(state.entries.some((e) => e.id === "q-r0" && "value" in e)).toBe(true);
    expect(state.entries.some((e) => e.id === "q-r1" && "suspended" in e)).toBe(true);

    // Run 2: resume with answer to q-r1
    const resolver2: Resolver = async (prompt) => {
      promptIds.push(prompt.id);
      if (prompt.id === "q-r1") return "actual answer";
      throw new Suspend(prompt.id, prompt);
    };
    const completed = await step(persistence, workflow, resolver2);

    expect(completed).toBe(true);
    // q-r0 replayed (not re-resolved), Confusion re-thrown, q-r1 resolved
    expect(persistence.current()!.status).toBe("completed");
    expect(persistence.entry("final")).toEqual({ answer: "actual answer" });
  });

  it("generates unique IDs across retry indexes (no DuplicateCallIdError)", async () => {
    const persistence = memoryPersistence();

    const workflow = async (ctx: WorkflowContext) => {
      await ctx.retryOnDeviation(
        async (ri) => {
          await ctx.call(`work-r${ri}`, () => `attempt-${ri}`);
          if (ri < 2) throw new Confusion("confused");
          return "done";
        },
      );
    };

    // Should not throw DuplicateCallIdError
    await execute(persistence, workflow, testResolver({}));

    const state = persistence.current()!;
    expect(state.status).toBe("completed");
    // All three attempts should be in the log
    expect(state.entries.some((e) => e.id === "work-r0")).toBe(true);
    expect(state.entries.some((e) => e.id === "work-r1")).toBe(true);
    expect(state.entries.some((e) => e.id === "work-r2")).toBe(true);
  });

  it("deviation response is stored in state log for deterministic replay", async () => {
    const persistence = memoryPersistence();
    let resolverCallCount = 0;

    const workflow = async (ctx: WorkflowContext) => {
      await ctx.retryOnDeviation(
        async (ri) => {
          const val = await ctx.infer<{ data: string }>(`infer-r${ri}`, { message: "extract" });
          if (ri === 0) throw new OffTopic("off topic");
          return val;
        },
      );
    };

    // Run 1: complete both attempts
    const resolver: Resolver = async (prompt) => {
      resolverCallCount++;
      if (prompt.id === "infer-r0") return { data: "deviation-response" };
      if (prompt.id === "infer-r1") return { data: "real-answer" };
      return {};
    };
    await execute(persistence, workflow, resolver);
    expect(resolverCallCount).toBe(2);

    // Run 2: replay from persisted state — resolver should NOT be called
    resolverCallCount = 0;
    await execute(persistence, workflow, resolver);
    expect(resolverCallCount).toBe(0); // All entries replay from log

    // Both infer results are in the state log
    expect(persistence.entry("infer-r0")).toEqual({ data: "deviation-response" });
    expect(persistence.entry("infer-r1")).toEqual({ data: "real-answer" });
  });
});
