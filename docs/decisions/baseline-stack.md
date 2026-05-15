---
title: Baseline technology stack
status: accepted
---

## Context

Every project requires foundational technology choices. Some decisions are high-impact and warrant deliberation; others are subjective defaults driven by familiarity, ecosystem maturity, or conventions established during early development.

This ADR captures the latter — choices that "just are" and don't require justification beyond acknowledging them.

## Decision

The following technologies form the implicit baseline. They are not explained because alternatives were never seriously considered:

| Layer | Choice | Notes |
|-------|--------|-------|
| Language | TypeScript | Type safety, ecosystem |
| Runtime | Node.js | CLI tooling ecosystem |
| Artifact format | YAML | Human-readable, diffable |
| Conversation log | JSONL | Append-only, line-by-line parsing |
| Schema validation | Zod | TypeScript-native, runtime + static typing |
| Storage | Local filesystem | No database; directory-per-session isolation |

## Consequences

**Positive:**
- No decision fatigue on settled matters
- Clear starting point for actual architectural decisions
- New contributors know the stack immediately

**Negative:**
- Implicit choices may become outdated without review
- "Because we always do it this way" isn't a strong argument if revisited

These choices can be superseded individually if a compelling reason emerges, but the burden of proof is on the change.
