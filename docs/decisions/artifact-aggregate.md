---
title: Centralized artifact mutation via ArtifactAggregate
status: accepted
---

## Context

Interview phases mutate a shared `Artifacts` object: adding goals, updating stakeholder fields, draining the waiting room, recording findings. When each phase manipulated artifacts directly — `artifacts.goals.push(...)`, `artifacts.waitingRoom = artifacts.waitingRoom.filter(...)` — mutation logic was scattered across seven phase files with no consistency guarantees. Common patterns (ID generation, confidence assignment, status-confidence coupling) were duplicated.

Two options:

| Approach | Fit |
|----------|-----|
| **Direct mutation** | Simplest. Each phase writes to the artifacts object. No abstraction overhead. Downsides: duplicated ID generation, no enforcement of invariants (e.g., confidence must match status), mutation logic untestable in isolation. |
| **Domain object with typed methods** | Single class owns all mutations. Phases call intent-revealing methods. Invariants enforced once. Testable in isolation. Downside: one more abstraction layer. |

With seven phases, the duplication and invariant risk made direct mutation untenable.

## Decision

`ArtifactAggregate` (`src/phases/aggregate/index.ts`, delegating to per-domain modules under `src/phases/aggregate/`) centralizes all artifact mutations behind typed domain methods.

**Principles:**

1. **Read-only data access.** Phases read artifacts via `agg.data` (returns the underlying `Artifacts` object). No direct writes.
2. **Intent-revealing mutations.** Methods express domain operations, not data manipulation: `addFuzzyGoals()`, `setGoalStatus()`, `confirmElaboratedGoals()`, `drainWaitingRoom()`.
3. **Invariants enforced once.** ID generation (`nextId`), status-confidence coupling, and structural rules live in the aggregate. Phases don't compute IDs or confidence values.
4. **Phase signature standardized.** All phases receive `(ctx: WorkflowContext, agg: ArtifactAggregate)` instead of raw `Artifacts`.

## Consequences

**Positive:**

- Mutation logic tested once (38 dedicated tests) instead of per-phase.
- Adding a new artifact type means adding methods to one file, not patching every phase.
- Phase code is shorter and expresses intent rather than mechanics.
- ID generation and confidence assignment are consistent by construction.

**Negative:**

- Every new mutation pattern requires adding a method to the aggregate. Phases cannot ad-hoc mutate.
- One more indirection layer — must read `aggregate/index.ts` (and its per-domain modules) to understand what mutations are possible.
