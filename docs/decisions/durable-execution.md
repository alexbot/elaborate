---
title: Durable execution via memoized coroutine replay
status: accepted
---

## Context

The script-agent binom (script-agent interaction ADR) requires multi-step conditional logic within each interview phase: extract structured data from a response, branch on the result, compose a follow-up question, ask the user, extract again, check for contradictions, branch again. A single user turn may trigger multiple script↔agent exchanges before the next user-facing prompt.

But the script runs as a short-lived CLI process. Each adapter invocation (start, input, extract) executes, outputs JSON, and exits. The script cannot hold state in memory across invocations.

Traditional approaches to multi-step stateful processes:

| Approach | Fit |
|----------|-----|
| **Explicit state machines** | State node per step, transitions between nodes. Grows O(steps × phases). Every new phase requires wiring up state transitions. Testing requires simulating state transitions. Readable at small scale, unmanageable at the complexity of a multi-phase interview. |
| **Event sourcing** | Append events, rebuild state from event stream. Requires separate event handlers and projections — more infrastructure than the problem warrants for a single-user interview tool. |
| **Saga pattern** | Orchestrator coordinates steps with compensation logic. Designed for distributed systems with failure recovery — overkill for a single-process workflow. |

The integration architecture ADR evaluated three *interaction patterns* (coroutine, batch schema, hook-enhanced) but did not deeply justify the *execution model* — how the chosen coroutine pattern survives across process boundaries.

## Decision

### 1. Memoized coroutine replay

Implemented in `src/durable/workflow.ts`. Workflows are plain async functions that call `ctx.infer()` (agent semantic work) and `ctx.prompt()` (user interaction) through an `WorkflowContext`. The framework makes these interruptible and resumable across process boundaries.

**Core principle: workflow code IS the state.** There is no explicit state machine. Phases are composed as sequential function calls. Control flow (if/else, loops, function composition) replaces state transition tables. The script's process logic is expressed as ordinary TypeScript, not as configuration or declarative state definitions.

### 2. Mechanism

Every `infer`, `prompt`, or `call` invocation is logged to an ordered `StateEntry[]` array:
- Completed: `{ id: string, value: unknown }`
- Suspended: `{ id: string, suspended: true }`

On each adapter invocation, the workflow re-executes from the start:

1. **Replay phase**: Completed entries return their memoized values instantly — no resolver call, no I/O. The workflow fast-forwards through all previously completed steps.
2. **Live phase**: The first un-memoized call hits the resolver (LLM or user input).
3. **Suspend**: If the resolver cannot fulfill (e.g., waiting for user input), it throws `Suspend`. The framework catches it, writes a suspended entry, persists state, and exits.
4. **Resume**: Next invocation replays through all completed entries, reaches the suspended entry, and attempts resolution again — this time with the user's input available.

### 3. Determinism guarantees

- **Entry IDs** are unique strings assigned by the workflow code. ID naming conventions are an implementation concern; the framework only requires uniqueness, enforced at runtime.
- `DuplicateCallIdError`: same ID used twice in one execution.
- `NonDeterminismError`: replay encounters a different ID than what was logged. This catches logic bugs where workflow branching changes between invocations.

### 4. State lifecycle

`WorkflowState.status`: `running → suspended → running → ... → completed | failed`

The state log (entries array) is the single source of truth. Persistence is injected — the framework doesn't know or care whether state is stored in YAML, JSON, or memory.

## Consequences

**Positive:**

- Adding a phase = adding a function call in the pipeline. No state wiring, no transition table updates.
- Phase-internal tests are insulated from downstream phase additions. Adding scope after stakeholders broke 4 tests; adding assumptions after scope broke 4; adding validation after assumptions broke 1. Only "last phase completes the workflow" tests are affected.
- Workflows read as sequential code despite being interruptible — new contributors can follow the logic without learning a state machine DSL.
- Determinism is enforced by replay. `NonDeterminismError` catches bugs that would silently corrupt state in a mutable state machine.
- Short-lived process model: no long-running server, no connection management, no WebSocket state.

**Negative:**

- Full replay on every invocation — O(n) in completed steps. Memoized replay is fast (array lookups, no I/O), but the cost is linear in session length. Acceptable for interview-length sessions (tens to low hundreds of steps).
- Forward-only execution. Cannot jump back to an earlier entry without invalidating all subsequent entries. Backtracking is a future concern — it requires invalidating and re-replaying subsequent entries, which is architecturally possible but not yet implemented.
- Workflow functions must be deterministic — no side effects, no random values, no time-dependent logic outside of `infer`/`prompt`/`call`. Violating this triggers `NonDeterminismError` on replay.

**Extracted from:** Integration architecture ADR. That ADR introduced the coroutine pattern at a high level; this ADR expands the justification with alternatives analysis and documents consequences discovered through implementation of seven phases.
