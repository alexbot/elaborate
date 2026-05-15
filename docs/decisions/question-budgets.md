---
title: Question budgets
status: accepted
---

## Context

Uncapped interview sessions naturally expand. Each phase has legitimate follow-up questions, and without limits, sessions reach 40–50 prompts — past the point where stakeholders engage meaningfully. Research identified 25–32 prompts as the sweet spot for standard sessions.

The question was how to enforce brevity without sacrificing coverage: cap the total? Cap per phase? Filter items or cap after sorting?

Budgets were initially set from design targets, then calibrated against T3 (session-quality) evaluation data. This decision documents the current state; specific cap values are expected to evolve as more evaluation data accumulates.

## Decision

### Per-phase caps with a total target

Each phase has an independent cap on the number of user-facing prompts it generates. The total target is 25–32 prompts for a standard (medium-profile) session.

Current caps (medium profile, as of 2026-05-10):

| Phase | Cap | Mechanism |
|---|---|---|
| Opening | ~3 | Structurally bounded (greeting + extraction + summary) |
| Purpose | ~3 | Naturally bounded (laddering + slot-fill) |
| Goals | 3 elaboration rounds | Sort by distinctiveness, elaborate top 3 |
| Primary stakeholders | 5 elaboration rounds | Sort by distinct perspective, elaborate top 5 |
| Secondary stakeholders | 4 elaboration rounds | Sort, elaborate top 4 |
| External stakeholders | 2 elaboration rounds | Sort, elaborate top 2 |
| Scope | 3 ambiguous items | Sort by ambiguity, resolve top 3 |
| Assumptions | ~3–4 | Structurally bounded (seed + gap-fill + validate + confirm) |
| Validation | ~1 | Single summary + confirmation |

### Sort-then-cap, not filter

When a phase produces more items than the cap allows, items are sorted by relevance (phase-specific criterion: "distinct perspective" for stakeholders, ambiguity for scope) and the top N are elaborated. Remaining items are kept at their current status — not discarded, not sent to the waiting room.

The alternative (filter before presenting) was rejected because it loses information: the LLM would never see the filtered items, and the user wouldn't know they exist. Sort-then-cap preserves all items in the output while focusing interview time on the most valuable ones.

### Stakeholder parking

Stakeholders beyond the cap are listed in place at "identified" status, not parked in the waiting room. This is an intentional asymmetry with goals (where excess items could go to WR): stakeholders are actors with roles and concerns, not content items. Listing them acknowledges their existence; the user sees them in the final output even if they weren't elaborated.

### Scope parking

Scope items beyond the ambiguous-item cap are auto-classified as regular in-scope or out-of-scope items (not parked in WR). Scope items are binary boundary decisions; the waiting room was a category error for this artifact type.

## Consequences

**Positive:**

- Sessions stay within the 25–32 prompt sweet spot
- Coverage across all phases is guaranteed (no single phase can monopolize)
- All identified items appear in output, even if not elaborated
- Sort criteria are explicit and phase-appropriate

**Negative:**

- Per-phase caps may be individually too tight or too loose — total session length is an emergent property, not directly controlled
- Sort criteria ("distinct perspective," "ambiguity") require LLM judgment, adding a classification step
- Cap values are empirical, calibrated from limited T3 data (4–8 scenarios); they will need adjustment as more data accumulates
