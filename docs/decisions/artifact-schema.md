---
title: Artifact schema design and framework attribution
status: accepted
---

## Context

The interview produces informal stakeholder needs — raw, often ambiguous expressions of intent. To track progress through a multi-phase interview, schemas must capture not just the content but its epistemic status: how confident are we, how did we get it, has it been validated?

Multiple frameworks define artifact structures: KAOS uses goal trees with refinement, i* uses actor-dependency networks. No single framework covers all the concerns Elaborate addresses. The initial design considered comprehensive schemas (13 goal fields, full KAOS refinement, i* contribution types). Implementation applied 80/20 selection: only fields the questioning flow actually needs were included; the rest were deferred.

## Decision

### 1. Multi-framework synthesis

Each artifact type draws from the framework best suited to its interview concern:

| Artifact | Primary Framework | Key Design Choice |
|----------|------------------|-------------------|
| Purpose, Advantage, Measurement | GQM — Basili (1994) | Fixed slots. Confidence derived from artifact state: first fill(0.5) → update(0.7) → confirmed(0.9). Drawn out via laddering (solution-framed) or direct questioning (problem-framed) |
| Goals | KAOS goal model (MVP subset) | Progressive status: fuzzy(0.5) → elaborated(0.7) → confirmed(0.9). Iterative discovery via WHY/HOW probing. Deferred: type, obstacles, fit criteria, refinement tree, contribution types |
| Stakeholders | i*/Pohl actor model | Progressive status: identified(0.5) → elaborated(0.7) → confirmed(0.9). `isRespondent` field bridges proxy interview concern (Pohl) to data — novel, not literature-grounded |
| Scope (in/out) | Novel | No existing framework defines a scope item schema — scope is traditionally captured via context diagrams, not structured dialog. No status progression: boundary decisions are binary. Confidence without status |
| Constraints | Novel | Flat list, no progression. External non-negotiable realities |
| Assumptions | KAOS domain properties + SAST | Flat status: unvalidated(0.5) / validated(0.9) / flagged(0.7). No progression — validation is a binary outcome, not a refinement journey. `hypothesis` vs `invariant` types from KAOS |
| Findings | Bayesian calibration | Phase-tagged observations capturing gaps, risks, and quality signals |
| Residual | Novel (engineering) | WR items that survived classify-and-route in validation. Display-only, not actionable. Explicit discard — makes "unclassifiable" visible rather than silently dropping |

### 2. Confidence models vary by artifact type

Confidence is deterministic from process state (script-agent interaction ADR), but different artifact types warrant different status models because their epistemic nature differs:

- **Progressive** (goals, stakeholders): Discovery → elaboration → confirmation. Knowledge deepens through probing. Status labels are domain-specific ("fuzzy" for goals, "identified" for stakeholders) but map to the same numeric values.
- **Slot-based** (purpose, advantage, measurement): Fixed slots filled once, then refined. Confidence derived from artifact state — first fill yields 0.5, subsequent update yields 0.7, no separate state tracking needed.
- **Binary** (assumptions): Validate or flag. No refinement journey — you either verify the assumption or you can't. "Flagged" (0.7) is semantically distinct from "unvalidated" (0.5): the user actively said "I can't verify this."
- **None** (scope items): Boundary classification, not knowledge progression. Items are in-scope or out-of-scope; confidence reflects certainty of the classification (0.7 seed, 0.9 after user approval), not a status transition.

### 3. Universal provenance

Source provenance (`{ turnId }`) is optional on all artifact types — universal, not per-type. This was a deliberate choice during goal discovery to prevent structural asymmetry across artifact types.

## Consequences

**Positive:**

- Each schema choice is traceable to academic literature or explicitly marked as novel engineering
- Different confidence models per type reflect genuine epistemic differences rather than forcing a uniform model
- 80/20 selection keeps schemas lean for MVP; deferred fields are tracked in triage for future slices
- Universal provenance enables cross-artifact traceability

**Negative:**

- Multi-framework synthesis means no single reference for the whole schema
- Novel schemas (scope items) lack literature validation — they are engineering inventions for dialog-based clarification
- MVP subset defers useful KAOS features (obstacle analysis, goal refinement trees, contribution types) that would enrich the questioning flow

**References:** Interview methodology ADR (framework synthesis), script-agent interaction ADR (confidence from state principle)
