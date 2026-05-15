---
title: Integration architecture
status: accepted
---

## Context

Elaborate needs to integrate with LLMs to power its interview conversations. The fundamental question: should Elaborate be a standalone tool, or should it live inside coding assistants (Claude Code, Cursor, Copilot) that developers already use?

Investigation of coding assistant extension mechanisms revealed:

1. **Agent Skills** (agentskills.io, December 2025) provide a cross-platform standard for extending coding assistants. One SKILL.md works across Claude Code, Cursor, Copilot, VS Code, and others.

2. When embedded in a coding assistant, **the host provides the LLM** — no API keys, no separate subscriptions, no LLM abstraction needed.

3. Skills can invoke scripts (TypeScript, Python, bash), enabling a **thin skill layer on top of a proper script**.

A key architectural tension arose: should Elaborate's methodology live in SKILL.md instructions (LLM interprets and follows), or in code (deterministic, testable)? The instructions-only approach has problems:
- Can't unit test markdown
- LLM may deviate from instructions
- Debugging is opaque ("why did it do that?")

## Decision

### 1. Skills as integration mechanism

Elaborate integrates with coding assistants via Agent Skills (agentskills.io standard). The Skill is a **thin orchestration layer** that tells the assistant when and how to invoke Elaborate's script.

### 2. Elaborate script as external TypeScript package

Elaborate's logic (phases, durable execution, artifact validation) lives in a TypeScript package, **external to user projects**. Distributed as a bundled CJS artifact alongside SKILL.md:

```
my-project/
├── .claude/skills/elaborate/
│   ├── SKILL.md          # Thin orchestration layer
│   └── elaborate.cjs     # Bundled adapter + all deps (esbuild)
├── .elaborate/                 # Session state, artifacts
└── (user's code)
```

The bundle includes all dependencies (yaml, zod) — no node_modules pollution, no install step. Works for Python, Go, Rust, any project type.

### 3. File-based state in `.elaborate/`

Session state and artifacts live in the user's repository:
```
.elaborate/
└── session.yaml          # All session data (state, artifacts, conversation)
```

Single session, single file for MVP. Multi-session support later.

This enables:
- Session resume across IDE restarts
- Cross-assistant continuity (start in Claude Code, continue in Cursor)
- Version control of requirements

### 4. Standalone CLI as secondary target

For non-coder users (PMs, stakeholders), a standalone CLI provides the same functionality. This is the **only case requiring direct LLM integration** (API keys, provider abstraction). It reuses the same script, with a different entry point.

Priority: build embedded (Skills) first, standalone CLI later.

### 5. Durable coroutine pattern for Script ↔ Agent interaction

The script cannot call the LLM directly — it's a short-lived process that runs, returns JSON, and exits. But the script often needs semantic analysis (e.g., "extract the user's purpose from this paragraph"). A memoized coroutine replay pattern solves this: workflows are plain async functions whose `infer`/`prompt` calls are logged, replayed on re-execution, and can suspend mid-workflow when waiting for input. See the durable execution ADR for the full mechanism and alternatives analysis.

### 6. What we are NOT doing

- **MCP servers**: MCP is for external services/APIs. Elaborate's value is procedural knowledge, not external data. Skills are simpler and sufficient.
- **Instructions-only approach**: Script logic lives in testable TypeScript, not SKILL.md prose that the LLM interprets.
- **Elaborate inside user's project**: The script package is external to avoid dependency pollution.

## Consequences

**Positive:**

- Zero friction for developers — Elaborate runs in their existing coding assistant
- No separate LLM cost for embedded use — host assistant provides the LLM
- Testable script — unit tests for phases, workflows, validation
- Deterministic behavior — code executes logic, not LLM interpretation
- Cross-platform — same Skill works in Claude Code, Cursor, Copilot
- Clean user projects — no node_modules pollution, works with any tech stack
- Debuggable — logs, traceable state, not "why did the LLM do that?"

**Negative:**

- Script timeout limits — Skills have ~60s timeout; long operations need chunking
- Skill mechanism may evolve — agentskills.io is new (December 2025); spec may change
- Standalone CLI deferred — non-coder users wait longer

**Supersedes:**

This decision resolves the CLI framework and LLM integration design questions for the embedded case. Those questions remain relevant only for the standalone CLI (lower priority).
