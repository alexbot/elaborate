---
title: Composition quality centralized through chokepoints
status: accepted
---

## Context

Analysis of interview effectiveness identified ~30 actionable quality rules across three dimensions:

- **Content** — question design, bias avoidance, probing discipline
- **Form** — suggestion formatting, confirmation language, summary neutrality
- **Process** — sequencing, pacing, progress indication, fatigue management

These rules are not code — they don't compile, build, or test. They manifest as natural-language instructions embedded in LLM composition calls and as formatting choices in user-facing prompts. Without structural enforcement, compliance depends entirely on the developer applying rules consistently across 15+ composition call sites in 7 phase files.

The existing codebase already routes all phase behavior through shared functions (`ctx.compose`, `ctx.confirm`, `promptQuestion`), but these functions handle mechanics (fallback logic, lettered formatting, schema wiring) without carrying quality rules. The chokepoint structure exists; it just doesn't enforce quality.

## Decision

### 1. Quality rules live in chokepoint constants, not in phase code

Exported functions in `src/interview/preambles.ts` serve as the single source of truth for cross-cutting quality rules:

| Function | Chokepoint |
|---|---|
| `compositionPreamble()` | `ctx.compose` — prepended to every composition call |
| `extractionPreamble()` | `ctx.extract` — prepended to every extraction call |
| `classificationPreamble()` | `ctx.confirm` — prepended to classification guidance |
| `suggestionCloser()` | `promptQuestion` — appended after suggestion list |
| `responseClass` schema augmentation | `ctx.extract` — extends Zod schema with classification field |

Functions (not constants) so parameters can be added later if quality rules need context (phase, artifact state, progress). Phase code provides domain direction (what to ask about). Quality rules (how to ask / how to extract) come from the chokepoint functions. Phase code never contains quality instructions directly.

### 2. Structural tests enforce chokepoint usage

Runtime tests verify that all phases route through the shared chokepoints:

- Every composition-shaped `infer` call (using `ComposeSchema`) passes through `ctx.compose`
- Every confirmation classification uses `ctx.confirm`
- Every user-facing question with suggestions uses `promptQuestion`

These tests catch bypass — a phase calling raw `ctx.infer()` with a composition message, skipping the preamble. They verify structure, not LLM output quality.

### 3. Script-authored prompts: same rules, different enforcement

Not all `ctx.prompt()` calls are agent-composed questions. Script-authored prompts — seed presentations, confirmation summaries, the opening greeting — use `ctx.prompt()` directly. These are deterministic text controlled at code time, so they don't need the injection mechanism (the developer IS the author, not the agent).

However, quality rules still apply — all user-facing text affects the interview regardless of authorship. Leading language in a confirmation summary is just as biasing as in a composed question. The difference is enforcement:

- **Agent-composed** → quality rules injected automatically via chokepoint constants
- **Script-authored** → quality rules applied by the developer at write time, informed by the same evidence base

The structural tests distinguish these by checking for `ComposeSchema` on `infer` calls and suggestion presence on `prompt` calls. Script-authored prompts are not exempt from quality — they're exempt from the injection mechanism because they have a more direct path to compliance.

### Rule locations

Quality rules are defined in code constants (above). The evidence base draws from Kvale's InterViews (7th ed.), Patton's Qualitative Research & Evaluation Methods, and the broader qualitative interview methodology literature, organized by interview-design concern (probing, suggestions, composition, sequencing, confirmation/closure, rhythm, anti-patterns).

## Consequences

**Positive:**

- Quality rules propagate to all composition calls from a single edit point
- New phases automatically inherit quality rules by using the chokepoint functions
- Structural tests catch quality bypass at CI time
- Rule evolution doesn't require ADR changes — constants are mutable code

**Negative:**

- Preamble length may degrade agent compliance (mitigate: terse imperative phrasing, empirical testing, tiering into essential vs. phase-specific if needed)
- Four functions to maintain — if a fifth quality dimension emerges, the pattern needs extension
- Phase developers must understand the chokepoint convention — documented here and enforced by tests

**Refines:** Script-agent interaction ADR (composing pattern — this ADR adds quality constraints to what the composing pattern produces)
