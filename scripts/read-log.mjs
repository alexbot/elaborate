/**
 * Render .elaborate/log.jsonl as a human-readable transcript.
 *
 * Usage:
 *   node scripts/read-log.mjs [--session <id>] [--log <path>] [--debug]
 *
 * Defaults: latest session in .elaborate/log.jsonl, debug off.
 */

import { readFileSync } from "node:fs";

const args = process.argv.slice(2);

function getArg(name) {
  const eq = args.find((a) => a.startsWith(`${name}=`));
  if (eq) return eq.slice(name.length + 1);
  const idx = args.indexOf(name);
  if (idx !== -1 && idx + 1 < args.length) return args[idx + 1];
  return undefined;
}

const logPath = getArg("--log") ?? ".elaborate/log.jsonl";
const sessionOverride = getArg("--session");
const debug = args.includes("--debug");

let raw;
try {
  raw = readFileSync(logPath, "utf8");
} catch (e) {
  console.error(`Could not read ${logPath}: ${e.message}`);
  process.exit(1);
}

const entries = [];
for (const line of raw.split("\n")) {
  if (!line.trim()) continue;
  try {
    entries.push(JSON.parse(line));
  } catch {
    // skip malformed
  }
}

if (entries.length === 0) {
  console.error(`No parseable entries in ${logPath}`);
  process.exit(1);
}

const sessionId = sessionOverride ?? entries[entries.length - 1].sessionId;
const session = entries.filter((e) => e.sessionId === sessionId);

if (session.length === 0) {
  console.error(`No entries for session ${sessionId}`);
  process.exit(1);
}

const PHASE_NAMES = {
  opening: "Opening",
  purpose: "Purpose",
  goal: "Goals",
  goals: "Goals",
  stakeholder: "Stakeholders",
  stakeholders: "Stakeholders",
  scope: "Scope",
  assumption: "Assumptions",
  assumptions: "Assumptions",
  validation: "Validation",
};

function phaseOf(id) {
  if (!id) return null;
  const prefix = id.split("-")[0];
  return PHASE_NAMES[prefix] ?? null;
}

function truncate(s, n = 100) {
  if (typeof s !== "string") return s;
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

function formatValue(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") {
    const t = v.trim();
    return t.length ? truncate(t) : null;
  }
  if (Array.isArray(v)) {
    if (v.length === 0) return null;
    const parts = v.map((x) => {
      if (typeof x === "string") return truncate(x, 60);
      if (x && typeof x === "object") return JSON.stringify(x).slice(0, 60);
      return String(x);
    });
    return `[${parts.join(", ")}]`;
  }
  if (typeof v === "object") return truncate(JSON.stringify(v), 120);
  return String(v);
}

function formatData(data) {
  if (!data || typeof data !== "object") return String(data);
  const parts = [];
  for (const [k, v] of Object.entries(data)) {
    const formatted = formatValue(v);
    if (formatted === null) continue;
    if (typeof v === "boolean" && v === false) continue;
    parts.push(`${k}=${formatted}`);
  }
  return parts.length ? parts.join(", ") : "(nothing extracted)";
}

function stripPhasePrefix(message) {
  return message.replace(/^\[\d+\/\d+ [^\]]+\]\s*/, "");
}

function clean(text) {
  return String(text ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .join("\n");
}

function quote(text) {
  const cleaned = clean(text);
  if (!cleaned) return "";
  return cleaned
    .split("\n")
    .map((l) => `> ${l}`)
    .join("\n");
}

const KINDS = new Set([
  "composition",
  "extraction",
  "reextraction",
  "classification",
  "check",
]);

/**
 * Derive an operation description from the prompt id.
 * The kind is always the last matching token in the id; tokens before it
 * are phase/substep context and tokens after are detail.
 */
function askedFrom(id, _inferPrompt, schema) {
  const parts = id.split("-");
  const phase = PHASE_NAMES[parts[0]]?.toLowerCase() ?? parts[0];
  const kindIdx = parts.findLastIndex((p) => KINDS.has(p));
  const kind = kindIdx >= 0 ? parts[kindIdx] : null;
  const detail = parts
    .slice(kindIdx + 1)
    .filter((p) => !/^\d+$/.test(p) && !/^[a-z]+_\d+$/.test(p) && !/^r\d+$/.test(p))
    .join(" ");
  const before = kindIdx > 0 ? parts[kindIdx - 1] : null;
  const isSeed = parts.includes("seed");
  const isBrownfield = parts.includes("brownfield");

  let base;
  switch (kind) {
    case "composition":
      base = detail ? `compose a question about ${detail}` : `compose a ${phase} question`;
      break;
    case "extraction":
      if (isBrownfield) base = "extract brownfield context from the response";
      else if (isSeed) base = `seed initial ${phase}`;
      else base = detail ? `extract from the response about ${detail}` : `extract ${phase} fields`;
      break;
    case "reextraction":
      base = before && before !== "initial"
        ? `re-extract ${phase} after ${before}`
        : `re-extract ${phase} fields`;
      break;
    case "classification":
      if (isBrownfield) base = "classify whether this is a brownfield project";
      else if (isSeed) base = `classify the ${phase} seed response`;
      else base = `classify the ${phase} response`;
      break;
    case "check":
      if (before === "contradiction") base = `check for ${phase} contradictions`;
      else if (before === "consistency") base = `check ${phase} consistency`;
      else base = `check ${phase}${before ? ` ${before}` : ""}`;
      break;
    default:
      base = `infer about ${id}`;
  }

  if (debug && schema) {
    const keys = Object.keys(schema).join(", ");
    if (keys) base += ` — schema: {${keys}}`;
  }
  return base;
}

/**
 * Derive an "I am answering" description from resolved infer data.
 * Composition calls return {question, suggestions} — render specially.
 */
function answeredFrom(id, data) {
  if (!data || typeof data !== "object") return String(data);
  if (id.includes("composition") && typeof data.question === "string") {
    const q = truncate(stripPhasePrefix(data.question), 120);
    const count = Array.isArray(data.suggestions) ? data.suggestions.length : 0;
    return count ? `"${q}" with ${count} suggestion${count === 1 ? "" : "s"}` : `"${q}"`;
  }
  return formatData(data);
}

// Dedup suspends by id (keep first). Build a map of resolves by id.
const firstSuspendByid = new Map();
const resolveByid = new Map();
const ordered = [];

for (const e of session) {
  if (e.event === "suspend") {
    if (!firstSuspendByid.has(e.id)) {
      firstSuspendByid.set(e.id, e);
      ordered.push({ kind: "suspend", entry: e });
    }
    continue;
  }
  if (e.event === "resolve") {
    resolveByid.set(e.id, e);
    ordered.push({ kind: "resolve", entry: e });
    continue;
  }
  // Meta events: error, fidelity:*, recover:*
  ordered.push({ kind: "meta", entry: e });
}

let currentPhase = null;
const lines = [];

function emitPhaseIfChanged(id) {
  const phase = phaseOf(id);
  if (phase && phase !== currentPhase) {
    lines.push(`──────── ${phase} ────────`);
    currentPhase = phase;
  }
}

const consumedResolveIds = new Set();

for (const item of ordered) {
  const e = item.entry;

  if (item.kind === "suspend") {
    emitPhaseIfChanged(e.id);
    if (e.type === "prompt") {
      lines.push(clean(stripPhasePrefix(e.promptMessage ?? "")));
    } else {
      const asked = askedFrom(e.id, e.promptMessage, e.schema);
      const resolve = resolveByid.get(e.id);
      if (resolve && resolve.type === "infer") {
        const answered = answeredFrom(e.id, resolve.data);
        lines.push(`[${asked}: ${answered}]`);
        consumedResolveIds.add(e.id);
      } else {
        lines.push(`[${asked}]`);
      }
    }
    continue;
  }

  if (item.kind === "resolve") {
    if (e.type === "prompt") {
      lines.push(quote(e.message ?? ""));
    } else if (!consumedResolveIds.has(e.id)) {
      lines.push(`[${answeredFrom(e.id, e.data)}]`);
    }
    continue;
  }

  // meta
  if (!debug) continue;
  if (e.event === "fidelity:mismatch") {
    const missing = Array.isArray(e.missingKeys) ? e.missingKeys.join(", ") : "";
    lines.push(`sys: fidelity mismatch on ${e.id}${missing ? ` (missing: ${missing})` : ""}`);
  } else if (e.event === "fidelity:summary") {
    lines.push(`sys: fidelity summary — ${e.mismatched}/${e.checked} extractions had missing keys`);
  } else if (e.event === "error") {
    lines.push(`sys: error — ${e.msg ?? ""}`);
  } else if (e.event === "recover:archive-corrupted") {
    lines.push(`sys: archived corrupted session → ${e.archived}`);
  } else {
    lines.push(`sys: ${e.event}`);
  }
}

console.log(`Session: ${sessionId}`);
if (session[0]?.ts) console.log(`Started: ${session[0].ts}`);
console.log("");
console.log(lines.join("\n\n"));
