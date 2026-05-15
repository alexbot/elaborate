/**
 * Session archival — move session.yaml aside under various conditions:
 * closed sessions (named by slugified title), corrupted sessions (named by
 * timestamp, bypasses parsing).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { getElaborateDir, getSessionPath, loadFile, sessionFileExists } from "./file.js";

const MAX_SLUG_LENGTH = 80;

/** Lowercase, strip non-alphanumeric, collapse to hyphens, trim edges, cap length. */
export function slugify(text: string): string {
  const full = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  if (full.length <= MAX_SLUG_LENGTH) return full;
  const truncated = full.slice(0, MAX_SLUG_LENGTH);
  return truncated.replace(/-$/, "");
}

/**
 * Archive a corrupt session.yaml by renaming it to `session.yaml.corrupt.<timestamp>`.
 * Does not parse — safe to call when `archiveSession` would throw CorruptedSessionError.
 * Returns the archive filename, or null if the session file doesn't exist.
 */
export function archiveCorrupted(cwd: string): string | null {
  if (!sessionFileExists(cwd)) return null;
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const name = `session.yaml.corrupt.${ts}`;
  fs.renameSync(getSessionPath(cwd), path.join(getElaborateDir(cwd), name));
  return name;
}

/**
 * Archive the current session by renaming session.yaml.
 * Returns the archive filename, or null if no session exists.
 */
export function archiveSession(cwd: string): string | null {
  const file = loadFile(cwd);
  if (!file) return null;

  const slug = file.title ? slugify(file.title) : "";
  const name = slug
    ? `${slug}_${file.sessionId}.yaml`
    : `${file.sessionId}.yaml`;

  fs.renameSync(getSessionPath(cwd), path.join(getElaborateDir(cwd), name));
  return name;
}
