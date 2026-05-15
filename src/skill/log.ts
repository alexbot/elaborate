/**
 * Opt-in structured logging for the adapter layer.
 *
 * Enabled by a `.log` marker file in the skill directory. When active, appends
 * structured JSONL entries to `.elaborate/log.jsonl`. When inactive, returns a
 * no-op logger (null-object pattern).
 *
 * Observation boundary: the logger captures adapter-level and framework-observable
 * events without injecting into the durable replay loop. See ADR: logging.
 */

import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

export type LogContext = Record<string, unknown>;

export interface Logger {
  info(fields: Record<string, unknown>, message?: string): void;
  error(fields: Record<string, unknown>, message?: string): void;
}

export const noopLogger: Logger = {
  info() {},
  error() {},
};

function resolveContext(ctx: LogContext | null): Record<string, unknown> {
  if (!ctx) return {};
  const resolved: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(ctx)) {
    resolved[key] = typeof value === "function" ? value() : value;
  }
  return resolved;
}

export function createLogger(
  markerDir: string,
  logDir: string,
  context: LogContext | null,
): Logger {
  const markerPath = join(markerDir, ".log");
  if (!existsSync(markerPath)) return noopLogger;

  const logPath = join(logDir, ".elaborate", "log.jsonl");
  mkdirSync(dirname(logPath), { recursive: true });

  function write(
    level: "info" | "error",
    fields: Record<string, unknown>,
    message?: string,
  ): void {
    const entry: Record<string, unknown> = {
      v: 1,
      ts: new Date().toISOString(),
      level,
      ...resolveContext(context),
      ...fields,
    };
    if (message !== undefined) entry.msg = message;
    appendFileSync(logPath, JSON.stringify(entry) + "\n");
  }

  return {
    info(fields, message) {
      write("info", fields, message);
    },
    error(fields, message) {
      write("error", fields, message);
    },
  };
}
