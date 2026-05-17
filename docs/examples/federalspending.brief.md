# Modernize federal financial assistance submission pipeline

> *"I'm playing a federal financial assistance stakeholder in an interview about a modernization project that's already defined. I'm not the one with a vague idea needing clarification."*

## Summary

Federal agencies submit financial assistance data (grants, loans, direct payments) through FABS, a pipeline plagued by slow validation feedback, scattered audit trails, and a one-size-fits-all submission model that ignores the gap between technically mature agencies and regional offices uploading CSVs. This project replaces FABS with a modernized submission system that integrates with SAM, FPDS, and USAspending.gov. The single most consequential tension: the system must own a 2-3 business day feedback SLA derived from the 30-day statutory correction window, but external dependencies like SAM entity validation (up to 48 hours, uncontrollable) create latency the system cannot eliminate — only make visible.

## Purpose

The system modernizes federal financial assistance submission by replacing the FABS pipeline while preserving integration with three external systems: SAM for entity validation, FPDS for procurement context, and USAspending.gov for public reporting.

The advantage is three-pronged: agencies get a better submission experience, internal teams get reliable validation and audit trails, and the public gets accurate reporting without multi-week delays. The respondent was clear about priority order — "Fix the submission experience first, and the rest gets easier."

Success is measured by four criteria the respondent defined with increasing specificity across two rounds. Agencies stop getting stuck in rejection loops through upfront validation and clear error messages. Every submission, correction, and certification action is logged with user identity and timestamp in an immutable audit trail — the respondent sharpened this from a feature to a regulatory compliance requirement: "it's not optional nice-to-have, it's compliance. That might matter for how the team thinks about the architecture." Data flows to USAspending.gov automatically once certified, eliminating manual handoffs. Agencies submit via API or CSV depending on technical capability.

The respondent added a hard constraint during purpose confirmation: agencies have 30 days to fix rejected submissions before statutory reporting deadlines, making validation feedback turnaround a compliance issue, not a convenience.

## Goals

1. **Enable agencies to resolve validation errors within statutory deadlines** — rapid error detection with clear remediation guidance, accounting for validation rule versioning across fiscal years (what's valid in FY25 may not be valid in FY26; agencies must know which rule version applies at submission time, and prior-year rules stay immutable).
2. **Create an immutable audit trail for all submission lifecycle events** — every submission, correction, and certification logged with user identity, timestamp, and action type; tamper-proof and queryable by auditors without requiring system access.
3. **Establish standardized integration contracts for SAM, FPDS, and USAspending.gov** — documented APIs and data contracts for entity validation, procurement alignment, and public data export, with detectable integration failures.
4. **Support both API and CSV submission workflows** — CSV for smaller agencies without dedicated IT (interactive upload/feedback/retry on monthly or quarterly cycles), API for larger agencies with mature systems (real-time or daily batch). Both validate against identical rules, produce identical audit trails, and handle identical correction workflows. "The difference is operational, not technical."

## Stakeholders

**Agency data submitters** (primary) — grant managers, finance staff, regional coordinators who fill out forms or upload files; need the system to be straightforward and feedback fast because "they're not IT, they're program managers."

**Federal financial assistance oversight** (primary, respondent) — oversees submission workflows and validation across grants, loans, and other assistance types; lives "at the intersection of operational reality and compliance requirements," explaining submission failures to agencies and audit trail gaps to auditors.

**Grants administrators** (primary) — manage grant programs and submit award data; currently doing manual legwork pulling, reformatting, and re-uploading data, then waiting days for feedback; have internal reporting deadlines that don't align with statutory windows.

**Loans administrators** (primary) — handle ongoing transaction flows (originations, then continuous servicing updates); validation errors don't distinguish origination from servicing problems, and correction tracking at weekly/daily cadences is "a nightmare" on spreadsheets.

**Agency workflow operators** (primary) — triage validation feedback and route it to the right people in each agency; have no centralized tracking ("right now it's email, spreadsheets, sometimes a shared drive nobody can quite find") and lose visibility into which agencies will hit the 30-day deadline.

**USAspending.gov operators** (secondary) — need validated data flowing automatically with no manual handoffs; raised PII redaction as a critical concern ("we've had near-misses on publishing sensitive information").

**Federal auditors** (secondary) — verify chain of custody for submissions; currently reconstruct audit trails from fragments across FABS, email, spreadsheets, and separate certification systems; "if we can't prove the chain of custody, we fail the audit."

**SAM maintainers** (external) — a constraint, not a collaborator; entity validation takes up to 48 hours and cannot be accelerated; need clear API contracts and no duplicate validation logic.

**FPDS integration teams** (external) — provide read-only procurement context; FPDS stays autonomous and the submission system never writes to it.

The respondent reclassified three groups out of the stakeholder list: data validation teams and system integration teams (internal delivery, not decision-makers) and accounting system vendors (external dependency, no buy-in needed).

## Scope

**In scope:**
- Unified validation engine processing both API and CSV submissions against versioned rulesets
- Immutable audit trail logging every submission, correction, and certification action
- Validation feedback delivery within 2-3 business day SLA, with system-owned notifications
- Validation rule versioning by fiscal year with immutable submission-to-rule mapping
- Read-only SAM integration with automatic queueing when entity validation is pending, clear status messaging to agencies, and operator override capability
- Read-only FPDS integration for procurement context with error categorization by owning system
- Centralized submission tracking and correction workflow visibility
- Support for both origination and servicing data with distinct validation paths
- Submission queue visibility for agencies and operators ("your submission is queued, position 5 of 12, estimated completion [date]")
- Automated certified-data handoff to USAspending.gov

**Out of scope:**
- PII redaction for USAspending.gov publication (ownership boundary — USAspending.gov operators own redaction)
- SAM entity registration process or approval workflows (external system boundary)
- FPDS procurement data writes (FPDS stays autonomous, read-only consumer)
- Internal grant program management or award decision logic
- Accounting system mapping or vendor training (vendor/agency responsibility)
- USAspending.gov publication SLA and timing (system integration team call, not submission system)

**Constraints:**
- DATA Act compliance rules change every fiscal year; submissions validated under rules in effect at submission time, never retroactively
- 30-day statutory correction window for agencies to fix rejections
- SAM entity validation latency up to 48 hours, unmodifiable
- Submission files reach 500MB+ with millions of records; bulk validation must be async
- Must support both API and CSV without building two separate systems
- Immutable audit trail is regulatory, not optional
- Versioned validation rules are immutable once deployed — bugs in FY25 rules patch forward to FY26 or are accepted; "you're not maintaining one set of rules that evolve; you're maintaining versioned snapshots"

## Uncertainties

**Unresolved tensions:**
- Goal 3 requires standardized integration contracts with USAspending.gov, but the out-of-scope boundary excludes USAspending.gov publication SLA ownership — the system owns data handoff but not the contract detail needed to fully achieve the goal.
- Submission queue visibility (agencies and operators seeing queue position and estimated completion) was requested as in-scope by the respondent but was not formally captured before the session ended.

**Unknowns:**
- SAM queueing escalation semantics are undefined — does "escalate" mean expediting SAM validation (technically infeasible?) or bypassing it (compliance-permitted?). Needs design decision before build.
- SAM latency prediction reliability — the respondent expects the system to show "expected by [date]," but whether SAM latency estimates are deterministic or probabilistic is unspecified.
- Whether other external system latencies (FPDS reads, downstream SLA checks) should trigger the same queueing-with-status protocol designed for SAM, or whether SAM is special.
- Rule deployment handoff protocol — the system needs "clear notice and a clean handoff process" from compliance/policy teams, but the specification of what that means is deferred.

**Assumptions:**
- Rule authoring and deployment sequencing belong to compliance/policy teams, not the submission system. The respondent was firm: "If we start authoring rules, we're making compliance decisions we shouldn't be making."
- Validation feedback must return within 2-3 business days to give agencies sufficient time within the 30-day window — not arbitrary, derived from the math of complex fixes requiring vendor coordination or SAM escalation.
- Actionable feedback means three elements: the specific field that failed, what it should be, and an example.
- Accounting system vendors are affected by data contracts but do not require buy-in.
- USAspending.gov publication SLA is owned by system integration teams, not the submission system.

**Respondent's unaddressed revision (session ended before applied):** The respondent pushed back on finding_006, arguing the 2-3 day feedback target is derived from 30-day window math, not operational preference. They also requested submission queue visibility be added to in-scope.

## Session stats

| Metric | Value |
|---|---|
| Questions asked | 27 |
| Purpose fields | 3/3 |
| Goals | 4 |
| Stakeholders | 9 (5 primary, 2 secondary, 2 external) |
| In-scope items | 10 |
| Out-of-scope items | 6 |
| Constraints | 7 |
| Assumptions | 9 |
| Findings | 5 |
| Agent model | Haiku 4.5 |
