---
name: project-brief
description: "Turn a completed session into a project brief — reads .elaborate/session.yaml, writes markdown."
argument-hint: "[path-to-session.yaml]"
---

# Project Brief

Read the session file (argument). Walk `workflow.entries` in order to reconstruct the final state of each artifact — purpose, advantage, measurement, goals, stakeholders, in-scope/out-of-scope items, assumptions, findings. Later entries overwrite earlier ones for the same artifact.
## Structure

Two heading levels: `#` (title) and `##` (sections). Merge thin sections, split heavy ones. Omit empty sections.

`# Title` (from purpose, sentence case) → blockquote with the respondent's original idea verbatim (`> *"..."*`).

`##` sections covering: summary, purpose, goals, stakeholders, scope, uncertainties, session stats. Conceptual areas, not mandatory headings — name and combine to balance the document.

## Before writing

**Reconstruct purpose**: The purpose section must faithfully capture the final state of purpose, advantage, and measurement — including contradictions the respondent surfaced and revisions they requested. Trace the purpose arc: what the respondent said initially, how it evolved, and where it landed. The summary references the purpose but doesn't encode it — it's the hook, not the record.

**Identify high-impact content**: Scan the final artifact set for the 3-5 insights with the most downstream weight — direction changes, blockers, unresolved tensions that affect feasibility, moments where the respondent reversed or reframed their own thinking. These get full treatment (a sentence or a quote). Everything else stays compressed to a bullet or clause.

**Completeness check**: After drafting, verify every assumption, finding, and contradiction from the final session state appears somewhere in the brief — at minimum as a clause within a bullet. Nothing gets silently dropped. Depth varies by impact; presence does not.

## Writing rules

**Brevity**: A brief is a decision document, not a transcript. Readable in under 2 minutes. Every sentence earns its place. Allocate space proportionally to impact — an insight that reframes the project gets a sentence; a routine scope item gets a bullet.

**Summary**: 2-3 sentences — the elevator pitch. Situation (what's at stake), what the project does about it, and the single most important tension or insight. Memorable enough to repeat in conversation. Don't encode purpose here — that's what the purpose section is for.

**Purpose**: The final state of purpose, advantage, and measurement in narrative form. If the respondent reframed the project during the session, lead with the reframed version. Include the key contradictions or revisions the respondent surfaced — these are the substance of purpose evolution, not noise.

**Goals**: Numbered, **title** — one sentence. Sharpen until no two goals could be confused.

**Stakeholders**: Broadest accurate role label. One sentence per stakeholder: role + primary concern. No sub-lists, no elaboration. Flag the respondent inline.

**Scope**: Terse bullets. In-scope, out-of-scope (with reason if captured), constraints. No explanation beyond what the bullet needs to be unambiguous.

**Uncertainties**: Only items that change downstream decisions. Group: unresolved tensions, unknowns, assumptions. Resolved contradictions get one line or are skipped. Cap at 3-4 most consequential items per group.

**Session stats**: Markdown table — Metric | Value. Include: questions asked, purpose fields (how many of purpose/advantage/measurement were captured, e.g. "3/3"), goals, stakeholders, scope items (in/out), constraints, assumptions, findings.

**Voice**: Use the respondent's own words — don't upgrade vocabulary or smooth over hedging. But quotes are seasoning, not structure: one or two per section where the respondent's phrasing is sharper than any paraphrase. Add nothing beyond what the session produced. If the respondent corrected the system and the correction wasn't applied, say so.
