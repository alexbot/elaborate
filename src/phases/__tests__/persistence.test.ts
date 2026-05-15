import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { createFilePersistence, archiveSession, archiveCorrupted, CorruptedSessionError, slugify } from "../session/index.js";

describe("FilePersistence", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), "eli-persistence-test-"));
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  const sessionPath = () => path.join(testDir, ".elaborate", "session.yaml");
  const tmpPath = () => path.join(testDir, ".elaborate", "session.yaml.tmp");

  describe("atomic writes", () => {
    it("does not leave .tmp file after save", () => {
      const p = createFilePersistence(testDir);
      p.initialize();

      expect(fs.existsSync(sessionPath())).toBe(true);
      expect(fs.existsSync(tmpPath())).toBe(false);
    });

    it("preserves session file content through save", () => {
      const p = createFilePersistence(testDir);
      p.initialize();
      p.save({ status: "suspended", entries: [{ id: "a", suspended: true as const }] });

      const p2 = createFilePersistence(testDir);
      const state = p2.load();
      expect(state?.status).toBe("suspended");
      expect(state?.entries).toEqual([{ id: "a", suspended: true }]);
    });
  });

  describe("stale .tmp cleanup", () => {
    it("deletes orphan .tmp on load", () => {
      const p = createFilePersistence(testDir);
      p.initialize();

      // Simulate crash: create orphan .tmp
      fs.writeFileSync(tmpPath(), "stale data");
      expect(fs.existsSync(tmpPath())).toBe(true);

      // Load should clean it up
      const p2 = createFilePersistence(testDir);
      p2.load();
      expect(fs.existsSync(tmpPath())).toBe(false);
    });

    it("deletes orphan .tmp even when no session file exists", () => {
      fs.mkdirSync(path.join(testDir, ".elaborate"), { recursive: true });
      fs.writeFileSync(tmpPath(), "stale data");

      const p = createFilePersistence(testDir);
      const result = p.load();
      expect(result).toBeNull();
      expect(fs.existsSync(tmpPath())).toBe(false);
    });

    it("promotes valid .tmp when yaml is missing (rename interrupted before write to yaml)", () => {
      // Simulate: atomic save wrote a valid tmp, but the process crashed
      // before `rename tmp → yaml` could execute.
      fs.mkdirSync(path.join(testDir, ".elaborate"), { recursive: true });
      const validYaml = [
        "sessionId: sess_recovered",
        "createdAt: '2026-01-01T00:00:00.000Z'",
        "lastModified: '2026-01-01T00:00:00.000Z'",
        "workflow:",
        "  status: suspended",
        "  entries:",
        "    - id: step1",
        "      suspended: true",
      ].join("\n");
      fs.writeFileSync(tmpPath(), validYaml);

      const p = createFilePersistence(testDir);
      const result = p.load();

      expect(result?.status).toBe("suspended");
      expect(result?.entries).toEqual([{ id: "step1", suspended: true }]);
      expect(fs.existsSync(sessionPath())).toBe(true);
      expect(fs.existsSync(tmpPath())).toBe(false);
    });

    it("promotes valid .tmp over an older yaml (rename interrupted)", () => {
      // Simulate: save() wrote a newer valid tmp, older yaml still present,
      // rename was interrupted.
      const p = createFilePersistence(testDir);
      p.initialize();
      p.save({ status: "running", entries: [{ id: "old", value: "old-state" }] });

      const newerYaml = [
        "sessionId: sess_newer",
        "createdAt: '2026-02-01T00:00:00.000Z'",
        "lastModified: '2026-02-01T00:00:00.000Z'",
        "workflow:",
        "  status: suspended",
        "  entries:",
        "    - id: new",
        "      suspended: true",
      ].join("\n");
      fs.writeFileSync(tmpPath(), newerYaml);

      const p2 = createFilePersistence(testDir);
      const result = p2.load();

      expect(result?.status).toBe("suspended");
      expect(result?.entries).toEqual([{ id: "new", suspended: true }]);
      expect(fs.existsSync(tmpPath())).toBe(false);
      expect(p2.sessionId()).toBe("sess_newer");
    });
  });

  describe("state validation", () => {
    function writeRaw(content: string): void {
      fs.mkdirSync(path.join(testDir, ".elaborate"), { recursive: true });
      fs.writeFileSync(sessionPath(), content);
    }

    it("rejects non-object YAML", () => {
      writeRaw("just a string");
      const p = createFilePersistence(testDir);
      expect(() => p.load()).toThrow("not an object");
    });

    it("rejects missing sessionId", () => {
      writeRaw("workflow: null\n");
      const p = createFilePersistence(testDir);
      expect(() => p.load()).toThrow("missing sessionId");
    });

    it("rejects invalid workflow status", () => {
      writeRaw("sessionId: test\nworkflow:\n  status: bogus\n  entries: []\n");
      const p = createFilePersistence(testDir);
      expect(() => p.load()).toThrow("invalid workflow status");
    });

    it("rejects workflow with non-array entries", () => {
      writeRaw("sessionId: test\nworkflow:\n  status: running\n  entries: notarray\n");
      const p = createFilePersistence(testDir);
      expect(() => p.load()).toThrow("entries not an array");
    });

    it("rejects entry without id", () => {
      writeRaw("sessionId: test\nworkflow:\n  status: running\n  entries:\n    - value: 42\n");
      const p = createFilePersistence(testDir);
      expect(() => p.load()).toThrow("entry 0 missing id");
    });

    it("rejects entry without value or suspended", () => {
      writeRaw("sessionId: test\nworkflow:\n  status: running\n  entries:\n    - id: step1\n");
      const p = createFilePersistence(testDir);
      expect(() => p.load()).toThrow("entry 0 missing value or suspended");
    });

    it("accepts valid session file", () => {
      writeRaw("sessionId: test\nworkflow:\n  status: running\n  entries:\n    - id: step1\n      value: hello\n");
      const p = createFilePersistence(testDir);
      const state = p.load();
      expect(state?.status).toBe("running");
      expect(state?.entries[0]).toEqual({ id: "step1", value: "hello" });
    });

    it("accepts session with null workflow", () => {
      writeRaw("sessionId: test\nworkflow: null\ncreatedAt: '2026-01-01'\nlastModified: '2026-01-01'\n");
      const p = createFilePersistence(testDir);
      expect(p.load()).toBeNull();
    });
  });

  describe("corruption recovery (F023)", () => {
    function writeRaw(content: string): void {
      fs.mkdirSync(path.join(testDir, ".elaborate"), { recursive: true });
      fs.writeFileSync(sessionPath(), content);
    }

    it("throws CorruptedSessionError on malformed YAML", () => {
      writeRaw(": not valid yaml\n  -- [garbage");
      const p = createFilePersistence(testDir);
      expect(() => p.load()).toThrow(CorruptedSessionError);
    });

    it("CorruptedSessionError extends Error and carries file path", () => {
      writeRaw("just a string");
      const p = createFilePersistence(testDir);
      try {
        p.load();
        expect.fail("expected throw");
      } catch (e) {
        expect(e).toBeInstanceOf(CorruptedSessionError);
        expect(e).toBeInstanceOf(Error);
        if (e instanceof CorruptedSessionError) expect(e.file).toBe(sessionPath());
      }
    });

    it("hasSession returns true even when session file is corrupt", () => {
      // Previously hasSession called loadFile → threw → recovery commands
      // became unreachable. It now does a pure existence check.
      writeRaw(": not valid yaml\n");
      const p = createFilePersistence(testDir);
      expect(p.hasSession()).toBe(true);
    });

    it("archiveCorrupted renames session.yaml with a timestamped suffix", () => {
      writeRaw("corrupt content");
      const archived = archiveCorrupted(testDir);
      expect(archived).toMatch(/^session\.yaml\.corrupt\.\d{4}-\d{2}-\d{2}T/);
      expect(fs.existsSync(sessionPath())).toBe(false);
      expect(fs.existsSync(path.join(testDir, ".elaborate", archived!))).toBe(true);
    });

    it("archiveCorrupted returns null when no session file exists", () => {
      expect(archiveCorrupted(testDir)).toBeNull();
    });

    it("full recovery flow: corrupt file → archive → fresh session", () => {
      writeRaw(": not valid yaml\n");
      const p = createFilePersistence(testDir);

      // Initial state: hasSession=true but load throws
      expect(p.hasSession()).toBe(true);
      expect(() => p.load()).toThrow(CorruptedSessionError);

      // Recovery: archive and initialize fresh
      archiveCorrupted(testDir);
      expect(p.hasSession()).toBe(false);

      const p2 = createFilePersistence(testDir);
      p2.initialize();
      expect(p2.load()?.status).toBe("running");
      expect(p2.sessionId()).toMatch(/^sess_/);
    });
  });

  describe("status()", () => {
    it("returns null when no session", () => {
      const p = createFilePersistence(testDir);
      expect(p.status()).toBeNull();
    });

    it("returns running after initialize", () => {
      const p = createFilePersistence(testDir);
      p.initialize();
      expect(p.status()).toBe("running");
    });

    it("returns failed after setStatus", () => {
      const p = createFilePersistence(testDir);
      p.initialize();
      p.setStatus("failed");
      expect(p.status()).toBe("failed");
    });

    it("returns completed after setStatus", () => {
      const p = createFilePersistence(testDir);
      p.initialize();
      p.setStatus("completed");
      expect(p.status()).toBe("completed");
    });
  });

  describe("userConcern", () => {
    it("returns undefined when no session", () => {
      const p = createFilePersistence(testDir);
      expect(p.userConcern()).toBeUndefined();
    });

    it("returns undefined when no concern set", () => {
      const p = createFilePersistence(testDir);
      p.initialize();
      expect(p.userConcern()).toBeUndefined();
    });

    it("round-trips through setUserConcern", () => {
      const p = createFilePersistence(testDir);
      p.initialize();
      p.setUserConcern("Scope is too broad");
      expect(p.userConcern()).toBe("Scope is too broad");
    });

    it("survives across persistence instances", () => {
      const p = createFilePersistence(testDir);
      p.initialize();
      p.setUserConcern("Missing stakeholder analysis");

      const p2 = createFilePersistence(testDir);
      expect(p2.userConcern()).toBe("Missing stakeholder analysis");
    });
  });

  describe("title", () => {
    it("returns undefined when no session", () => {
      const p = createFilePersistence(testDir);
      expect(p.title()).toBeUndefined();
    });

    it("returns undefined when no title set", () => {
      const p = createFilePersistence(testDir);
      p.initialize();
      expect(p.title()).toBeUndefined();
    });

    it("round-trips through setTitle", () => {
      const p = createFilePersistence(testDir);
      p.initialize();
      p.setTitle("track reading habits");
      expect(p.title()).toBe("track reading habits");
    });

    it("survives across persistence instances", () => {
      const p = createFilePersistence(testDir);
      p.initialize();
      p.setTitle("inventory management");

      const p2 = createFilePersistence(testDir);
      expect(p2.title()).toBe("inventory management");
    });
  });

  describe("slugify", () => {
    it("lowercases and replaces spaces with hyphens", () => {
      expect(slugify("Track Reading Habits")).toBe("track-reading-habits");
    });

    it("strips non-alphanumeric characters", () => {
      expect(slugify("Build a B2B SaaS (v2)")).toBe("build-a-b2b-saas-v2");
    });

    it("collapses multiple hyphens", () => {
      expect(slugify("one --- two")).toBe("one-two");
    });

    it("trims leading and trailing hyphens", () => {
      expect(slugify("  hello world  ")).toBe("hello-world");
    });

    it("handles empty string", () => {
      expect(slugify("")).toBe("");
    });

    it("truncates long titles to 80 characters", () => {
      const long = "building a recycling center locator app basically a mobile tool that helps residents find nearby drop off points for recyclables";
      const result = slugify(long);
      expect(result.length).toBeLessThanOrEqual(80);
      expect(result).not.toMatch(/-$/);
    });
  });

  describe("archiveSession", () => {
    it("returns null when no session exists", () => {
      expect(archiveSession(testDir)).toBeNull();
    });

    it("renames session file using session ID when no title", () => {
      const p = createFilePersistence(testDir);
      p.initialize();
      const sessionId = p.sessionId()!;

      const name = archiveSession(testDir);
      expect(name).toBe(`${sessionId}.yaml`);
      expect(fs.existsSync(sessionPath())).toBe(false);
      expect(fs.existsSync(path.join(testDir, ".elaborate", name!))).toBe(true);
    });

    it("prefixes slug when title is set", () => {
      const p = createFilePersistence(testDir);
      p.initialize();
      p.setTitle("track reading habits");
      const sessionId = p.sessionId()!;

      const name = archiveSession(testDir);
      expect(name).toBe(`track-reading-habits_${sessionId}.yaml`);
      expect(fs.existsSync(sessionPath())).toBe(false);
      expect(fs.existsSync(path.join(testDir, ".elaborate", name!))).toBe(true);
    });

    it("archived file retains session data", () => {
      const p = createFilePersistence(testDir);
      p.initialize();
      p.setTitle("my project");
      p.save({ status: "completed", entries: [{ id: "s1", value: "v1" }] });

      const name = archiveSession(testDir)!;
      const content = fs.readFileSync(path.join(testDir, ".elaborate", name), "utf-8");
      expect(content).toContain("my project");
      expect(content).toContain("completed");
    });
  });
});
