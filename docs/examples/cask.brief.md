# Data pipeline platform for developers

> *"A data application platform for developers to build, deploy, and manage data pipelines. It has dataset types, pipeline orchestration, a hydrator for ingestion, and a plugin architecture."*

## Summary

A brownfield data platform that lets developers assemble, deploy, and operate data pipelines from modular components. The session surfaced a recurring architectural tension: the platform serves both internal teams and external customers through a shared core, but the boundary between core and customer-facing layer (billing, SLAs, usage enforcement) remains partially defined. The respondent's sharpest reframe was on measurement — shifting from "time to first working pipeline" to "time to production pipeline with confidence," because "anyone can slap something together in minutes. The real friction is getting it reliable enough to run unattended."

## Purpose

Developers build and run data pipelines by assembling workflows that ingest, transform, and output data. The advantage is twofold: the plugin architecture eliminates boilerplate orchestration and connectivity (developers snap in new data sources or transformers without touching core pipeline code), and operators get direct visibility into pipeline failures instead of digging through logs after an alert.

The respondent revised the measurement during confirmation. The initial framing — time to first working pipeline drops from hours to minutes — was too shallow. What matters is time to *production* pipeline: "Pipeline goes from dev to running in production with confidence." That confidence includes debugging speed (developers know exactly which step failed and what the inputs were) and graceful retry behavior (the pipeline doesn't blow up when something goes wrong). Error message quality was identified as the adoption driver: "Developers hate black boxes. If a pipeline fails and the error message is vague, they bail and write their own thing."

## Goals

1. **Enable rapid pipeline assembly and iteration** — developers compose pipelines from modular components without writing orchestration boilerplate; new data sources or transformers integrate via the plugin architecture without modifying core code.
2. **Provide fast failure diagnosis and recovery** — when a pipeline fails, operators see which step failed and what inputs it received. Pipelines support graceful retry so transient failures don't cascade into outages.
3. **Accelerate pipeline promotion from dev to production** — the same pipeline definition runs locally and in production with consistent behavior, debugging visibility, and retry guarantees.
4. **Isolate and contain third-party plugins** — plugins run in separate processes with resource limits (CPU/memory caps) and access controls that prevent cross-team data access. A plugin crash fails that pipeline step but cannot take down the platform or leak data to another team. The respondent was explicit: "Plugin crashes are acceptable and expected. But it shouldn't take the whole platform down or leak data to the wrong team."
5. **Support schema evolution without breaking existing pipelines** — datasets are versioned independently; a pipeline pins to a specific schema version and keeps working after newer versions are published. Schema coordination was called "a silent killer" — "you publish a new schema version and suddenly half your pipelines are broken without anyone knowing why."

## Stakeholders

**Pipeline developers** (primary, respondent) — split into two groups during the session. Internal developers care about speed and visibility. Customer-facing developers also care about pricing, SLAs, and whether the platform scales to their dataset size without breaking or getting expensive.

**Operators** (primary) — need to see which step failed and what data it was processing before anything else. Current recovery involves manual restarts or one-off scripts, which burns production incident time.

**Plugin developers** (primary) — write connectors to new databases or transformation logic. Need a clean, documented plugin API so they can work independently. "If they have to patch core code or fight the framework, it stalls."

**Platform engineers** (secondary) — own uptime and stability. Need resource limits on plugins, visibility into plugin performance, and a vetting gate before plugins run. Explicitly separated data governance from their concern: "Platform engineers care about uptime and stability. Data policies are a separate function."

**Data governance / compliance** (secondary) — require end-to-end lineage traceability from source dataset through all transformation steps to final output. "If someone asks 'where did this number come from,' you need to answer in minutes, not days." Lineage described as "non-negotiable" and not optional compliance theater.

## Scope

**In scope**
- Plugin architecture with clean API and documentation for independent plugin development
- Fast failure diagnosis: identify which step failed and expose input data that caused the failure
- Built-in recovery: graceful retry and recovery from partial pipeline failures without manual restart
- Schema evolution: allow schema changes without breaking existing pipelines or requiring cross-team coordination
- Plugin isolation and resource containment: prevent data leakage between teams and resource exhaustion
- Consistent local and production pipeline execution with same debugging visibility and retry guarantees
- Data lineage tracking: source-to-output traceability for compliance and data quality debugging
- Dataset exploration with sub-2-second response times on TB-scale datasets without full scans
- Usage tracking to prevent resource exhaustion — per-team resource monitoring and enforcement
- Hybrid architecture: shared core engine (pipeline, plugins, failure visibility) with separate customer-facing layer for billing, usage tracking, and SLA enforcement

**Out of scope**
- Data policies, audit trails, and governance enforcement — separate function, not platform operations
- Data classification and access controls at dataset level — dataset-level concern, not pipeline-specific
- Retention policies and deletion workflows — downstream; becomes mechanical once lineage tracking exists
- Billing logic and SLA enforcement in the core — core emits billing-relevant data, customer layer enforces

**Constraints**
- Must run on Kubernetes infrastructure
- Avoid vendor lock-in on data storage — support multiple backends (Postgres, S3, Snowflake, etc.)
- Hydrator must handle both batch and real-time streaming with different consistency guarantees
- Lineage tracking non-negotiable for audit compliance
- Dead-letter queues for failed messages — failed records must be inspectable and replayable, not discarded

## Uncertainties

**Unresolved tensions**
- The "same product, different deployment" assumption creates a scope gap: if internal and customer-facing pipelines share identical codebase, the billing/usage tracking layer is part of the product — but the respondent explicitly scoped billing enforcement out of the core. Where the core's "emit billing data" responsibility ends and the customer layer's "enforce billing" begins is undefined.
- Plugin isolation goal is clear, but constraints don't specify the mechanism (sandboxing, separate processes, resource quotas). The respondent considers this engineering, not scope: "The goal is clear; the mechanism is engineering."
- Deployment model (internal infrastructure vs. customer-hosted vs. company-operated hosted) treated as orthogonal to product scope, but in-scope hybrid architecture item references it as core product definition. These two framings haven't been reconciled.

**Assumptions**
- Internal and customer-facing pipelines are the same product with different deployment modes — one codebase, deployment-mode configuration, not two separate products.

**Findings**
- Pricing models for customer-facing pipelines are missing from scope. The hybrid architecture mentions billing, but no artifact defines cost attribution or billing mechanics.
- SLA guarantees for customer-facing pipelines are mentioned but not defined — availability targets, latency commitments, and enforcement mechanisms are absent from requirements and constraints.

**Respondent's closing concern:** The respondent ended the session requesting four reclassifications: treat lineage and dataset exploration as architectural requirements rather than goal-connected features; clarify that the core emits billing data but doesn't enforce billing; reframe hybrid architecture as deployment reality rather than product design decision; and separate the resource isolation mechanism from the isolation goal. These were not applied to the artifacts.

## Session stats

| Metric | Value |
|---|---|
| Questions asked | 22 |
| Purpose fields | 3/3 |
| Goals | 5 |
| Stakeholders | 6 (incl. respondent) |
| In-scope items | 10 |
| Out-of-scope items | 4 |
| Constraints | 5 |
| Assumptions | 1 |
| Findings | 2 |
| Agent model | Haiku 4.5 |
