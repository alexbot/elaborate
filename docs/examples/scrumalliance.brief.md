# Scrum Alliance community platform

> *"Right now, members scattered across different systems — their training history lives one place, certification records another, maybe some community contributions elsewhere. There's no single view of 'here's who I am as a practitioner.'"*

## Summary

Scrum Alliance wants a central platform to consolidate member certification data, trainer course listings, and recruiter talent search into one ecosystem. The respondent — speaking as Scrum Alliance staff — framed the core problem as member attrition: people get certified and disappear because they don't understand renewal cycles, SEU requirements, or what training counts. The most consequential tension in the session: every quality gate (course approval, job posting verification) depends on staff bandwidth the respondent admits is already stretched.

## Purpose

Members are scattered across disconnected systems with no unified view of their professional identity. The platform consolidates certification records, training history, and community contributions into a single home where members see what they hold, what's expiring, and what training gets them there. The respondent put it bluntly: "Right now people don't know they're slipping out of compliance."

The advantage breaks down by stakeholder. Members own their professional identity in one place — "update once, it's live everywhere." The Alliance gets data on certification trends and gaps to guide strategy. Recruiters get a vetted talent pool. Trainers get "a legitimate stage" in the Alliance ecosystem instead of scattered course listings on their own sites. The through-line is member stickiness: "Right now, people get certified and disappear. We want them to stay engaged, renew on time, invest in the community."

Measurement centers on renewal rates as the primary metric — the respondent called it "the hard metric" and "the north star." Secondary: trainer adoption, measured by CSTs listing courses *and* those courses being approved and published by staff (the respondent revised the original metric to include the publication gate: "adoption isn't just 'trainers list courses,' it's 'trainers list courses and they get published'"). Third: recruiter traction, measured by job postings receiving real applications from qualified candidates.

## Goals

1. **Establish member identity as the system of record** — a single authoritative source for certifications, training history, and renewal status, eliminating fragmentation across systems.
2. **Enable trainer participation as a legitimate ecosystem function** — CSTs list courses within Alliance quality gates; publication by staff is the credibility signal. No review systems or ratings — "if a course is published on this platform, that *is* the credibility signal."
3. **Drive member engagement through certification clarity and renewal behavior change** — surface what members hold, what's expiring, and what training counts toward renewal. Scope explicitly limited to renewal behavior, not community discovery: "We're not building a LinkedIn for Scrum people."
4. **Connect recruiters to qualified talent reliably** — recruiters search by active, verified certifications (not self-reported). Members opt in to recruiter visibility. The platform — not recruiters — verifies that companies posting jobs are real and positions exist, preventing spam.

## Stakeholders

**Scrum Alliance community platform users** (primary) — need a single view of certifications, renewal deadlines, and SEU requirements. Most don't understand the renewal cycle: "They renew their cert and think they're done, then two years later they're shocked it expired."

**Certified practitioners** (primary) — need Alliance-backed proof of certification status for recruiters and prospective clients, with opt-in control over recruiter visibility.

**Trainers / CSTs** (primary) — want Alliance legitimacy for their courses. Will adopt the platform if it gives them "Alliance credibility and member reach," but only if members are actually using it.

**Recruiters** (primary) — need to search by active certifications verified by the Alliance, contact opted-in members through the platform, and trust that credentials are real. ATS integration is their own responsibility.

**Scrum Alliance staff** (primary, respondent) — quality gatekeeper for course listings, certification lifecycle administrator, and strategic data consumer. Every course listing gets reviewed before publication. Staff also manages two-year renewal windows and SEU requirement enforcement.

## Scope

**In scope:**
- Member identity system of record — central profile aggregating certifications, training, and renewal status
- Certification clarity interface — active certs, expiration dates, renewal windows, SEU requirements
- Renewal behavior enablement — surface pathways and time-gated windows to drive proactive renewal
- Course listing and approval — CSTs list courses; staff approves before publication
- Recruiter access to verified talent — searchable pool filtered by active, verified certifications
- Alliance verification of certifications — platform asserts status verified by the Alliance, not self-reported
- Training trend data — staff access to data on which certifications are trending
- Job posting verification — platform verifies company legitimacy and position existence before postings go live

**Out of scope:**
- ATS integration with recruiter workflows — recruiters own that responsibility
- General community features or social engagement tools — "not everyone wants community; some just want their credentials managed cleanly"
- Trainer credibility signals beyond Alliance approval (reviews, ratings, gamification) — "the Alliance approval stamp is the credibility signal. That's it."

**Constraints:**
- Must integrate with existing Scrum Alliance certification database as single source of truth; cannot replace or duplicate it
- GDPR compliance required where applicable; member consent required for data sharing with recruiters
- Platform design must be operationally manageable for a small staff team — heavy staff involvement in review gates creates a bottleneck

## Uncertainties

**Unresolved tensions:**
- Job posting verification requires staff to gate recruiter listings the same way they gate courses, but the respondent flagged staff bandwidth as an operational constraint. The respondent pushed back on this being a contradiction: "verify the company is real" could be automated (domain checks, public records, registration info upfront), with staff reviewing only flagged items. "That's different from course approval, where staff needs to actually read and evaluate content." This design detail is unresolved.
- The boundary between "searchable pool on the platform" and "recruiter workflows" was flagged as ambiguous. The respondent dismissed it: the platform builds a recruiter-facing search interface; recruiters manage their own ATS workflows with the candidate list they retrieve. No API integrations or connectors. The respondent characterized both findings as "design details I haven't specified yet" rather than contradictions.

**Assumptions:**
- Recruiters own responsibility for integrating the platform's verified candidate data into their own ATS systems; platform provides searchable access only.

## Session stats

| Metric | Value |
|---|---|
| Questions asked | 24 |
| Purpose fields | 3/3 |
| Goals | 4 |
| Stakeholders | 5 (1 removed as redundant) |
| In-scope items | 8 |
| Out-of-scope items | 3 |
| Constraints | 3 |
| Assumptions | 1 |
| Findings | 2 |
| Agent model | Haiku 4.5 |
