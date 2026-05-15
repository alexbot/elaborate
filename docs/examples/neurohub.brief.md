# NeuroHub: provenance and compliance for neuroscience research data

> *"We need a platform for neuroscience researchers to store, share, and analyze brain imaging data — things like fMRI scans, electrophysiology recordings, and the datasets we derive from them. The tricky part is tracking where everything came from and controlling who can access what, especially since we have IRB restrictions on sharing."*

## Summary

Neuroscience labs share brain imaging data using email, Dropbox, and inconsistent file servers. When a dataset needs to leave the institution, nobody can reliably answer "where did this come from?" or "who's allowed to see this?" NeuroHub replaces that manual detective work with immutable provenance tracking and automatic consent enforcement — but the hardest design tension is that it promises both frictionless sharing and strict compliance, which pull in opposite directions when a PI's decision conflicts with IRB restrictions.

## Purpose

The platform's core value is answering two questions instantly: *what produced this dataset?* and *who can access it?* Centralized storage matters but is "the easy part" — the respondent deprioritized it repeatedly.

**Advantage.** Provenance tracking captures the full lineage of any result — which pipeline version, what parameters, which source files — eliminating the current process of "digging through emails, lab wikis, sometimes calling the PI directly." Dataset-level access control enforces consent scopes automatically, replacing ad-hoc lab PI decisions with institutional oversight.

**Measurement.** Three success metrics, in priority order: (1) audit trail completeness — reconstruct the full chain from raw acquisition through pipeline and parameters to final dataset without gaps; (2) compliance speed — answer IRB access queries in minutes, not days; (3) reduced sharing friction — automatic consent enforcement so researchers spend less time on compliance overhead. The respondent added a hard requirement during confirmation: published datasets must be immutable and versioned. *"Once a dataset version is published, it can't be modified retroactively — only superseded by a new version."*

## Goals

1. **Enable reproducible research through provenance tracking** — reconstruct the full lineage of any published result from raw acquisition through pipeline, parameters, and final dataset. The respondent flagged that "complete" needs narrowing: guaranteed for HPC workflows, documented-or-blocked for local analysis.
2. **Enforce consent compliance automatically across studies** — apply access control at the dataset level, enforcing consent scopes so IRB access requests can be answered in minutes. "Reduced friction" applies to legitimate sharing; compliance violations still require steward override.
3. **Create a unified, immutable archive for research data** — centralize scattered data into a single platform where published datasets are versioned and immutable, with change tracking and full history.
4. **Integrate with existing workflows without forcing migration** — the platform works with the HPC cluster and local analysis tools (Python, MATLAB) already in use. HPC integration captures provenance automatically via the job scheduler; local workstation analysis is supported via optional API. *"Run your job on HPC like you always do, and we track it."*

## Stakeholders

**Neuroscience researchers** (primary) — run analyses on HPC and local workstations; need the platform to track provenance without changing their workflows.

**Lab PIs** (primary) — control access to their lab's data and want autonomy over sharing decisions, but also want the system to catch compliance mistakes automatically. *"PIs want control without liability."*

**Institutional data governance team** (secondary, respondent) — the respondent is one member of a multi-person team that oversees compliance across labs and studies, coordinates with IRB/compliance officers, and needs override authority when labs head toward violations. They currently verify consent and trace provenance manually — "ad-hoc, person-dependent, and slow."

**IRB / compliance officers** (secondary) — verify IRB protocol scope, confirm de-identification adequacy (brain imaging data can be re-identified from anatomical scans), and audit dataset contents before external sharing. The most time-consuming task is confirming a dataset is what the lab claims it is.

**HPC cluster administrators** (secondary) — set up and maintain the job scheduler integration for automatic provenance capture; not gatekeepers after initial setup.

## Scope

**In scope:**
- Provenance tracking system capturing full lineage (raw acquisition through pipeline, parameters, to final dataset), with guaranteed capture for HPC and documented-or-blocked enforcement for local analysis
- Consent compliance enforcement at the dataset level with automatic access control based on IRB protocol scope
- HPC cluster integration via job scheduler for automatic provenance capture (job scheduler + pipeline capture only; no raw data ingest from acquisition hardware)
- Optional API for custom analysis workflows not running on HPC
- Immutable versioned archive for published datasets with change tracking
- Access audit trail (who accessed what, when, why) for breach investigation and regulator reporting
- LORIS data import capability — researchers import without manual export/re-upload
- Metadata normalization: compliance-critical fields (IRB protocol ID, consent scope, acquisition date, dataset version) normalized and required; everything else accepted as-is
- Institutional override authority for data stewards to block PI decisions on compliance violations

**Out of scope:**
- De-identification verification — regulatory assessment, not platform capability
- Raw data ingest from acquisition hardware (scanner/rig integration) — deferred; heterogeneous formats, network constraints, and IRB sensitivities make this a separate problem
- Replacing lab PI data access decision-making — PIs retain autonomy; platform enforces boundaries

**Constraints:**
- Data accessible for 10+ years (funder requirement)
- Brain imaging files are massive (NIfTI/DICOM, 50GB+ per session) — affects versioning design, metadata storage strategy, and upload feasibility
- HPC integration must not require researchers to change analysis workflows
- Automatic enforcement for routine compliance violations (consent scope, retention dates)
- Data stewards retain override authority for edge cases requiring judgment

## Uncertainties

**Unresolved tensions:**
- **10-year retention vs. storage scale.** Immutable versioning of 50GB+ files across 10+ years will grow storage costs. The respondent suggested tiering (recent + published versions online, older snapshots archived) but called it "a design decision, not something I can resolve in this conversation."
- **"Complete" provenance vs. local analysis gaps.** Goal 1 promises complete provenance, but assumption 1 acknowledges perfection is impossible. The respondent proposed narrowing: "complete for HPC, documented for local." The documented-or-blocked gate adds friction that goal 4 (integrate without forcing migration) promised to avoid — though the respondent argued researchers already document pipelines, so it's "a reasonable gate."
- **Automatic compliance vs. PI autonomy.** The platform cannot both guarantee automatic enforcement and preserve PI decision-making when PIs choose to violate constraints. Steward override (constraint 5) is the resolution, but it introduces overhead that conflicts with "reduced friction for sharing." The respondent accepted this trade-off: *"PIs run their labs, but if they're headed toward a violation, we step in."*

**Findings:**
- Institutional file servers store raw data with inconsistent folder structures — no standardized way to map files to provenance metadata
- Electrophysiology data shared via email or Dropbox with inaccurate or stale README files — external documentation cannot be trusted for provenance
- Scanner/rig integration deferred due to heterogeneous export formats, per-device network constraints, and IRB sensitivities around data landing zones

**Assumptions:**
- Perfect provenance tracking is impossible; the system captures what it can and accepts incomplete lineage where documentation is missing
- Steward verification of consent scope is sufficient for local analysis — the platform does not guarantee end-to-end provenance for manual workflows, only that declarations match reality and consent is in scope

## Session stats

| Metric | Value |
|---|---|
| Questions asked | 24 |
| Purpose fields | 3/3 |
| Goals | 4 |
| Stakeholders | 5 |
| In-scope items | 9 |
| Out-of-scope items | 3 |
| Constraints | 5 |
| Assumptions | 2 |
| Findings | 3 |
| Agent model | Haiku 4.5 |
