---
title: Interview methodology and theoretical grounding
status: accepted
---

## Context

Project elaboration is a broad activity encompassing clarification, analysis, specification, validation, and management of project intent. Elaborate does not attempt to cover the full lifecycle. Instead, it focuses on **clarification** — the activity of drawing out stakeholder needs, turning implicit demands, wishes, and expectations into explicit, structured project definitions.

Even within clarification, many techniques exist. Kvale and Patton catalog interviews, workshops, brainstorming, observation, prototyping, document analysis, and more. These techniques vary in their suitability for AI-assisted dialog:

| Technique | AI Suitability | Why |
|-----------|---------------|-----|
| Socratic questioning | ★★★★★ | Logical structure, no emotional intelligence required |
| Semi-structured interviews | ★★★★☆ | A 2025 study on LLM-conducted interviews: 73.7% capture rate, comparable to human interviewers |
| Goal decomposition (KAOS/i*) | ★★★★☆ | Hierarchical WHY/HOW exploration maps to conversation |
| Assumption surfacing (SAST) | ★★★★☆ | Systematic challenging translates to dialog |
| Workshops / brainstorming | ★★☆☆☆ | Requires group dynamics, simultaneous multi-party ideation |
| Ethnographic observation | ★☆☆☆☆ | Requires physical presence and tacit behavior observation |

The hierarchy of scope choices is: **project elaboration → clarification → interview → Socratic dialog**. Each step is a deliberate narrowing. Elaborate is not a full project management tool, not a multi-technique clarification platform, and not a free-form conversational agent. It is a structured Socratic interviewer that draws out project intent through dialog.

Multiple academic frameworks inform the interview concerns Elaborate addresses. No single framework covers all concerns — GQM (Basili) provides goal-oriented measurement structure, KAOS provides goal-oriented decomposition, i* and Pohl provide stakeholder modeling, Kvale/Patton interview methodology provides the activity model, SAST provides assumption surfacing. These were synthesized into a set of interview concerns that converge across sources.

## Decision

### 1. Methodology scope

Elaborate conducts **interview-based Socratic clarification**. The script (deterministic process logic) applies structured interview techniques through dialog; the agent (LLM) provides the semantic capabilities — natural language understanding, question composition, extraction, contradiction detection — that make the interview work.

Socratic questioning's six categories (clarification, assumption probing, evidence probing, viewpoint exploration, implication exploration, meta-questions) provide the questioning backbone. A 2025 study on LLM-conducted interviews validates that LLM-based interview clarification achieves capture rates comparable to human interviewers.

### 2. Framework synthesis

Elaborate draws from multiple academic frameworks, each contributing to specific interview concerns:

| Interview Concern | Primary Framework(s) | What It Provides |
|---------------------|---------------------|------------------|
| Strategic context (purpose, advantage, measurement) | GQM — Basili (1994) | Goal-oriented value articulation and measurement |
| Goal discovery and decomposition | KAOS goal model | WHY/HOW hierarchical questioning |
| Stakeholder identification and characterization | i*, Pohl (Ch. 20-22) | Actor modeling, source classification, proxy interview |
| Scope and boundary definition | Novel | Constraint documentation, boundary partitioning |
| Assumption surfacing and validation | KAOS domain properties, SAST, Zave & Jackson | Environment descriptions, strategic testing |
| Cross-phase information flow | Parking lot facilitation pattern | Deferred-item management across phases |
| Consolidation and validation | Kvale/Patton interview methodology, ALICE | Consistency checking, contradiction detection |
| Result quality tracking | Bayesian calibration | Confidence, completeness, provenance |

This is a deliberate synthesis, not adherence to a single framework. Each framework contributes where it is strongest.

### 3. Current realization

The methodology is currently realized as a sequence of phases, each addressing one or more interview concerns:

| Phase | Concern | Framework Basis |
|-------|-----------|-----------------|
| Opening | Source identification, rapport | Kvale/Patton interview preparation |
| Purpose | Strategic context | GQM (Basili) |
| Goals | Goal discovery | KAOS WHY/HOW |
| Stakeholders | Source characterization | i*/Pohl actor modeling |
| Scope | Boundary definition | Novel schema |
| Assumptions | Domain properties | KAOS, SAST, Zave & Jackson |
| Validation | Consolidation | Kvale/Patton interview methodology |
| Completion | Session lifecycle | — |

The specific phase set, ordering, and linear execution reflect the current implementation. These may evolve — backtracking, phase reordering, and additional interview concerns (functional decomposition, quality attributes) are future possibilities.

## Consequences

**Positive:**

- Reader understands Elaborate's theoretical grounding and deliberate scope
- Scope is explicit: interview-based clarification, not full project management
- Framework attributions prevent accidental divergence from theoretical foundations
- Multi-framework synthesis draws on the strongest aspect of each

**Negative:**

- Interview technique excludes valid clarification approaches (workshops, observation, prototyping)
- Socratic questioning assumes a cooperative respondent — adversarial or disengaged stakeholders are not well served
- Multi-framework synthesis means no single canonical reference for the methodology
