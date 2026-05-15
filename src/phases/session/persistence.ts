/**
 * Session persistence adapter — wraps the durable `StatePersistence` interface
 * with session-metadata accessors (session id, phase, user concern, title).
 *
 * All reads go through `loadFile` on demand; writes go through `saveFile`.
 * Not cached — the single-user CLI hasn't shown a performance need.
 */

import type { StatePersistence, WorkflowState, WorkflowStatus } from "../../durable/index.js";
import { generateSessionId, loadFile, saveFile, sessionFileExists } from "./file.js";

export interface SessionPersistence extends StatePersistence {
  /** Derive current phase from last suspended entry ID prefix */
  phase(): string | null;
  /** Whether a session exists */
  hasSession(): boolean;
  /** Session ID */
  sessionId(): string | null;
  /** Get the ID of the currently suspended call, if any */
  suspendedId(): string | null;
  /** Workflow status (running, suspended, completed, failed) */
  status(): WorkflowStatus | null;
  /** Record the user's concern from validation (absent = endorsed) */
  setUserConcern(concern: string): void;
  /** Retrieve the user's concern, if any */
  userConcern(): string | undefined;
  /** Set a human-readable session title (derived from purpose) */
  setTitle(title: string): void;
  /** Retrieve the session title, if any */
  title(): string | undefined;
}

export function createFilePersistence(cwd: string): SessionPersistence {
  return {
    load(): WorkflowState | null {
      const file = loadFile(cwd);
      return file?.workflow ?? null;
    },

    save(state: WorkflowState): void {
      const existing = loadFile(cwd);
      if (existing) {
        existing.workflow = state;
        saveFile(cwd, existing);
      } else {
        saveFile(cwd, {
          sessionId: generateSessionId(),
          createdAt: new Date().toISOString(),
          lastModified: new Date().toISOString(),
          workflow: state,
        });
      }
    },

    initialize(): void {
      this.save({ status: "running", entries: [] });
    },

    setStatus(status: WorkflowStatus): void {
      const state = this.load();
      if (state) {
        state.status = status;
        this.save(state);
      }
    },

    suspendedId(): string | null {
      const state = this.load();
      if (!state) return null;
      const last = state.entries[state.entries.length - 1];
      if (last && "suspended" in last) return last.id;
      return null;
    },

    phase(): string | null {
      const state = this.load();
      if (!state) return null;
      if (state.status === "completed") return "complete";
      const last = state.entries[state.entries.length - 1];
      if (!last || !("suspended" in last)) return null;
      return last.id.split(/[:\-]/)[0] || null;
    },

    hasSession(): boolean {
      return sessionFileExists(cwd);
    },

    sessionId(): string | null {
      return loadFile(cwd)?.sessionId ?? null;
    },

    status(): WorkflowStatus | null {
      return this.load()?.status ?? null;
    },

    setUserConcern(concern: string): void {
      const file = loadFile(cwd);
      if (file) {
        file.userConcern = concern;
        saveFile(cwd, file);
      }
    },

    userConcern(): string | undefined {
      return loadFile(cwd)?.userConcern;
    },

    setTitle(title: string): void {
      const file = loadFile(cwd);
      if (file) {
        file.title = title;
        saveFile(cwd, file);
      }
    },

    title(): string | undefined {
      return loadFile(cwd)?.title;
    },
  };
}
