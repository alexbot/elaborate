import { execSync, spawn, type ChildProcess } from "node:child_process";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { z } from "zod";
import type { T3Driver } from "./driver.js";
import type { Message } from "./types.js";
import { createInterface, type Interface } from "node:readline";

export interface CliDriverOptions {
  model?: string;
  maxRetries?: number;
  timeoutMs?: number;
  /** Keep a single claude process alive across calls (multi-turn). */
  persistent?: boolean;
}

function resolveClaudeCli(): { cmd: string; prefix: string[] } {
  if (process.platform !== "win32") {
    return { cmd: "claude", prefix: [] };
  }
  try {
    const which = execSync("where claude.cmd", { encoding: "utf-8" }).trim().split("\n")[0].trim();
    const dir = which.replace(/claude\.cmd$/i, "");
    const cliJs = `${dir}node_modules\\@anthropic-ai\\claude-code\\cli.js`;
    return { cmd: process.execPath, prefix: [cliJs] };
  } catch {
    return { cmd: "claude", prefix: [] };
  }
}

const resolved = resolveClaudeCli();

interface StreamMessage {
  type: string;
  subtype?: string;
  result?: string;
  structured_output?: unknown;
  is_error?: boolean;
}

interface PersistentClaudeOptions {
  model?: string;
  systemPrompt?: string;
  jsonSchema?: string;
}

class PersistentClaude {
  private proc: ChildProcess | null = null;
  private rl: Interface | null = null;
  private options: PersistentClaudeOptions;
  private started = false;

  constructor(options: PersistentClaudeOptions) {
    this.options = options;
  }

  private alive(): boolean {
    return this.proc !== null && this.proc.exitCode === null && !this.proc.killed;
  }

  private ensureProcess(): { proc: ChildProcess; rl: Interface } {
    if (this.alive()) {
      return { proc: this.proc!, rl: this.rl! };
    }

    this.kill();

    const args = [
      ...resolved.prefix,
      "-p",
      "--no-session-persistence",
      "--tools", "",
      "--input-format", "stream-json",
      "--output-format", "stream-json",
      "--verbose",
    ];
    if (this.options.model) args.push("--model", this.options.model);
    if (this.options.systemPrompt) args.push("--system-prompt", this.options.systemPrompt);
    if (this.options.jsonSchema) args.push("--json-schema", this.options.jsonSchema);

    this.proc = spawn(resolved.cmd, args, {
      stdio: ["pipe", "pipe", "pipe"],
    });

    this.proc.stderr?.on("data", () => {});
    this.proc.stdin?.on("error", () => {});
    this.rl = createInterface({ input: this.proc.stdout! });

    this.proc.on("error", (err) => {
      console.error(`[PersistentClaude] process error: ${err.message}`);
    });

    this.started = false;
    return { proc: this.proc, rl: this.rl };
  }

  async send(text: string, timeoutMs: number): Promise<StreamMessage> {
    const { proc, rl } = this.ensureProcess();

    const msg = JSON.stringify({
      type: "user",
      message: {
        role: "user",
        content: [{ type: "text", text }],
      },
    });

    return new Promise<StreamMessage>((resolve, reject) => {
      let settled = false;
      const settle = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        rl.off("line", onLine);
        rl.off("close", onClose);
        fn();
      };

      const timer = setTimeout(() => {
        settle(() => {
          this.kill();
          reject(new Error(`CLI response timed out after ${timeoutMs}ms`));
        });
      }, timeoutMs);

      const onClose = () => {
        settle(() => reject(new Error("claude process exited before responding")));
      };

      const onLine = (line: string) => {
        let parsed: StreamMessage;
        try { parsed = JSON.parse(line); } catch { return; }

        if (parsed.type === "result") {
          this.started = true;
          if (parsed.is_error) {
            settle(() => reject(new Error(`claude error: ${parsed.result ?? "unknown"}`)));
          } else {
            settle(() => resolve(parsed));
          }
        }
      };

      rl.on("line", onLine);
      rl.on("close", onClose);

      try {
        proc.stdin!.write(msg + "\n");
      } catch (e) {
        settle(() => reject(new Error(`Failed to write to claude stdin: ${e}`)));
      }
    });
  }

  kill() {
    if (this.proc && !this.proc.killed) {
      this.proc.kill();
    }
    this.proc = null;
    this.rl = null;
  }
}

function formatHistory(messages: Message[]): string {
  return messages
    .map((m) => `[${m.role === "user" ? "User" : "Assistant"}]: ${m.content}`)
    .join("\n\n");
}

function runClaudeOneShot(args: string[], timeoutMs: number, stdin: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const fullArgs = [...resolved.prefix, ...args];
    const proc = spawn(resolved.cmd, fullArgs, {
      stdio: ["pipe", "pipe", "pipe"],
      timeout: timeoutMs,
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
    proc.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });

    proc.stdin.write(stdin);
    proc.stdin.end();

    proc.on("error", (err) => reject(new Error(`Failed to spawn claude: ${err.message}`)));
    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`claude exited with code ${code}: ${stderr.slice(0, 500)}`));
      } else {
        resolve(stdout);
      }
    });
  });
}

export function createCliDriver(options?: CliDriverOptions): T3Driver {
  const model = options?.model;
  const maxRetries = options?.maxRetries ?? 2;
  const defaultTimeout = options?.timeoutMs ?? 120_000;
  const persistent = options?.persistent ?? false;

  let chatProc: PersistentClaude | null = null;

  return {
    async chat(system, messages, opts) {
      const timeoutMs = opts?.timeoutMs ?? defaultTimeout;

      if (persistent) {
        if (!chatProc) {
          chatProc = new PersistentClaude({ model, systemPrompt: system });
        }
        const lastMessage = messages[messages.length - 1];
        const result = await chatProc.send(lastMessage.content, timeoutMs);
        return result.result ?? "";
      }

      const prompt = formatHistory(messages);
      const args = ["-p", "--no-session-persistence", "--tools", "", "--system-prompt", system, "--output-format", "text"];
      if (model) args.push("--model", model);
      const result = await runClaudeOneShot(args, timeoutMs, prompt);
      return result.trim();
    },

    async structuredOutput(system, prompt, schema, opts) {
      const timeoutMs = opts?.timeoutMs ?? defaultTimeout;
      const jsonSchema = JSON.stringify(zodToJsonSchema(schema));

      const args = [
        "-p", "--no-session-persistence", "--tools", "",
        "--system-prompt", system,
        "--output-format", "json",
        "--json-schema", jsonSchema,
      ];
      if (model) args.push("--model", model);

      let lastError: Error | undefined;
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          const raw = await runClaudeOneShot(args, timeoutMs, prompt);
          const envelope = JSON.parse(raw);
          const data = envelope.structured_output ?? envelope;
          return schema.parse(data);
        } catch (e) {
          lastError = e instanceof Error ? e : new Error(String(e));
          if (attempt < maxRetries) {
            await new Promise((r) => setTimeout(r, Math.pow(2, attempt) * 1000));
          }
        }
      }
      throw lastError;
    },
  };
}
