/**
 * Session file I/O — atomic read/write, validation, tmp-reconciliation, and
 * session-id generation. The persistence adapter layers business logic on top
 * of these primitives.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import type { WorkflowState } from "../../durable/index.js";

const ELABORATE_DIR = ".elaborate";
const SESSION_FILE = "session.yaml";
const SESSION_TMP = "session.yaml.tmp";
const VALID_STATUSES = new Set<string>(["running", "suspended", "completed", "failed"]);

export interface SessionFile {
  sessionId: string;
  createdAt: string;
  lastModified: string;
  workflow: WorkflowState | null;
  userConcern?: string;
  title?: string;
}

export function getElaborateDir(cwd: string): string {
  return path.join(cwd, ELABORATE_DIR);
}

export function getSessionPath(cwd: string): string {
  return path.join(getElaborateDir(cwd), SESSION_FILE);
}

function ensureDir(cwd: string): void {
  const dir = getElaborateDir(cwd);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function getTmpPath(cwd: string): string {
  return path.join(getElaborateDir(cwd), SESSION_TMP);
}

/**
 * Reconcile .tmp left behind by a crash. If the tmp parses as a valid
 * SessionFile, the crash happened after write-complete but before the rename
 * step — promote it (the rename is effectively resumed). Otherwise the tmp
 * is partial or corrupt from an interrupted write — discard.
 */
function cleanStaleTmp(cwd: string): void {
  const tmp = getTmpPath(cwd);
  if (!fs.existsSync(tmp)) return;
  try {
    const parsed = parseYaml(fs.readFileSync(tmp, "utf-8"));
    validateSessionFile(parsed, tmp);
    fs.renameSync(tmp, getSessionPath(cwd));
  } catch {
    fs.unlinkSync(tmp);
  }
}

/** Validate that parsed YAML has the expected SessionFile structure. */
function validateSessionFile(data: unknown, filePath: string): SessionFile {
  if (data == null || typeof data !== "object")
    throw new Error(`Corrupted session file (not an object): ${filePath}`);

  const obj = data as Record<string, unknown>;

  if (typeof obj.sessionId !== "string")
    throw new Error(`Corrupted session file (missing sessionId): ${filePath}`);

  if (obj.workflow != null) {
    if (typeof obj.workflow !== "object")
      throw new Error(`Corrupted session file (workflow not an object): ${filePath}`);

    const wf = obj.workflow as Record<string, unknown>;
    if (typeof wf.status !== "string" || !VALID_STATUSES.has(wf.status))
      throw new Error(`Corrupted session file (invalid workflow status): ${filePath}`);

    if (!Array.isArray(wf.entries))
      throw new Error(`Corrupted session file (entries not an array): ${filePath}`);

    for (let i = 0; i < wf.entries.length; i++) {
      const entry = wf.entries[i] as Record<string, unknown>;
      if (typeof entry?.id !== "string")
        throw new Error(`Corrupted session file (entry ${i} missing id): ${filePath}`);
      if (!("value" in entry) && entry.suspended !== true)
        throw new Error(`Corrupted session file (entry ${i} missing value or suspended): ${filePath}`);
    }
  }

  return data as SessionFile;
}

/**
 * Thrown when `.elaborate/session.yaml` exists but cannot be parsed or validated.
 * Carries the file path so the adapter can offer a recovery affordance
 * (archive the corrupt file and start fresh via `elaborate start --new`).
 */
export class CorruptedSessionError extends Error {
  readonly file: string;
  constructor(file: string, cause: unknown) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    super(`Corrupted session file: ${file} — ${reason}`);
    this.name = "CorruptedSessionError";
    this.file = file;
  }
}

export function loadFile(cwd: string): SessionFile | null {
  cleanStaleTmp(cwd);
  const p = getSessionPath(cwd);
  if (!fs.existsSync(p)) return null;
  try {
    return validateSessionFile(parseYaml(fs.readFileSync(p, "utf-8")), p);
  } catch (e) {
    throw new CorruptedSessionError(p, e);
  }
}

export function saveFile(cwd: string, data: SessionFile): void {
  ensureDir(cwd);
  data.lastModified = new Date().toISOString();
  const tmp = getTmpPath(cwd);
  fs.writeFileSync(tmp, stringifyYaml(data));
  fs.renameSync(tmp, getSessionPath(cwd));
}

export function generateSessionId(): string {
  const date = new Date().toISOString().slice(0, 10);
  const rand = Math.random().toString(36).slice(2, 8);
  return `sess_${date}_${rand}`;
}

/** Whether a session file exists on disk (no parse). */
export function sessionFileExists(cwd: string): boolean {
  return fs.existsSync(getSessionPath(cwd));
}
