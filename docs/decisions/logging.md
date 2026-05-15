---
title: Opt-in structured logging at adapter boundary
status: accepted
---

## Context

The adapter is a short-lived CLI process. Each invocation runs, outputs JSON to stdout, and exits. Without logging, the exchange is ephemeral — internal framework behavior (replay, resolution, suspension, errors) and I/O content are invisible after the process exits.

Host environments (Claude Code, Codex) may capture external I/O, but this cannot be relied upon: not all hosts log (Cursor), host logging is not correlated with internal framework events, and non-skill contexts (integration tests, standalone) have no host at all. A self-contained log is more useful than piecing together two sources.

The durable execution ADR establishes that workflow functions must be deterministic — no side effects outside `infer`/`prompt`/`call`. Injecting logging into the durable framework would violate this constraint and fire spuriously during replay.

Two existing precedents inform the design:

1. **`.debug` marker file** — dropping `.debug` next to the bundle attaches a Node inspector. Same activation pattern (marker file = opt-in), different mechanism (interactive vs passive).
2. **Session state as implicit trace** — `.elaborate/session.yaml` contains the full entry log (completed + suspended calls). This is the truth for *what happened*, but not *how* (timing, replay behavior, resolution path, errors) or *what was said* (prompt messages, extraction data).

## Decision

### 1. Opt-in activation

A `.log` marker file in the skill directory (next to the bundle) enables logging. When absent, the logger is a no-op (null-object pattern — zero overhead). The marker file's contents are ignored for now but designed to carry configuration later (log level, retention).

This aligns with the `.debug` marker — both live in the skill directory, both use the same activation pattern (drop a file to opt in). The skill directory always exists; `.elaborate/` may not (it's created on first session). The marker file's contents are ignored for now but designed to carry configuration later (log level, retention).

Rationale for opt-in: in normal operation nobody reads the log. Writing files by default adds friction without value. Opt-in via marker file is zero-config when disabled and trivial to enable.

### 2. File sink

Log entries append to `.elaborate/log.jsonl`. Not stdout (contaminates the skill-agent communication channel). Not stderr (ephemeral — lost between invocations, cannot correlate across a multi-turn session).

File I/O uses `appendFileSync`. The oneshot process model (3-5 writes per invocation) makes buffering, locking, and connection management unnecessary. Long-lived test processes also work correctly — `appendFileSync` is safe for both patterns.

### 3. Adapter as observation boundary

The logger lives in `src/skill/log.ts`, called from `src/skill/adapter.ts`. It observes framework behavior through the persistence interface and exception types — never injecting into the durable replay loop.

```
Adapter ← observation point
─────────────────────────────
Durable framework (deterministic, no side effects)
─────────────────────────────
Workflow phases (pure logic)
```

### 4. Self-contained I/O content

The log captures full I/O content: user messages (prompt resolution), agent extraction data (infer resolution), outgoing prompt messages and schemas (suspension). This makes the log file a complete record of the conversation regardless of host environment. The cost is a few extra KB per session — negligible.

### 5. Structured logging with generic interface

The `Logger` interface has two methods: `info(fields, message?)` and `error(fields, message?)`. Fields are structured key-value objects. The interface is stable — new event types are new field values, not new methods.

Context (session ID, etc.) is injected at creation time as a record where function values are evaluated lazily at log time. This handles cases where context changes mid-invocation (e.g., session created during `start`).

### 6. JSONL format

Each line is a self-contained JSON object:

```json
{"v":1,"ts":"2026-03-01T14:30:00.123Z","level":"info","sessionId":"sess_2026-03-01_abc123","event":"invoke","command":"response","args":["--message=hello"]}
```

Fixed fields: `v` (format version), `ts` (ISO timestamp), `level` (`info`|`error`). Context fields (e.g., `sessionId`) from the injected context record. Event-specific fields from the `fields` parameter.

## Consequences

**Positive:**

- Self-contained log — usable in any environment (skill, test, standalone) without depending on host logging.
- Debugging without attaching a Node inspector — lighter, persistent, correlatable across invocations.
- Zero overhead when disabled (null-object pattern, no marker file check per call).
- Generic interface — adding new event types requires no interface changes.
- Format versioning (`v: 1`) enables future schema evolution without breaking existing parsers.

**Negative:**

- Manual opt-in means the log won't exist when you first encounter an unexpected error. Must reproduce with logging enabled, or rely on session state for post-mortem.
- Log file accumulates across sessions without retention policy. Acceptable for development use; retention configuration is a future concern for production-like scenarios.
