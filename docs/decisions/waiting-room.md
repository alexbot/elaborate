---
title: Waiting room pattern
status: accepted
---

## Context

Interview phases address distinct concerns (goals, stakeholders, scope, assumptions), but stakeholders don't organize their thoughts by concern. A user discussing goals may mention "we need to support 1000 concurrent users" — a scope constraint, not a goal. A stakeholder name may surface during purpose clarification, long before the stakeholder identification phase.

Three options for handling out-of-phase information:

1. **Discard**: Ignore what doesn't fit the current phase. Loses information.
2. **Process inline**: Handle the scope constraint during goal discovery. Violates phase boundaries, complicates phase logic, and the relevant phase hasn't had a chance to build context yet.
3. **Park**: Capture the item for later processing by the appropriate phase.

The "Waiting Room" (also called a parking lot in facilitation literature) serves exactly this purpose: a holding area for items that are recognized but not yet ready for full treatment.

## Decision

### 1. Schema

`waitingRoom: WaitingItem[]` on the artifacts object. Each item is `{ id: string, content: string }` — deliberately minimal. Items are flat untyped strings; the consuming phase classifies and structures them into its own schema.

### 2. Lifecycle

**Produce**: Any phase can park items via `addWaitingRoomItems()`. The agent flags out-of-phase information during extraction; the script adds it to the waiting room.

- Purpose produces goal hints, stakeholder hints, and assumptions as ladder byproducts
- Goals and stakeholders produce scope and assumption candidates flagged during extraction

**Consume**: Each phase drains relevant items during its seed step. The agent receives the waiting room contents alongside conversation history and extracts items relevant to the current concern. Assumptions is the catch-all safety net for anything that earlier phases didn't claim.

- Goals drains goal-related items (hints from purpose laddering)
- Stakeholders drains stakeholder-related items (conditional — only runs when items exist)
- Scope drains scope-related items (boundaries, constraints)
- Assumptions drains the remainder (domain properties, unverified claims)

**Drain mechanism**: ID-based, not content-based.

1. Phase records pre-existing waiting room IDs before seed extraction
2. Agent returns `drainedWaitingRoomIds` — the IDs it consumed
3. Only IDs from the pre-existing set are removed

This prevents a phase from consuming items it produced in the same step — a subtle bug that would occur with content-based matching.

### 3. Residual items

Items may remain in the waiting room after all phases complete. The validation phase performs a classify-and-route step: a single infer call classifies each remaining WR item into the most appropriate artifact category (assumption, finding, scope addition) or marks it as residual. Routed items are absorbed into their target collection; unclassifiable items move to a persisted `residual` list (display-only, not actionable). The waiting room ends up empty by construction.

No guaranteed meaningful consumption — some items may be genuinely unclassifiable (already absorbed organically, too vague to route, or cross-cutting context without a natural home). The residual list makes this explicit rather than silently dropping items.

## Consequences

**Positive:**

- No information loss across phase boundaries
- Decouples phases — producers don't need to know which phase will consume
- ID-based drain prevents accidental self-consumption
- Pattern validated across 5 phases (purpose, goals, stakeholders, scope, assumptions) with consistent behavior
- Minimal schema keeps the conduit generic — any phase can produce, any can consume

**Negative:**

- Items are untyped — the consumer must re-interpret content, which depends on agent quality
- No routing: items aren't tagged with a target phase. The consuming phase must decide relevance during seed extraction
- Residual items after all phases indicate potential coverage gaps in the phase set
