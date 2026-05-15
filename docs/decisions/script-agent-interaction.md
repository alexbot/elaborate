---
title: Script-agent interaction principles
status: accepted
---

## Context

The durable execution framework (durable execution ADR) enables multi-step workflows where the script calls `ctx.infer()` and `ctx.prompt()` to exchange semantic tasks with the agent. `target: "agent"` round-trips enable 0-to-n script↔agent exchanges per user turn.

But the execution mechanism doesn't prescribe *how* intelligence is distributed. During purpose-clarification design, a sharper principle emerged: who decides what, who computes what, and why.

The driving constraint: LLMs do not reliably follow complex multi-step processes. A deterministic script exists precisely because the agent cannot be trusted with process logic. But the script is semantically blind — it cannot read, interpret, or reason about natural language. Neither component functions alone.

## Decision

### 1. Script-agent binom

The script and agent are co-dependent halves of one system:

- **Script**: makes ALL process decisions. Tracks state, decides what to ask, when to transition, how to handle gaps. Deterministic, testable, debuggable. Never interprets natural language.
- **Agent**: computes ALL semantic parameters. Extracts structured data from natural language, detects contradictions, assesses relevance, generates context-appropriate questions and suggestions. Never decides what comes next in the process.

The agent computes the variables. The script runs the logic on those variables. Without the agent, the script has no inputs. Without the script, the agent has no direction.

### 2. Composing pattern

The script does not hardcode user-facing message text (the opening phase greeting is an exception for bootstrap simplicity). Instead, the script directs the agent to compose user-facing content:

1. Script decides what topic to address (e.g., "ask about advantage")
2. Script sends a `target: "agent"` task: compose a question on this topic with 2-3 suggested answers, given current artifacts
3. Agent returns composed question + suggestions
4. Script sends the composed output to the user via `target: "user"`

This keeps the script in control of *what* and *when*. The agent handles *how to say it* — wording, tone, context-appropriate examples. Suggested answers reduce cognitive load and show the user what level of specificity is expected.

Questions and their suggested answers are composed just-in-time (after the previous response is processed), so suggestions always reflect the latest artifact state.

### 3. Confidence from process state

Semantic confidence (how clear/specific a captured artifact is) is derived from process state progression, not from agent assessment:

| State | Confidence | Meaning |
|-------|-----------|---------|
| absent | 0 | Slot not yet addressed |
| mentioned | 0.5 | Captured from user statement, not yet refined |
| refined | 0.7 | Revisited and sharpened through follow-up |
| confirmed | 0.9 | User explicitly approved in summary |

The script tracks these transitions deterministically. No floating-point guessing from the agent.

### 4. Contradiction detection as semantic task

When the script needs to check new claims against existing artifacts, it issues a semantic task: "given these artifacts and this new statement, identify contradictions." The agent returns structured results (list of contradictions, or empty). The script branches on the result — surface contradictions to user, or proceed.

This is a general pattern: any phase can request contradiction checking by including it in the extraction schema. The script decides *when* to check; the agent does the semantic comparison.

## Consequences

**Positive:**

- Clear separation: no ambiguity about where logic lives
- Each half is testable in isolation — script with mock resolvers, agent with scripted tasks
- Agent instructions stay focused — "extract these fields" rather than "figure out what to do"
- Composing pattern produces better questions than hardcoded templates (context-aware, with suggestions)
- Confidence is deterministic and auditable

**Negative:**

- Two agent round-trips per user turn (compose + extract) instead of one
- Workflow functions grow with each phase — more execution paths to test
- Composing pattern means question quality depends on agent capability — degraded agent produces degraded questions (but process integrity is preserved)

**Refines:** Integration architecture ADR (interaction pattern), Durable execution ADR (execution model)
