---
title: Workflow and session are distinct concepts, unified today
status: accepted
---

## Context

Two status systems coexist in the codebase:

- **WorkflowStatus** (`running` / `suspended` / `completed` / `failed`) — persisted in `.elaborate/session.yaml`, controls durable execution. All four values are actively used: `running` resets on retry, `suspended` marks awaiting response, `completed` guards against re-execution, `failed` enables error recovery.
- **Artifact `sessionStatus`** (`in-progress` / `complete` / `abandoned`) — set on `ArtifactAggregate.data` in memory, intended to record the user's judgment about the interview outcome.

The artifact `sessionStatus` is ephemeral: each adapter command creates a fresh `ArtifactAggregate`, so the field dies with the command that set it. It's set in validation but never persisted or read afterward. Meanwhile, `WorkflowStatus` is operational — it says whether the durable execution is running, waiting, done, or broken, not whether the user endorsed the result.

This confusion surfaced during design of `complete` and `abandon` adapter commands. Analysis revealed:

- **Abandon is not an action** — it's the absence of action. The user stops responding; the session stays `suspended`. Handling stale sessions is a multi-session concern.
- **Early completion has no consumer** — partial results are deliverable (each phase has its own confirmOrRevise loop), and no code behaves differently based on natural vs. early termination.
- **The user's validation concern has no proper home** — it was injected as a finding, but findings are discovered facts about artifacts, not user judgments about the session.

## Decision

**Workflow and session are conceptually distinct, unified in a single file today.**

- **WorkflowStatus** remains operational: `running` / `suspended` / `completed` / `failed`. No semantic values (like `abandoned`) are added.
- **Artifact `sessionStatus` is removed.** It was a dead-end signal — set but never persisted or consumed.
- **User concern is homed on persistence.** An optional `userConcern` string field on the session file. Written by validation when the user expresses dissatisfaction. If absent, the user endorsed the results. This is a session-level concept stored alongside the workflow state.
- **No adapter commands for session lifecycle.** No `complete` or `abandon` commands. The workflow completing naturally signals completion. Abandonment is the absence of further interaction.

## Consequences

**Positive:**

- One fewer abstraction (`sessionStatus`) that exists only in memory and is never observable.
- The user's validation concern is properly homed — not disguised as a finding.
- WorkflowStatus stays purely operational. No semantic overloading.
- No dead adapter commands for actions that have no consumer.

**Negative:**

- A suspended session cannot be explicitly closed without deleting `.elaborate/session.yaml`. This is acceptable for single-session; multi-session will need to address stale session handling (e.g., adapter detects active session at startup, offers continue-or-new choice, archives on abandonment or completion).
- Future features (multi-session, revision mode, export) may need to introduce a proper session layer above workflow. This ADR acknowledges that eventuality but defers it — the concepts are distinct but don't warrant separate infrastructure yet.
- The "did the user approve" information is no longer a top-level field. It's inferrable from: workflow completed + no `userConcern` = endorsed. This is sufficient for current consumers (none), but a future export feature may want something more explicit.
