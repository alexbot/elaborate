---
title: Internal module architecture
status: accepted
---

## Context

The `integration-architecture` ADR (2026-02-22) established the skill/script split and durable coroutine pattern. As the codebase grew through seven phases, interview mechanics, and supporting infrastructure, the internal organization needed refinement.

Two problems emerged:

1. **Coupling creep.** Phase files imported durable internals directly. Interview utilities reached into phase schemas. Without boundaries, any file could depend on any other.
2. **Domain vocabulary leakage.** Lower layers (durable framework, interview mechanics) accumulated domain-specific terms (Artifacts, Phase, stakeholder types) that made them harder to reuse or reason about independently.

An architectural restructuring (2026-04-19 through 2026-04-21) established explicit layers with enforced boundaries.

## Decision

### Four layers

```
durable      →  interview  →  phases  →  skill
(framework)     (interview)    (domain)    (adapter)
```

Alphabetic order equals dependency order. Each layer may import only from layers to its left. The `skill` layer depends on all three; `durable` depends on none.

| Layer | Responsibility | Key files |
|---|---|---|
| `durable` | Memoized coroutine framework. `WorkflowContext`, `execute()`, `Suspend`. No interview or domain concepts. | `src/durable/workflow.ts`, `index.ts` |
| `interview` | Interview mechanics. Extraction, composition, classification, deviation handling, progress tracking, prompt formatting. Domain-neutral — operates on Zod schemas and strings, not Artifacts or Phases. | `src/interview/*.ts` |
| `phases` | Domain logic. Seven interview phases, artifact schemas, aggregate facade, session persistence. Domain vocabulary lives here. | `src/phases/*.ts`, `aggregate/`, `session/` |
| `skill` | Shell adapter. Translates CLI arguments into `execute()` calls, formats JSON output. | `src/skill/adapter.ts`, `log.ts`, `SKILL.md` |

### Enforcement

ESLint `no-restricted-imports` rule in `eslint.config.js` enforces the layer boundary: cross-layer imports must go through the layer's `index.ts` barrel. Direct imports of internal files (e.g., `../interview/deviation.ts` from a phase) are lint errors. Test files (`__tests__/`) are exempt.

### No root entry point

The package uses a toolkit model with 4 subpath exports (`elaborate/durable`, `elaborate/interview`, `elaborate/phases`, `elaborate/skill`) in `package.json`. No `src/index.ts` exists. This prevents consumers from importing everything and reinforces layer awareness.

### Domain vocabulary exclusion from lower layers

The `durable` and `interview` layers contain no references to Artifacts, Phase enums, stakeholder types, or other domain-specific concepts. This was a deliberate constraint: interview mechanics (extract, compose, classify, retry) should work for any structured interview, not just project elaboration.

Phase-coupled augmentations that need interview primitives live in `src/phases/shared.ts` — the residual "leak" layer where domain vocabulary meets interview mechanics (e.g., `confirmPhase()` wraps `ctx.promptConfirm` with a domain-coupled classifier).

### Extension pattern

`WorkflowContext` is extended via per-file prototype augmentation in `src/interview/*.ts`. Each concern file declares its methods on WorkflowContext, assigns implementations to the prototype, and runs a self-check. The barrel (`src/interview/index.ts`) side-effect-imports all concern files to register methods.

## Consequences

**Positive:**

- Layer violations are caught at lint time, not discovered through subtle bugs
- Lower layers are reusable outside the project-elaboration domain
- Adding a new phase requires touching only `src/phases/` — interview and durable layers are stable
- Import paths make dependency direction visible in every file

**Negative:**

- Barrel re-exports add indirection; reading `import { extract } from "../interview/index.js"` requires knowing the barrel maps to `extraction.ts`
- The prototype augmentation pattern is unusual — new contributors may not expect `WorkflowContext` methods to be defined across multiple files
- `phases/shared.ts` is an acknowledged coupling point that resists further decomposition
