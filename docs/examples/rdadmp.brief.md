# Research data management plan compliance checker

> *"I'm ready to answer questions about our Data Management Plan (DMP) compliance checker — the tool we're building to check whether researchers' DMPs meet funder-specific requirements."*

## Summary

An institutional compliance reviewer wants to automate the manual spot-checking of researcher Data Management Plans against scattered, changing funder policies. The tool is an add-on to an existing DMP creation tool, not a standalone product. The hardest problem isn't validation logic — it's that funder rules live in PDFs, web pages, and emails that change without notice, and different program officers at the same funder interpret the same requirement differently.

## Purpose

The tool catches compliance gaps early — while researchers are still drafting — so they don't submit a DMP thinking it's fine only to have the compliance team or funder reject it later. The core advantage is consistency: "a tool that centralizes that and tells you 'your data sharing plan doesn't address NSF's openness requirement' is way better than a researcher googling three different funder policies and guessing whether they got it right."

Measurement combines three signals. Fewest funder rejections for missing compliance items is "the clearest signal." Compliance team spending less time on manual spot-checks is "real operational value." Researcher confidence that when the tool says they're compliant, they actually are. The respondent qualified this last one: "some of our compliance checks are pretty binary (is this field filled in?), but others are squishier. Like, is the data sharing plan actually 'adequate'? That's harder to automate, so we might not catch everything."

During confirmation the respondent added a critical dimension: researchers apply to multiple funders with conflicting requirements — "one might require open data and another restricts sharing of certain data types" — and the tool needs to flag those conflicts. They later extended this to funder rules changing mid-cycle: "a DMP that passed last month under v1 of the NSF rules might fail under v2."

The purpose field itself was never explicitly captured as a standalone statement. The session extracted advantage and measurement but purpose remained implicit throughout: build a compliance checker integrated into the existing DMP tool.

## Goals

1. **Enable researchers to self-serve compliance validation** — reduce dependency on compliance staff by letting researchers independently verify their DMPs against funder requirements as they write.
2. **Consolidate and maintain authoritative funder policies** — create a single source of truth for funder DMP requirements that stays current, eliminating researcher guesswork across scattered PDFs, web pages, and email.
3. **Establish predictable compliance outcomes** — when the tool says a DMP passes, it actually passes. The respondent flagged that this is "the dream, but I'm not sure it's fully achievable" because some requirements need judgment calls that funders themselves interpret inconsistently.
4. **Flag and surface multi-funder requirement conflicts without resolving them** — when a researcher selects multiple funders, show overlapping requirements and genuine contradictions. Also covers version drift when funder rules change mid-cycle. "We're not giving legal advice or making judgment calls for them. Just surfacing the problem."

## Stakeholders

**Researchers** (primary) — need real-time or near-real-time feedback integrated into the DMP writing tool, not a separate post-hoc checker. "They don't want to export it, run it through some separate checker, wait for results, then come back and edit."

**Funders** (primary, merged with funder program officers) — rules are not machine-readable, published across PDFs, web pages, and grant guidance. No formal mechanism to notify institutions of policy changes. Different program officers interpret the same requirement differently, and informal guidance sometimes contradicts published policy.

**Compliance team / institutional reviewers** (secondary, respondent's team; merged with legal/risk management and ethics committees) — currently spot-check DMPs manually against scattered policy docs, flag gaps, send back for revision. Most concerned about funder policy changes the institution doesn't know about: "six months later NSF updated their policy and we didn't know." Ethics committees weigh in when research involves human subjects, creating internal conflicts similar to the multi-funder problem. *(Respondent)*

**Librarians** (secondary) — second-line interpretation support when the tool flags an issue. "A researcher might come to a librarian and say 'what do I do about this?'" Support is inconsistent — depends on which librarian and whether the researcher knows to ask.

**Data stewards** (secondary) — need early visibility into researcher commitments to verify institutional feasibility. "If a researcher promises NSF they'll store data in a specific repository for seven years, we need to know that's something we can actually support."

**Department heads** (secondary) — not monitoring funder policies themselves. React when researchers get rejected or compliance team flags problems. Care about departmental reputation.

**IT administrators** (secondary) — must integrate the checker with the production DMP tool. Care about data format compatibility, scalability, and whether the system breaks when funder rules update.

**Repository managers** (secondary) — need visibility into data management commitments because those affect institutional repo capacity (e.g., "researcher promises open for five years, repo can only commit to three").

**Grant management system staff** (secondary) — track which grants require DMPs and deadlines; may need to flag unchecked or unapproved DMPs before grants go out.

## Scope

**In scope**
- Real-time or near-real-time compliance feedback integrated into the DMP writing tool
- Funder-specific requirement validation showing which rules a DMP satisfies or violates
- Consolidation and maintenance of funder policy rules in machine-readable form
- Detection and surfacing of multi-funder requirement conflicts (without resolving them)
- DMP version drift tracking — which version of funder rules a DMP was checked against
- Mechanism to detect and surface funder policy changes
- Validation accuracy sufficient for researcher trust in the tool's judgment
- Multi-format DMP input: structured JSON from the online editor, Word documents, PDFs, plain text
- Flag institutional capability conflicts (e.g., promised storage exceeds repo capacity) for data steward review — flag, don't block
- Binary presence validation for judgment-call requirements; adequacy assessment stays with compliance officers
- Basic guidance alongside flags — point to the policy doc, explain what the requirement means in plain language, but don't suggest how to revise the DMP

**Out of scope**
- Funder analytics and compliance trend tracking — "more of a funder analytics thing"
- Resolving conflicts between ethics committee requirements and funder requirements — tool surfaces, does not resolve
- Proactive notification system to push funder policy changes to institutions

**Constraints**
- Cannot hire new staff to maintain funder policy database; the update process must be lightweight
- DMP tool is in production; compliance checker must integrate without breaking existing researcher workflow
- Must handle multiple DMP input formats or institution will spend excessive time converting
- Versioning and backfilling policy for rule changes must be established before launch — "if a funder updates their policy mid-year and we don't have a clear answer about what happens to already-approved DMPs, we're going to get caught in arguments about compliance"

## Uncertainties

**Unresolved tensions**
- Goal 4 says "don't resolve conflicts," but the compliance team expects ethics-versus-funder conflicts to be "sorted out and resolved." The respondent acknowledged this: "pretending it doesn't need resolving isn't realistic." The tool surfaces the conflict, but the escalation path and decision authority are undefined. "Does it go to me? To a compliance officer? Do we have authority to tell a researcher 'you can't make that commitment to NSF'? Right now that's murky."
- Constraint 1 assumes lightweight maintenance of funder policies, but no formal notification mechanism exists from funders and no success criteria define what "lightweight" means. The respondent was direct: "Monitoring funder websites manually is *not* lightweight. Someone has to own that."
- Ethics review responsibility overlaps between compliance team and data stewards. The respondent's resolution: "tool flags institutional capability conflicts, data stewards review them, compliance team handles ethics conflicts separately. Not ideal, but it works if we document it."

**Assumptions**
- The tool validates binary presence of required elements but cannot judge adequacy; adequacy stays with compliance officers.
- The institution is responsible for actively monitoring funder websites; the tool surfaces detected changes but does not replace monitoring.
- Manual spot-checking is workable for individual DMPs; systemic problems (policy fragmentation, version drift, conflicting rules) require tool-driven solutions.
- Tool guidance must be actionable (point to specific policy sections) but not prescriptive (no revision suggestions).
- Librarians serve as second-line interpretation support; the tool provides first-line context to reduce ad-hoc support volume, not replace librarians.

**Finding**
- Policy change detection is critical — researchers currently discover outdated policies six months post-submission when a DMP gets flagged in funder review, creating audit and reputational risk.

**Respondent's closing concerns:** Three items the respondent wants resolved before build: (1) explicit escalation path and decision authority for ethics/funder conflicts, (2) clarity on who owns lightweight maintenance and whether it's actually feasible, (3) documented protocol for the ethics/data steward split in validation workflow.

## Session stats

| Metric | Value |
|---|---|
| Questions asked | 27 |
| Purpose fields | 2/3 (advantage, measurement; purpose never explicitly captured) |
| Goals | 4 |
| Stakeholders | 9 (3 merged during dedup) |
| In-scope items | 10 (after dedup) |
| Out-of-scope items | 3 |
| Constraints | 4 |
| Assumptions | 5 |
| Findings | 1 |
| Agent model | Haiku 4.5 |
