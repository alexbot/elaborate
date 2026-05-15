---
title: Extraction fidelity as observability
status: accepted
---

## Context

The agent performs all semantic work via `infer()` calls. Composition quality (ADR) controls what we *ask*; nothing observes what we *get back*. Bad extractions silently degrade session quality.

## Decision

**Lax key-presence checking in `infer()`**. Missing schema keys are a mismatch; extra keys are tolerated. Checking never blocks — fidelity is observability, not control flow. The workflow code remains the real validator.

**Counters rebuild from replay**. Instance-level state on the execution context, not persisted. The durable execution model gives this for free — every `infer()` runs the check on both replay and fresh calls.

**Logging as output vehicle**. Per-mismatch debug entries and a session summary warning, via existing logging infrastructure. No persistence changes, no status changes.

**`execute()` returns an `ExecutionResult`** that includes fidelity data alongside other execution-level concerns. This keeps the framework's return type extensible without coupling it to any single concern.

## Consequences

- Weak LLM models or poor prompt design become diagnosable from `.elaborate/log.jsonl`.
- Session-level aggregation can be built later by reading log data.
