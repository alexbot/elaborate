# Decisions

Architecture Decision Records (ADRs) documenting significant technical choices. Each decision captures **context**, **what was decided**, and **consequences**.

## File format

**Naming:** `short-slug.md`

**Front matter:**

```yaml
---
title: Short descriptive name
status: accepted
---
```

| Field | Required | Values |
|-------|----------|--------|
| `title` | yes | Short descriptive name |
| `status` | yes | `proposed` &#124; `accepted` &#124; `deprecated` &#124; `superseded` |

**Content:**

```markdown
## Context

What is the situation? What forces are at play? What problem needs solving?

## Decision

What have we decided to do? Be specific.

## Consequences

What are the trade-offs? Include both positive and negative outcomes.
```

## Rules

1. **Context before decision** - Always explain the situation and constraints before stating what was decided. Decisions without context are meaningless to future readers.

2. **Versions are mandatory** - If a decision involves a versioned dependency (library, framework, API, language), the specific version must be stated in the Decision section.

3. **Consequences are honest** - Include downsides and trade-offs, not just benefits. Every decision has costs.

4. **Immutable once accepted** - Don't edit accepted decisions. If circumstances change, write a new decision that supersedes the old one, and update the old decision's status to `superseded`.

5. **Proposed decisions are drafts** - Use `proposed` status for decisions under discussion. Change to `accepted` once agreed upon.
