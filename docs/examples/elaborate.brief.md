# Structured thinking tool for vague project ideas

> *"I'm building an AI tool that helps people think through their project ideas before they start building. Like a Socratic interviewer — it asks questions to help you figure out what you actually need, instead of jumping straight to code or generating a spec from a one-line prompt."*

## Summary

People skip the clarity phase of projects — not because they lack discipline, but because they lack a structured way to do it. This tool is a Socratic interviewer that forces external articulation of project intent, surfacing contradictions the respondent didn't know existed. The strongest signal from the session: the respondent values the conversation itself over the artifact it produces — "half the value is the conversation itself, not the artifact at the end."

## Purpose

The tool helps anyone starting with a vague idea think through what they need before building. The respondent corrected early framing that targeted "people who tend to rush" — the real audience is anyone regardless of discipline, including careful planners who skip clarity work because they have no structured process for it.

The advantage is external pressure. Internal planning lets contradictions survive because "I can gloss over contradictions because I'm not explaining to anyone else." A structured interview makes gaps visible: when the AI asks "you said X but also said Y — which is it?" the respondent can't hand-wave. The act of articulating to another party — even an AI — changes what the respondent thinks. The record enables revisiting reasoning without reconstruction, but the conversation is where value is created.

Success is measured by surfacing actionable contradictions the respondent didn't know existed. The respondent added a materiality threshold: contradictions must change how the project would be built, not be interesting logical puzzles. "'You said X but also Y' is only valuable if resolving it actually shifts the design." A single genuine insight is enough — chasing a quota would force artificial contradictions that defeat the purpose.

## Goals

1. **Enable resumption without context loss** — users pick up sessions weeks later without re-reading transcripts or re-answering questions. The tool must track what it already asked, not just store answers.
2. **Surface hidden contradictions** — reveal conflicts between stated goals that the respondent didn't see, where resolving them changes how the project would be built.
3. **Create a durable external record** — capture the reasoning chain, assumptions, and decisions so the respondent can revisit without reconstruction or share context with collaborators.
4. **Remove activation friction for the clarity phase** — make structured clarification concrete enough that people who normally skip it treat it as a normal part of starting a project.

## Stakeholders

**People starting projects with unclear scope** (primary, respondent) — a careful planner who does think things through but in scattered, disconnected contexts. Needs the process to be efficient: "A 90-minute interview where half the questions are obvious or repetitive would frustrate me." Has shipped technically functional products that solved the wrong problem because they skipped structured problem interrogation.

**AI coding assistants and developer tools** (secondary) — consumers of structured artifacts who need to understand what was rejected and *why*, not just what was decided. Without rejection reasoning, they "confidently build around assumptions we already decided were wrong." The respondent called this "worse than starting from scratch."

## Scope

**In scope:**
- Structured Socratic interview flow (purpose, goals, stakeholders, scope, assumptions)
- Contradiction detection and surfacing between stated goals, needs, and boundaries
- Durable session record with conversation, artifacts, and reasoning provenance
- Session resumption across time gaps without context reconstruction
- Artifact schema design for downstream AI consumption
- Capture of rejected approaches with decision rationale
- Consistent phase skeleton with variable question depth based on demonstrated clarity
- Dual output: schema (canonical, machine-readable) and plain text (human-readable projection)

**Out of scope:**
- Implementation of discussed project ideas (tool stops at clarity)
- Domain-specific guidance or templates
- Real-time collaborative multi-stakeholder interviews

**Constraints:**
- CLI tool, not a standalone web app or SaaS — integrates into AI coding assistants (e.g., Claude Code) or terminal dev environments
- Must fit into the user's existing toolchain without context-switching to a separate interface

**Design principle:** The tool never self-resolves ambiguity. When the respondent is vague or contradicts themselves, the tool flags it and asks them to decide — it never picks an interpretation silently. Non-negotiable.

## Uncertainties

**Unresolved:**
- Artifact consumption contract — what specific schema format does the machine-readable output need? The respondent confirmed schema is canonical and plain text is the projection, but the contract (JSON, YAML, or other) is undefined.
- Adaptive depth calibration — the tool should drill deeper when responses are vague and move on when they're precise, but the mechanism for detecting clarity vs. vagueness is unspecified.

**Assumptions (implicit, not formally captured):**
- The respondent assumes most sessions will surface multiple insights naturally, even though success requires only one.
- The tool's value depends on the respondent engaging honestly — the forcing function only works if the respondent doesn't hand-wave to the AI the way they hand-wave to themselves.

## Session stats

| Metric | Value |
|---|---|
| Questions asked | 22 |
| Purpose fields | 3/3 |
| Goals | 4 |
| Stakeholders | 3 (2 primary, 1 secondary) |
| In-scope items | 10 |
| Out-of-scope items | 3 |
| Constraints | 3 |
| Assumptions | 0 |
| Findings | 0 |
| Agent model | Haiku 4.5 |
