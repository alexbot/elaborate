import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { createLogger, noopLogger } from "../log.js";

let markerDir: string;
let logDir: string;

beforeEach(() => {
  markerDir = fs.mkdtempSync(path.join(os.tmpdir(), "eli-marker-"));
  logDir = fs.mkdtempSync(path.join(os.tmpdir(), "eli-log-"));
});

afterEach(() => {
  fs.rmSync(markerDir, { recursive: true, force: true });
  fs.rmSync(logDir, { recursive: true, force: true });
});

function eliDir(): string {
  return path.join(logDir, ".elaborate");
}

function enableLogging(): void {
  fs.writeFileSync(path.join(markerDir, ".log"), "");
  fs.mkdirSync(eliDir(), { recursive: true });
}

function readEntries(): Record<string, unknown>[] {
  const content = fs.readFileSync(path.join(eliDir(), "log.jsonl"), "utf-8");
  return content.trim().split("\n").map((line) => JSON.parse(line));
}

describe("createLogger", () => {
  it("returns noop when .log marker is absent", () => {
    const log = createLogger(markerDir, logDir, null);
    log.info({ event: "test" });
    expect(fs.existsSync(path.join(eliDir(), "log.jsonl"))).toBe(false);
  });

  it("returns active logger when .log marker is present", () => {
    enableLogging();
    const log = createLogger(markerDir, logDir, null);
    log.info({ event: "test" });
    expect(fs.existsSync(path.join(eliDir(), "log.jsonl"))).toBe(true);
  });

  it("marker dir and log dir are independent", () => {
    enableLogging();
    const log = createLogger(markerDir, logDir, null);
    log.info({ event: "test" });
    // marker lives in markerDir, log lives in logDir/.elaborate/
    expect(fs.existsSync(path.join(markerDir, ".log"))).toBe(true);
    expect(fs.existsSync(path.join(eliDir(), "log.jsonl"))).toBe(true);
    expect(fs.existsSync(path.join(markerDir, ".elaborate", "log.jsonl"))).toBe(false);
  });
});

describe("noopLogger", () => {
  it("has info and error as no-ops", () => {
    expect(() => {
      noopLogger.info({ event: "test" });
      noopLogger.error({ event: "test" }, "message");
    }).not.toThrow();
  });
});

describe("active logger", () => {
  it("writes entries with v, ts, and level fields", () => {
    enableLogging();
    const log = createLogger(markerDir, logDir, null);
    log.info({ event: "test" });

    const entries = readEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].v).toBe(1);
    expect(entries[0].level).toBe("info");
    expect(entries[0].ts).toBeDefined();
  });

  it("includes message as msg field when provided", () => {
    enableLogging();
    const log = createLogger(markerDir, logDir, null);
    log.info({ event: "test" }, "hello world");

    const entry = readEntries()[0];
    expect(entry.msg).toBe("hello world");
  });

  it("omits msg field when message not provided", () => {
    enableLogging();
    const log = createLogger(markerDir, logDir, null);
    log.info({ event: "test" });

    const entry = readEntries()[0];
    expect(entry.msg).toBeUndefined();
  });

  it("error method sets level to error", () => {
    enableLogging();
    const log = createLogger(markerDir, logDir, null);
    log.error({ event: "crash" }, "something broke");

    const entry = readEntries()[0];
    expect(entry.level).toBe("error");
    expect(entry.event).toBe("crash");
    expect(entry.msg).toBe("something broke");
  });

  it("includes static context values in every entry", () => {
    enableLogging();
    const log = createLogger(markerDir, logDir, { env: "test", version: 42 });
    log.info({ event: "a" });
    log.info({ event: "b" });

    const entries = readEntries();
    expect(entries[0].env).toBe("test");
    expect(entries[0].version).toBe(42);
    expect(entries[1].env).toBe("test");
    expect(entries[1].version).toBe(42);
  });

  it("evaluates function context values at log time", () => {
    enableLogging();
    let sessionId: string | null = null;
    const log = createLogger(markerDir, logDir, { sessionId: () => sessionId });

    log.info({ event: "before" });
    sessionId = "sess_created";
    log.info({ event: "after" });

    const entries = readEntries();
    expect(entries[0].sessionId).toBeNull();
    expect(entries[1].sessionId).toBe("sess_created");
  });

  it("spreads fields into entry", () => {
    enableLogging();
    const log = createLogger(markerDir, logDir, null);
    log.info({ event: "resolve", id: "opening:greet", type: "prompt", message: "hello" });

    const entry = readEntries()[0];
    expect(entry.event).toBe("resolve");
    expect(entry.id).toBe("opening:greet");
    expect(entry.type).toBe("prompt");
    expect(entry.message).toBe("hello");
  });

  it("appends multiple entries across calls", () => {
    enableLogging();
    const log = createLogger(markerDir, logDir, null);
    log.info({ event: "invoke" });
    log.info({ event: "replay" });
    log.info({ event: "suspend" });
    log.error({ event: "error" }, "fail");

    const entries = readEntries();
    expect(entries).toHaveLength(4);
    expect(entries.map((e) => e.event)).toEqual(["invoke", "replay", "suspend", "error"]);
    expect(entries.map((e) => e.level)).toEqual(["info", "info", "info", "error"]);
  });

  it("creates .elaborate directory when missing", () => {
    fs.writeFileSync(path.join(markerDir, ".log"), "");
    // Do NOT create .elaborate dir — logger should create it via mkdirSync
    expect(fs.existsSync(eliDir())).toBe(false);

    const log = createLogger(markerDir, logDir, null);
    log.info({ event: "test" });

    expect(fs.existsSync(eliDir())).toBe(true);
    expect(fs.existsSync(path.join(eliDir(), "log.jsonl"))).toBe(true);
  });
});
