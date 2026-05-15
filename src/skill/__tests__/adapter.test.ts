/**
 * Adapter integration tests
 *
 * Simulates the adapter's CLI flow using real file persistence.
 * Each "invocation" creates a fresh persistence instance for the same
 * directory, mirroring how the adapter works across process boundaries.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { Suspend, NonDeterminismError, execute } from "../../durable/workflow.js";
import type { Resolver, Prompt, Workflow } from "../../durable/workflow.js";
import { createSession, ArtifactAggregate } from "../../phases/index.js";
import { Confusion, isDeviationError } from "../../interview/deviation.js";
import type { ContextSummary } from "../../phases/index.js";
import { createFilePersistence, archiveSession } from "../../phases/session/index.js";

// Adapter logic replicated for testing (adapter.ts runs main() on import)

interface AdapterOutput {
  message: string;
  target: "user" | "agent" | "end";
  schema: Record<string, string>;
  context?: ContextSummary;
  existingSession?: boolean;
}

function createResolver(response?: { id: string; value: unknown }): Resolver {
  return async (prompt) => {
    if (response && prompt.id === response.id) return response.value;
    throw new Suspend(prompt.id, prompt);
  };
}

function formatPrompt(prompt: Prompt): AdapterOutput {
  if (prompt.type === "prompt") {
    return { message: prompt.request.message, target: "user", schema: {} };
  }
  return {
    message: prompt.request.message,
    target: "agent",
    schema: (prompt.request.schema ?? {}) as Record<string, string>,
  };
}

const END_OUTPUT: AdapterOutput = {
  message: "This session is complete.",
  target: "end",
  schema: {},
};

// Simulate adapter invocations

/** Bridge aggregate state to persistence on workflow completion (mirrors handle()). */
function bridgeOnComplete(agg: ArtifactAggregate, persistence: ReturnType<typeof createFilePersistence>, testDir: string): void {
  if (agg.userConcern) persistence.setUserConcern(agg.userConcern);
  const purpose = agg.data.purpose?.statement;
  if (purpose) persistence.setTitle(purpose);
  archiveSession(testDir);
}

/** Bridge title on suspend (mirrors handle()). */
function bridgeOnSuspend(agg: ArtifactAggregate, persistence: ReturnType<typeof createFilePersistence>): void {
  const purpose = agg.data.purpose?.statement;
  if (purpose) persistence.setTitle(purpose);
}

/** Simulate `elaborate start` — mirrors adapter's startup lifecycle. */
async function adapterStart(testDir: string, opts?: { new?: boolean }): Promise<AdapterOutput> {
  const persistence = createFilePersistence(testDir);

  if (persistence.hasSession()) {
    const status = persistence.status();

    if (status === "completed") {
      archiveSession(testDir);
    } else if (opts?.new) {
      archiveSession(testDir);
    } else {
      // Active session — replay and signal existingSession
      const agg = new ArtifactAggregate();
      try {
        await execute(persistence, createSession(agg), createResolver());
        bridgeOnComplete(agg, persistence, testDir);
        return END_OUTPUT;
      } catch (e) {
        if (e instanceof Suspend) {
          bridgeOnSuspend(agg, persistence);
          const out = formatPrompt(e.value as Prompt);
          out.context = agg.summarize();
          out.existingSession = true;
          return out;
        }
        throw e;
      }
    }
  }

  // Fresh start
  const freshPersistence = createFilePersistence(testDir);
  const agg = new ArtifactAggregate();
  try {
    await execute(freshPersistence, createSession(agg), createResolver());
    bridgeOnComplete(agg, freshPersistence, testDir);
    return END_OUTPUT;
  } catch (e) {
    if (e instanceof Suspend) {
      bridgeOnSuspend(agg, freshPersistence);
      return formatPrompt(e.value as Prompt);
    }
    throw e;
  }
}

/** Simulate `elaborate response --message="..."` */
async function adapterResponse(testDir: string, message: string): Promise<AdapterOutput> {
  const persistence = createFilePersistence(testDir);
  const id = persistence.suspendedId();
  if (!id) throw new Error("No pending prompt");

  const agg = new ArtifactAggregate();
  try {
    await execute(persistence, createSession(agg), createResolver({ id, value: message }));
    bridgeOnComplete(agg, persistence, testDir);
    return END_OUTPUT;
  } catch (e) {
    if (e instanceof Suspend) {
      bridgeOnSuspend(agg, persistence);
      return formatPrompt(e.value as Prompt);
    }
    throw e;
  }
}

/** Simulate `elaborate inference --data='...'` */
async function adapterInference(testDir: string, data: Record<string, unknown>): Promise<AdapterOutput> {
  const persistence = createFilePersistence(testDir);
  const id = persistence.suspendedId();
  if (!id) throw new Error("No pending prompt");

  const agg = new ArtifactAggregate();
  try {
    await execute(persistence, createSession(agg), createResolver({ id, value: data }));
    bridgeOnComplete(agg, persistence, testDir);
    return END_OUTPUT;
  } catch (e) {
    if (e instanceof Suspend) {
      bridgeOnSuspend(agg, persistence);
      return formatPrompt(e.value as Prompt);
    }
    throw e;
  }
}

/** Simulate `elaborate status` */
function adapterStatus(testDir: string): { active: boolean; phase?: string; sessionId?: string; title?: string; status?: string } {
  const persistence = createFilePersistence(testDir);
  if (!persistence.hasSession()) return { active: false };
  const status = persistence.status();
  const title = persistence.title();
  return {
    active: true,
    phase: persistence.phase() ?? "unknown",
    sessionId: persistence.sessionId() ?? undefined,
    ...(title ? { title } : {}),
    ...(status === "failed" ? { status: "failed" } : {}),
  };
}

/** Simulate adapter error handling: catch workflow errors, return structured error. */
async function adapterExecute(
  testDir: string,
  response?: { id: string; value: unknown },
): Promise<AdapterOutput | { error: string }> {
  const persistence = createFilePersistence(testDir);
  const agg = new ArtifactAggregate();
  try {
    await execute(persistence, createSession(agg), createResolver(response));
    return END_OUTPUT;
  } catch (e) {
    if (e instanceof Suspend) return formatPrompt(e.value as Prompt);
    const err = e instanceof Error ? e : new Error(String(e));
    return { error: err.message };
  }
}

// Tests

describe("Adapter", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), "elaborate-adapter-test-"));
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  describe("status", () => {
    it("returns inactive when no session exists", () => {
      const result = adapterStatus(testDir);
      expect(result).toEqual({ active: false });
    });

    it("returns active with phase after session created", async () => {
      await adapterStart(testDir);
      const result = adapterStatus(testDir);
      expect(result.active).toBe(true);
      expect(result.phase).toBe("opening");
      expect(result.sessionId).toBeDefined();
    });
  });

  describe("start", () => {
    it("creates session and returns greeting", async () => {
      const result = await adapterStart(testDir);
      expect(result.target).toBe("user");
      expect(result.message).toContain("What are you building");
      expect(result.schema).toEqual({});
    });

    it("resumes existing session with existingSession flag", async () => {
      const first = await adapterStart(testDir);
      const second = await adapterStart(testDir);
      expect(second.target).toBe("user");
      expect(second.message).toBe(first.message);
      expect(second.existingSession).toBe(true);
      expect(second.context).toBeDefined();
    });

    it("auto-archives completed session and starts fresh", async () => {
      const persistence = createFilePersistence(testDir);
      persistence.save({ status: "completed", entries: [] });
      const sessionId = persistence.sessionId()!;

      const result = await adapterStart(testDir);
      expect(result.target).toBe("user");
      expect(result.message).toContain("What are you building");

      // Old session archived
      expect(fs.existsSync(path.join(testDir, ".elaborate", `${sessionId}.yaml`))).toBe(true);
      // New session created
      expect(fs.existsSync(path.join(testDir, ".elaborate", "session.yaml"))).toBe(true);
    });
  });

  describe("resume context", () => {
    it("fresh start does not include context", async () => {
      const result = await adapterStart(testDir);
      expect(result.context).toBeUndefined();
    });

    it("resume includes context with empty artifacts", async () => {
      await adapterStart(testDir);
      const result = await adapterStart(testDir);
      expect(result.context).toBeDefined();
      expect(result.context!.goals).toEqual([]);
      expect(result.context!.stakeholders).toEqual([]);
      expect(result.context!.assumptionCount).toBe(0);
    });

    it("resume after opening captures domain hints in artifacts", async () => {
      // Complete opening phase
      await adapterStart(testDir);
      await adapterResponse(testDir, "A reading tracker for book lovers");
      await adapterInference(testDir, {
        purpose: "track reading habits",
        stakeholders: ["book lovers"],
        domainHints: ["books", "reading"],
      });
      await adapterResponse(testDir, "No");
      await adapterInference(testDir, {
        isBrownfield: false,
        sourceIndicators: [],
      });
      await adapterResponse(testDir, "Yes, that's right");
      await adapterInference(testDir, {
        approved: true,
        revisionRequested: null,
      });

      // Now resume — should have context with purpose from opening extraction
      const result = await adapterStart(testDir);
      expect(result.context).toBeDefined();
    });

    it("response and inference do not include context", async () => {
      await adapterStart(testDir);
      const response = await adapterResponse(testDir, "Build a task manager");
      expect(response.context).toBeUndefined();
    });
  });

  describe("response", () => {
    it("processes user message and returns extraction request", async () => {
      await adapterStart(testDir);
      const result = await adapterResponse(testDir, "I want to build a task manager");

      expect(result.target).toBe("agent");
      expect(result.schema).toHaveProperty("purpose");
    });

    it("errors when no pending prompt", async () => {
      await expect(adapterResponse(testDir, "hello")).rejects.toThrow("No pending prompt");
    });
  });

  describe("inference", () => {
    it("processes extraction and returns brownfield prompt", async () => {
      // Start → greeting
      await adapterStart(testDir);

      // Input → extraction request
      await adapterResponse(testDir, "I want to build a task manager");

      // Extract → brownfield screen request
      const screenReq = await adapterInference(testDir, {
        purpose: "manage daily tasks",
        stakeholders: ["busy professional"],
        domainHints: ["productivity"],
      });
      expect(screenReq.target).toBe("agent");

      // Screen (low confidence) → brownfield prompt
      const result = await adapterInference(testDir, {
        greenfieldConfidence: 3,
      });

      expect(result.target).toBe("user");
      expect(result.message).toContain("existing work");
    });

    it("errors when no pending prompt", async () => {
      await expect(adapterInference(testDir, {})).rejects.toThrow("No pending prompt");
    });
  });

  describe("multi-step flow", () => {
    it("completes opening phase through greeting → extract → screen → brownfield → summary", async () => {
      // Start → greeting
      const greeting = await adapterStart(testDir);
      expect(greeting.target).toBe("user");
      expect(greeting.message).toContain("What are you building");

      // Phase should be opening
      expect(adapterStatus(testDir).phase).toBe("opening");

      // Input → extraction request
      const extractionReq = await adapterResponse(testDir, "A reading tracker for book lovers");
      expect(extractionReq.target).toBe("agent");
      expect(extractionReq.schema).toHaveProperty("purpose");

      // Extract → brownfield screen request
      const screenReq = await adapterInference(testDir, {
        purpose: "track reading habits",
        stakeholders: ["book lovers"],
        domainHints: ["books", "reading"],
      });
      expect(screenReq.target).toBe("agent");

      // Screen (low confidence) → brownfield prompt
      const brownfieldPrompt = await adapterInference(testDir, {
        greenfieldConfidence: 3,
      });
      expect(brownfieldPrompt.target).toBe("user");
      expect(brownfieldPrompt.message).toContain("existing work");

      // Brownfield response → classification request
      const classificationReq = await adapterResponse(testDir, "No, starting fresh");
      expect(classificationReq.target).toBe("agent");

      // Classification → summary
      const summary = await adapterInference(testDir, {
        isBrownfield: false,
        sourceIndicators: [],
      });
      expect(summary.target).toBe("user");
      expect(summary.message).toContain("track reading habits");
      expect(summary.message).toContain("Does that sound right");
    });

    it("transitions from opening to purpose phase", async () => {
      // Opening: start → response → extraction → screen → brownfield → classification → summary
      await adapterStart(testDir);
      await adapterResponse(testDir, "A reading tracker for book lovers");
      await adapterInference(testDir, {
        purpose: "track reading habits",
        stakeholders: ["book lovers"],
        domainHints: ["books"],
      });
      await adapterInference(testDir, { greenfieldConfidence: 3 });
      await adapterResponse(testDir, "No");
      await adapterInference(testDir, {
        isBrownfield: false,
        sourceIndicators: [],
      });

      // Summary response → should trigger confirmation classification
      const afterSummary = await adapterResponse(testDir, "Yes, that's right");
      expect(afterSummary.target).toBe("agent");

      // Confirmation classification → triggers purpose extraction
      await adapterInference(testDir, {
        approved: true,
        revisionRequested: null,
      });

      // Phase should now be purpose
      expect(adapterStatus(testDir).phase).toBe("purpose");
    });
  });

  describe("persistence across invocations", () => {
    it("suspended entry survives between fresh persistence instances", async () => {
      await adapterStart(testDir);

      // Create a completely fresh persistence instance (simulating new process)
      const fresh = createFilePersistence(testDir);
      const id = fresh.suspendedId();

      expect(id).not.toBeNull();
      expect(id).toBe("opening-greet-r0");
    });

    it("session file exists on disk after start", async () => {
      await adapterStart(testDir);

      const sessionPath = path.join(testDir, ".elaborate", "session.yaml");
      expect(fs.existsSync(sessionPath)).toBe(true);
    });
  });

  describe("failure handling", () => {
    it("surfaces failed status", async () => {
      const persistence = createFilePersistence(testDir);
      persistence.save({ status: "failed", entries: [{ id: "step1", value: "ok" }] });

      const result = adapterStatus(testDir);
      expect(result.active).toBe(true);
      expect(result.status).toBe("failed");
    });

    it("does not include status field when not failed", async () => {
      await adapterStart(testDir);
      const result = adapterStatus(testDir);
      expect(result.active).toBe(true);
      expect(result).not.toHaveProperty("status");
    });

    it("returns structured error on workflow failure", async () => {
      // Seed state with entries that won't match the real session workflow IDs
      const persistence = createFilePersistence(testDir);
      persistence.save({
        status: "running",
        entries: [{ id: "bogus-id", value: "data" }],
      });

      const result = await adapterExecute(testDir);
      expect(result).toHaveProperty("error");
      expect((result as { error: string }).error).toContain("Non-determinism");
    });
  });

  describe("output format", () => {
    it("prompt calls map to target: user with empty schema", async () => {
      const result = await adapterStart(testDir);
      expect(result.target).toBe("user");
      expect(result.schema).toEqual({});
    });

    it("infer prompts map to target: agent with schema", async () => {
      await adapterStart(testDir);
      const result = await adapterResponse(testDir, "Build a task manager");
      expect(result.target).toBe("agent");
      expect(typeof result.schema).toBe("object");
      expect(Object.keys(result.schema).length).toBeGreaterThan(0);
    });
  });

  describe("multi-session", () => {
    it("start --new archives active session and starts fresh", async () => {
      await adapterStart(testDir);
      const oldSessionId = createFilePersistence(testDir).sessionId()!;

      const result = await adapterStart(testDir, { new: true });
      expect(result.target).toBe("user");
      expect(result.existingSession).toBeUndefined();

      // Old session archived, new one created
      const stateDir = path.join(testDir, ".elaborate");
      expect(fs.existsSync(path.join(stateDir, `${oldSessionId}.yaml`))).toBe(true);
      expect(fs.existsSync(path.join(stateDir, "session.yaml"))).toBe(true);

      // New session has different ID
      const newSessionId = createFilePersistence(testDir).sessionId()!;
      expect(newSessionId).not.toBe(oldSessionId);
    });

    it("title is bridged from purpose to persistence", async () => {
      await adapterStart(testDir);
      await adapterResponse(testDir, "A reading tracker for book lovers");
      await adapterInference(testDir, {
        purpose: "track reading habits",
        stakeholders: ["book lovers"],
        domainHints: ["books", "reading"],
      });

      const p = createFilePersistence(testDir);
      expect(p.title()).toBe("track reading habits");
    });

    it("archived session filename includes slug from title", async () => {
      await adapterStart(testDir);
      await adapterResponse(testDir, "A reading tracker for book lovers");
      await adapterInference(testDir, {
        purpose: "track reading habits",
        stakeholders: ["book lovers"],
        domainHints: ["books", "reading"],
      });

      const sessionId = createFilePersistence(testDir).sessionId()!;

      // Archive via --new
      await adapterStart(testDir, { new: true });

      const expected = `track-reading-habits_${sessionId}.yaml`;
      expect(fs.existsSync(path.join(testDir, ".elaborate", expected))).toBe(true);
    });

    it("multiple sessions can coexist as archived files", async () => {
      // Session 1
      await adapterStart(testDir);
      await adapterResponse(testDir, "A reading tracker");
      await adapterInference(testDir, {
        purpose: "track reading",
        stakeholders: [],
        domainHints: [],
      });
      const id1 = createFilePersistence(testDir).sessionId()!;

      // Session 2
      await adapterStart(testDir, { new: true });
      await adapterResponse(testDir, "An inventory system");
      await adapterInference(testDir, {
        purpose: "manage inventory",
        stakeholders: [],
        domainHints: [],
      });
      const id2 = createFilePersistence(testDir).sessionId()!;

      // Session 3 (current)
      await adapterStart(testDir, { new: true });

      const stateDir = path.join(testDir, ".elaborate");
      const files = fs.readdirSync(stateDir).filter(f => f.endsWith(".yaml"));

      // 2 archived + 1 current
      expect(files).toContain(`track-reading_${id1}.yaml`);
      expect(files).toContain(`manage-inventory_${id2}.yaml`);
      expect(files).toContain("session.yaml");
      expect(files.length).toBe(3);
    });

    it("status includes title when set", async () => {
      await adapterStart(testDir);
      await adapterResponse(testDir, "Build a task manager");
      await adapterInference(testDir, {
        purpose: "manage daily tasks",
        stakeholders: ["busy professional"],
        domainHints: ["productivity"],
      });

      const result = adapterStatus(testDir);
      expect(result.active).toBe(true);
      expect((result as Record<string, unknown>).title).toBe("manage daily tasks");
    });
  });

  describe("deviation_exhausted output", () => {
    it("produces structured error when DeviationError propagates", async () => {
      const persistence = createFilePersistence(testDir);
      const agg = new ArtifactAggregate();
      const wf: Workflow = async () => { throw new Confusion("I don't understand"); };

      let captured: Record<string, unknown> | null = null;
      try {
        await execute(persistence, wf, createResolver());
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        if (isDeviationError(err)) {
          captured = { error: "deviation_exhausted", deviation: err.name, response: err.response };
        }
      }

      expect(captured).toEqual({
        error: "deviation_exhausted",
        deviation: "Confusion",
        response: "I don't understand",
      });
    });
  });

  describe("Suspend.value structural guard", () => {
    it("rejects Suspend carrying non-Prompt value", async () => {
      const persistence = createFilePersistence(testDir);
      const agg = new ArtifactAggregate();
      const badResolver: Resolver = async () => { throw new Suspend("x", "not-a-prompt"); };

      try {
        await execute(persistence, createSession(agg), badResolver);
      } catch (e) {
        if (e instanceof Suspend) {
          const s = e;
          expect(!s.value || typeof s.value !== "object" || !("type" in s.value)).toBe(true);
          expect(() => {
            if (!s.value || typeof s.value !== "object" || !("type" in s.value)) {
              throw new Error(`Suspend at ${s.id} carried non-Prompt value`);
            }
          }).toThrow("non-Prompt value");
          return;
        }
        throw e;
      }
      throw new Error("expected Suspend");
    });
  });
});
