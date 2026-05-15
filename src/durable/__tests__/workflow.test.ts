import { describe, it, expect } from "vitest";
import {
  type StatePersistence,
  type WorkflowState,
  type Workflow,
  type Resolver,
  type Prompt,
  type ExecutionResult,
  Suspend,
  NonDeterminismError,
  DuplicateCallIdError,
  execute,
} from "../workflow.js";

// Helpers

/** Resolver for pure-compute workflows that never call infer/prompt. */
const UNREACHABLE: Resolver = async () => { throw new Error("unreachable"); };

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

/** Resolver that answers known IDs, suspends on unknown. */
function createResolver(answers?: Record<string, unknown>): Resolver {
  return async (prompt) => {
    if (answers && prompt.id in answers) return answers[prompt.id];
    throw new Suspend(prompt.id, prompt);
  };
}

/** Resolver that answers everything inline, never suspends. */
function testResolver(answers: Record<string, unknown>): Resolver {
  return async (prompt) => answers[prompt.id] ?? "";
}

/**
 * Skill-like adapter: infer resolves inline via LLM mock, prompt
 * resolves if prompt.id matches an entry in env, otherwise suspends.
 */
function createAdapter(llm: Record<string, unknown>, env?: Record<string, unknown>): Resolver {
  return async (prompt) => {
    if (prompt.type === "infer") return llm[prompt.id] ?? {};
    if (env && prompt.id in env) return env[prompt.id];
    throw new Suspend(prompt.id, prompt);
  };
}

/** Execute, silently absorb Suspend. Returns true if completed, false if suspended. */
async function step(
  persistence: StatePersistence,
  workflow: Workflow,
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

/** Execute, expect Suspend, return the Prompt. Throws if workflow completes. */
async function suspended(
  persistence: StatePersistence,
  workflow: Workflow,
  resolver: Resolver,
): Promise<Prompt> {
  try {
    await execute(persistence, workflow, resolver);
    throw new Error("Expected suspension but workflow completed");
  } catch (e) {
    if (e instanceof Suspend) return e.value as Prompt;
    throw e;
  }
}

/** Drive a workflow through a sequence of answers, one per round. */
async function drive(
  persistence: StatePersistence,
  workflow: Workflow,
  inputs: [string, unknown][],
): Promise<void> {
  await step(persistence, workflow, createResolver());
  for (const [id, value] of inputs) {
    if (persistence.load()?.status === "completed") break;
    await step(persistence, workflow, createResolver({ [id]: value }));
  }
}

// ============================================================
// Replay mechanics
// ============================================================

const fulfillOrder: Workflow = async (ctx) => {
  const order = await ctx.infer<{ item: string; qty: number }>("order", {
    message: "What would you like to order?",
  });

  const total = await ctx.call("price", () => order.qty * 29.99);

  const payment = await ctx.infer<{ txId: string }>("payment", {
    message: "Provide payment",
  });

  const shipment = await ctx.call("ship", () => ({
    tracking: `TRK-${payment.txId}`,
    label: `${order.item} x${order.qty}`,
    charged: total,
  }));

  await ctx.infer("delivered", { message: "Confirm delivery" });

  await ctx.call("close", () => ({
    status: "fulfilled",
    tracking: shipment.tracking,
  }));
};

describe("order fulfillment", () => {
  it("suspends at each wait, replays steps on resume", async () => {
    const persistence = memoryPersistence();

    const p1 = await suspended(persistence, fulfillOrder, createResolver());
    expect(p1.id).toBe("order");
    expect(persistence.current()!.status).toBe("suspended");

    const p2 = await suspended(persistence, fulfillOrder, createResolver({ order: { item: "Widget", qty: 3 } }));
    expect(p2.id).toBe("payment");
    expect(persistence.entry("price")).toBeCloseTo(89.97);

    const p3 = await suspended(persistence, fulfillOrder, createResolver({ payment: { txId: "abc123" } }));
    expect(p3.id).toBe("delivered");
    expect(persistence.entry("ship")).toEqual({
      tracking: "TRK-abc123",
      label: "Widget x3",
      charged: 89.97,
    });

    await execute(persistence, fulfillOrder, createResolver({ delivered: "signed" }));
    expect(persistence.current()!.status).toBe("completed");
  });
});

const approvalWorkflow: Workflow = async (ctx) => {
  let draft = await ctx.infer<string>("submit", { message: "Submit draft" });

  for (let round = 0; ; round++) {
    const review = await ctx.infer<"approved" | "rejected">(`review-${round}`, {
      message: "Review",
    });

    if (review === "approved") {
      await ctx.call("finalize", () => ({ approved: draft, rounds: round + 1 }));
      return;
    }

    draft = await ctx.infer<string>(`revise-${round}`, { message: "Revise" });
  }
};

describe("approval with rejection loop", () => {
  it("loops through rejections until approved", async () => {
    const persistence = memoryPersistence();

    await drive(persistence, approvalWorkflow, [
      ["submit", "v1 of the proposal"],
      ["review-0", "rejected"],
      ["revise-0", "v2 with fixes"],
      ["review-1", "rejected"],
      ["revise-1", "v3 final"],
      ["review-2", "approved"],
    ]);

    expect(persistence.current()!.status).toBe("completed");
    expect(persistence.entry("finalize")).toEqual({
      approved: "v3 final",
      rounds: 3,
    });
  });
});

const onboarding: Workflow = async (ctx) => {
  const email = await ctx.infer<string>("email", { message: "Provide email" });

  const token = await ctx.call("generate-token", () =>
    Buffer.from(email).toString("base64").slice(0, 8),
  );

  const code = await ctx.infer<string>("verify", { message: "Enter verification code" });

  const verified = await ctx.call("check-token", () => code === token);

  if (!verified) {
    await ctx.infer("retry", { message: "Verification failed" });
    return;
  }

  const profile = await ctx.infer<{ name: string; role: string }>("profile", {
    message: "Provide profile",
  });

  await ctx.call("provision", () => ({
    email,
    ...profile,
    active: true,
  }));
};

describe("user onboarding", () => {
  it("provisions account after verification", async () => {
    const persistence = memoryPersistence();

    await step(persistence, onboarding, createResolver());
    await step(persistence, onboarding, createResolver({ email: "alice@test.com" }));

    const token = persistence.entry("generate-token") as string;

    await drive(persistence, onboarding, [
      ["verify", token],
      ["profile", { name: "Alice", role: "admin" }],
    ]);

    expect(persistence.current()!.status).toBe("completed");
    expect(persistence.entry("provision")).toEqual({
      email: "alice@test.com",
      name: "Alice",
      role: "admin",
      active: true,
    });
  });

  it("halts on failed verification", async () => {
    const persistence = memoryPersistence();

    await drive(persistence, onboarding, [
      ["email", "bob@test.com"],
      ["verify", "wrong-code"],
    ]);

    const prompt = await suspended(persistence, onboarding, createResolver());
    expect(prompt.id).toBe("retry");
    expect(persistence.entry("check-token")).toBe(false);
  });
});

// ============================================================
// Lifecycle
// ============================================================

describe("lifecycle", () => {
  it("short-circuits on completed workflow", async () => {
    const persistence = memoryPersistence();
    let executions = 0;

    const simple: Workflow = async (ctx) => {
      await ctx.call("work", () => { executions++; return 42; });
    };

    await execute(persistence, simple, UNREACHABLE);
    expect(executions).toBe(1);
    expect(persistence.current()!.status).toBe("completed");

    await execute(persistence, simple, UNREACHABLE);
    expect(executions).toBe(1);
  });

  it("sets status to failed on error and preserves partial progress", async () => {
    const persistence = memoryPersistence();

    const failing: Workflow = async (ctx) => {
      await ctx.call("step-1", () => "ok");
      await ctx.call("step-2", () => { throw new Error("boom"); });
    };

    await expect(execute(persistence, failing, UNREACHABLE)).rejects.toThrow("boom");
    expect(persistence.current()!.status).toBe("failed");
    expect(persistence.entry("step-1")).toBe("ok");
    expect(persistence.current()!.entries).toHaveLength(1);
  });

  it("retries after failure without losing progress", async () => {
    const persistence = memoryPersistence();
    let attempt = 0;

    const flaky: Workflow = async (ctx) => {
      await ctx.call("stable", () => "done");
      await ctx.call("flaky", () => {
        attempt++;
        if (attempt < 2) throw new Error("transient");
        return "recovered";
      });
    };

    await expect(execute(persistence, flaky, UNREACHABLE)).rejects.toThrow("transient");
    expect(persistence.current()!.status).toBe("failed");

    await execute(persistence, flaky, UNREACHABLE);
    expect(persistence.current()!.status).toBe("completed");
    expect(persistence.entry("flaky")).toBe("recovered");
  });
});

// ============================================================
// Non-determinism detection
// ============================================================

describe("non-determinism detection", () => {
  it("throws when replay encounters a different step id", async () => {
    const persistence = memoryPersistence();

    const v1: Workflow = async (ctx) => {
      await ctx.infer("a", { message: "a" });
      await ctx.infer("b", { message: "b" });
      await ctx.infer("c", { message: "c" });
    };

    await drive(persistence, v1, [["a", "1"], ["b", "2"]]);
    expect(persistence.current()!.status).toBe("suspended");

    const v2: Workflow = async (ctx) => {
      await ctx.call("a", () => 1);
      await ctx.call("x", () => 2);
    };

    await expect(execute(persistence, v2, UNREACHABLE)).rejects.toThrow(NonDeterminismError);
  });

  it("throws on duplicate call ids", async () => {
    const persistence = memoryPersistence();

    const duped: Workflow = async (ctx) => {
      await ctx.call("step", () => 1);
      await ctx.call("step", () => 2);
    };

    await expect(execute(persistence, duped, UNREACHABLE)).rejects.toThrow(DuplicateCallIdError);
  });
});

// ============================================================
// Interview semantics
// ============================================================

const session: Workflow = async (ctx) => {
  const description = await ctx.prompt("get-description", {
    message: "Please describe the project you want to build.",
  });

  const topics = await ctx.infer<{ topics: string[]; domain: string }>(
    "extract-topics",
    { message: `Extract topics from: "${description}"`, schema: { topics: "list", domain: "string" } },
  );

  const category = await ctx.call("classify", () => {
    if (topics.topics.some((t) => t.includes("finance"))) return "financial";
    if (topics.topics.some((t) => t.includes("tech"))) return "technical";
    return "general";
  });

  await ctx.infer("summarize", {
    message: `Summarize ${category} project about: ${topics.topics.join(", ")}`,
    schema: { summary: "string" },
  });

  await ctx.prompt("confirm", {
    message: "Does this summary capture your intent?",
    suggestions: ["Yes, looks good", "No, let me clarify"],
  });
};

describe("test resolver", () => {
  it("runs to completion without suspending", async () => {
    const persistence = memoryPersistence();

    await execute(persistence, session, testResolver({
      "get-description": "A tech platform for AI tools",
      "extract-topics": { topics: ["tech", "AI"], domain: "technology" },
      "summarize": { summary: "A tech platform for AI tools" },
      "confirm": "Yes, looks good",
    }));

    expect(persistence.current()!.status).toBe("completed");
    expect(persistence.current()!.entries.map((e) => e.id)).toEqual([
      "get-description", "extract-topics", "classify", "summarize", "confirm",
    ]);
  });

  it("memoizes across runs", async () => {
    const persistence = memoryPersistence();
    let resolveCount = 0;

    const counting: Workflow = async (ctx) => {
      await ctx.prompt("q1", { message: "First question?" });
      await ctx.prompt("q2", { message: "Second question?" });
    };

    const resolver: Resolver = async () => { resolveCount++; return "x"; };
    await execute(persistence, counting, resolver);
    expect(resolveCount).toBe(2);

    resolveCount = 0;
    await execute(persistence, counting, resolver);
    expect(resolveCount).toBe(0);
  });
});

describe("skill adapter", () => {
  const llm = {
    "extract-topics": { topics: ["finance", "investments"], domain: "finance" },
    "summarize": { summary: "A Q3 financial report" },
  };

  it("suspends at first prompt", async () => {
    const persistence = memoryPersistence();

    const prompt = await suspended(persistence, session, createAdapter(llm));

    expect(prompt.type).toBe("prompt");
    expect(prompt.id).toBe("get-description");
    expect(prompt.request).toEqual({
      message: "Please describe the project you want to build.",
    });
    expect(persistence.current()!.status).toBe("suspended");
  });

  it("resumes, resolves infer inline, suspends at next prompt", async () => {
    const persistence = memoryPersistence();

    await step(persistence, session, createAdapter(llm));

    const prompt = await suspended(persistence, session, createAdapter(llm, { "get-description": "Finance report on Q3" }));

    expect(prompt.type).toBe("prompt");
    expect(prompt.id).toBe("confirm");
    expect(prompt.request).toEqual({
      message: "Does this summary capture your intent?",
      suggestions: ["Yes, looks good", "No, let me clarify"],
    });
  });

  it("completes when all prompts are answered", async () => {
    const persistence = memoryPersistence();

    await step(persistence, session, createAdapter(llm));
    await step(persistence, session, createAdapter(llm, { "get-description": "Finance report" }));
    await execute(persistence, session, createAdapter(llm, { "confirm": "Yes, looks good" }));

    expect(persistence.current()!.status).toBe("completed");
    expect(persistence.current()!.entries.map((e) => e.id)).toEqual([
      "get-description", "extract-topics", "classify", "summarize", "confirm",
    ]);
  });

  it("replays cached steps without re-executing", async () => {
    const persistence = memoryPersistence();
    let computeCount = 0;

    const tracked: Workflow = async (ctx) => {
      await ctx.prompt("input", { message: "Provide input" });
      await ctx.call("calc", () => { computeCount++; return 42; });
      await ctx.infer("tag", { message: "tag items" });
      await ctx.prompt("output", { message: "Review output" });
    };

    const trackedLlm = { "tag": { tags: ["fruit"] } };

    await step(persistence, tracked, createAdapter(trackedLlm));

    await step(persistence, tracked, createAdapter(trackedLlm, { "input": "data" }));
    expect(computeCount).toBe(1);

    computeCount = 0;
    await step(persistence, tracked, createAdapter(trackedLlm, { "output": "done" }));
    expect(computeCount).toBe(0);
  });
});

// ============================================================
// Mixed call types
// ============================================================

describe("mixed call types", () => {
  it("interleaves compute, infer, and ask", async () => {
    const persistence = memoryPersistence();

    const mixed: Workflow = async (ctx) => {
      const raw = await ctx.prompt("input", { message: "List items" });
      const parsed = await ctx.call("parse", () => raw.split(",").map((s) => s.trim()));
      const enriched = await ctx.infer<{ tags: string[] }>("tag", {
        message: `Tag items: ${parsed.join(", ")}`,
      });
      await ctx.prompt("review", {
        message: `Tagged ${parsed.length} items with: ${enriched.tags.join(", ")}. OK?`,
        suggestions: ["Yes", "No"],
      });
    };

    const llm = { "tag": { tags: ["fruit", "produce"] } };

    await step(persistence, mixed, createAdapter(llm));
    await step(persistence, mixed, createAdapter(llm, { "input": "apple, banana, cherry" }));
    await execute(persistence, mixed, createAdapter(llm, { "review": "Yes" }));

    expect(persistence.current()!.status).toBe("completed");
    expect(persistence.current()!.entries.map((e) => e.id)).toEqual([
      "input", "parse", "tag", "review",
    ]);
  });
});

// ============================================================
// Prompt content
// ============================================================

describe("prompt content", () => {
  it("includes message and suggestions in prompt request", async () => {
    const persistence = memoryPersistence();

    const proc: Workflow = async (ctx) => {
      await ctx.prompt("dinner", {
        message: "What's for dinner?",
        suggestions: ["Pizza", "Sushi", "Tacos"],
      });
    };

    const prompt = await suspended(persistence, proc, createAdapter({}));

    expect(prompt.type).toBe("prompt");
    expect(prompt.request).toEqual({
      message: "What's for dinner?",
      suggestions: ["Pizza", "Sushi", "Tacos"],
    });
  });
});

// ============================================================
// Suspended entries
// ============================================================

describe("suspended entries", () => {
  it("writes suspended entry on first suspension", async () => {
    const persistence = memoryPersistence();

    const wf: Workflow = async (ctx) => {
      await ctx.prompt("q1", { message: "Question?" });
    };

    await suspended(persistence, wf, createAdapter({}));

    const state = persistence.current()!;
    expect(state.entries).toHaveLength(1);
    expect(state.entries[0]).toEqual({ id: "q1", suspended: true });
    expect(state.status).toBe("suspended");
  });

  it("replaces suspended entry with value on fulfillment", async () => {
    const persistence = memoryPersistence();

    const wf: Workflow = async (ctx) => {
      await ctx.prompt("q1", { message: "Question?" });
    };

    await step(persistence, wf, createAdapter({}));
    await execute(persistence, wf, createAdapter({}, { "q1": "answer" }));

    const state = persistence.current()!;
    expect(state.entries).toHaveLength(1);
    expect(state.entries[0]).toEqual({ id: "q1", value: "answer" });
    expect(state.status).toBe("completed");
  });

  it("call() can suspend via Suspend thrown in fn", async () => {
    const persistence = memoryPersistence();
    let attempt = 0;

    const wf: Workflow = async (ctx) => {
      await ctx.call("blocking", () => {
        attempt++;
        if (attempt < 2) throw new Suspend("blocking");
        return "done";
      });
    };

    await step(persistence, wf, UNREACHABLE);
    expect(persistence.current()!.entries[0]).toEqual({ id: "blocking", suspended: true });

    await execute(persistence, wf, UNREACHABLE);
    expect(persistence.current()!.entries[0]).toEqual({ id: "blocking", value: "done" });
    expect(persistence.current()!.status).toBe("completed");
  });
});

// ============================================================
// Fidelity checking
// ============================================================

describe("fidelity checking", () => {
  it("reports no mismatches when result matches schema", async () => {
    const persistence = memoryPersistence();

    const wf: Workflow = async (ctx) => {
      await ctx.infer("extract", {
        message: "Extract data",
        schema: { name: "string", age: "number" },
      });
    };

    const { fidelity } = await execute(persistence, wf, testResolver({
      extract: { name: "Alice", age: 30 },
    }));

    expect(fidelity.checked).toBe(1);
    expect(fidelity.mismatched).toBe(0);
    expect(fidelity.details).toEqual([]);
  });

  it("reports mismatch when result is missing keys", async () => {
    const persistence = memoryPersistence();

    const wf: Workflow = async (ctx) => {
      await ctx.infer("extract", {
        message: "Extract data",
        schema: { name: "string", age: "number", role: "string" },
      });
    };

    const { fidelity } = await execute(persistence, wf, testResolver({
      extract: { name: "Alice" },
    }));

    expect(fidelity.checked).toBe(1);
    expect(fidelity.mismatched).toBe(1);
    expect(fidelity.details).toHaveLength(1);
    expect(fidelity.details[0].id).toBe("extract");
    expect(fidelity.details[0].missingKeys).toEqual(["age", "role"]);
  });

  it("does not check infer calls without schema", async () => {
    const persistence = memoryPersistence();

    const wf: Workflow = async (ctx) => {
      await ctx.infer("noschema", { message: "No schema" });
    };

    const { fidelity } = await execute(persistence, wf, testResolver({
      noschema: { anything: true },
    }));

    expect(fidelity.checked).toBe(0);
    expect(fidelity.mismatched).toBe(0);
  });

  it("allows extra keys in result without mismatch", async () => {
    const persistence = memoryPersistence();

    const wf: Workflow = async (ctx) => {
      await ctx.infer("extract", {
        message: "Extract",
        schema: { name: "string" },
      });
    };

    const { fidelity } = await execute(persistence, wf, testResolver({
      extract: { name: "Alice", bonus: "extra" },
    }));

    expect(fidelity.checked).toBe(1);
    expect(fidelity.mismatched).toBe(0);
  });

  it("accumulates across multiple infer calls", async () => {
    const persistence = memoryPersistence();

    const wf: Workflow = async (ctx) => {
      await ctx.infer("a", { message: "A", schema: { x: "string" } });
      await ctx.infer("b", { message: "B", schema: { y: "string", z: "string" } });
      await ctx.infer("c", { message: "C", schema: { w: "string" } });
    };

    const { fidelity } = await execute(persistence, wf, testResolver({
      a: { x: "ok" },
      b: { y: "ok" },       // missing z
      c: { other: "bad" },  // missing w
    }));

    expect(fidelity.checked).toBe(3);
    expect(fidelity.mismatched).toBe(2);
    expect(fidelity.details).toHaveLength(2);
    expect(fidelity.details[0].id).toBe("b");
    expect(fidelity.details[1].id).toBe("c");
  });

  it("rebuilds counters on replay", async () => {
    const persistence = memoryPersistence();

    const wf: Workflow = async (ctx) => {
      await ctx.infer("extract", {
        message: "Extract",
        schema: { name: "string", age: "number" },
      });
      await ctx.prompt("confirm", { message: "OK?" });
    };

    // First run: suspends at prompt, extract has a mismatch
    await step(persistence, wf, createAdapter(
      { extract: { name: "Alice" } },  // missing age
    ));

    // Resume: replays extract (rebuilds counter), completes
    const { fidelity } = await execute(persistence, wf, createAdapter(
      { extract: { name: "Alice" } },
      { confirm: "yes" },
    ));

    expect(fidelity.checked).toBe(1);
    expect(fidelity.mismatched).toBe(1);
    expect(fidelity.details[0].missingKeys).toEqual(["age"]);
  });

  it("returns empty report for already-completed workflow", async () => {
    const persistence = memoryPersistence();

    const wf: Workflow = async (ctx) => {
      await ctx.call("work", () => 42);
    };

    await execute(persistence, wf, UNREACHABLE);
    expect(persistence.current()!.status).toBe("completed");

    const result = await execute(persistence, wf, UNREACHABLE);
    expect(result.fidelity).toEqual({ checked: 0, mismatched: 0, details: [] });
  });

  it("reports non-object result as fidelity miss with reason", async () => {
    const persistence = memoryPersistence();

    const wf: Workflow = async (ctx) => {
      await ctx.infer("extract", {
        message: "Extract data",
        schema: { name: "string", age: "number" },
      });
    };

    const { fidelity } = await execute(persistence, wf, testResolver({
      extract: "not an object",
    }));

    expect(fidelity.checked).toBe(1);
    expect(fidelity.mismatched).toBe(1);
    expect(fidelity.details).toHaveLength(1);
    expect(fidelity.details[0].reason).toBe("non-object");
    expect(fidelity.details[0].actualKeys).toEqual([]);
  });
});

// ============================================================
// Null-persistence guard (F025)
// ============================================================

describe("null-persistence guard", () => {
  it("throws when persistence.load() returns null after initialize()", async () => {
    const broken: StatePersistence = {
      load: () => null,
      save: () => {},
      initialize: () => {},
      setStatus: () => {},
    };

    const wf: Workflow = async () => {};
    await expect(execute(broken, wf, UNREACHABLE))
      .rejects.toThrow("requires initialized persistence");
  });
});

// ============================================================
// Whitespace normalization in prompt()
// ============================================================

describe("prompt message normalization", () => {
  it("trims lines and collapses excess blank lines", async () => {
    const persistence = memoryPersistence();

    const wf: Workflow = async (ctx) => {
      await ctx.prompt("q", { message: "  Line one  \n  Line two  \n\n\n\nLine three  " });
    };

    try {
      await execute(persistence, wf, createResolver());
    } catch (e) {
      if (e instanceof Suspend) {
        const prompt = e.value as Prompt;
        expect(prompt.request.message).toBe("Line one\nLine two\n\nLine three");
        return;
      }
      throw e;
    }
    throw new Error("expected Suspend");
  });
});

// ============================================================
// Prompt turn counter
// ============================================================

describe("lastPromptId", () => {
  it("starts as null", async () => {
    const persistence = memoryPersistence();
    let observed: string | null = "sentinel";
    const wf: Workflow = async (ctx) => {
      observed = ctx.lastPromptId;
    };
    await execute(persistence, wf, UNREACHABLE);
    expect(observed).toBeNull();
  });

  it("tracks most recent prompt id, ignores infer", async () => {
    const observations: Array<string | null> = [];
    const wf: Workflow = async (ctx) => {
      observations.push(ctx.lastPromptId);       // null — before any prompt
      await ctx.infer("i1", { message: "infer" });
      observations.push(ctx.lastPromptId);       // still null
      await ctx.prompt("p1", { message: "first" });
      observations.push(ctx.lastPromptId);       // "p1"
      await ctx.infer("i2", { message: "infer" });
      observations.push(ctx.lastPromptId);       // still "p1"
      await ctx.prompt("p2", { message: "second" });
      observations.push(ctx.lastPromptId);       // "p2"
    };
    const persistence = memoryPersistence();
    await execute(persistence, wf, testResolver({ i1: {}, p1: "a", i2: {}, p2: "b" }));
    expect(observations).toEqual([null, null, "p1", "p1", "p2"]);
  });

  it("currentSource returns structured source from lastPromptId", async () => {
    const persistence = memoryPersistence();
    const observations: Array<{ promptId: string } | undefined> = [];
    const wf: Workflow = async (ctx) => {
      observations.push(ctx.currentSource);            // undefined before any prompt
      await ctx.prompt("p1", { message: "first" });
      observations.push(ctx.currentSource);            // { promptId: "p1" }
      await ctx.infer("i1", { message: "infer" });
      observations.push(ctx.currentSource);            // still { promptId: "p1" }
    };
    await execute(persistence, wf, testResolver({ p1: "a", i1: {} }));
    expect(observations).toEqual([undefined, { promptId: "p1" }, { promptId: "p1" }]);
  });

  it("replays to same values on resume", async () => {
    const observations: Array<string | null> = [];
    const wf: Workflow = async (ctx) => {
      await ctx.prompt("p1", { message: "first" });
      observations.push(ctx.lastPromptId);
      await ctx.prompt("p2", { message: "second" });
      observations.push(ctx.lastPromptId);
    };
    const persistence = memoryPersistence();
    // Suspend on p1
    await step(persistence, wf, createResolver());
    // Provide p1, suspend on p2
    observations.length = 0;
    await step(persistence, wf, createResolver({ p1: "a" }));
    expect(observations).toEqual(["p1"]);
    // Provide p2, complete
    observations.length = 0;
    await step(persistence, wf, createResolver({ p2: "b" }));
    expect(observations).toEqual(["p1", "p2"]);
  });
});
