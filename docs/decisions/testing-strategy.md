---
title: Testing strategy — three-tier evaluation architecture
status: accepted
---

## Context

Elaborate has 335 deterministic tests (mock resolvers, no LLM) covering process mechanics, phase sequencing, state management, and persistence. A coverage analysis identified two entirely uncovered surfaces:

- **ND-unit**: single LLM call tests (extraction quality, composition diversity, classification accuracy). Cheap (~$0.01–0.05/test), fast, diagnosable.
- **ND-e2e**: full-session tests with simulated stakeholders. Expensive (~$1–5/test), slow, requires a judge to interpret.

These two ND surfaces differ in cost, run frequency, infrastructure needs, and failure modes. Treating them as one tier either means never running the cheap ones (because the expensive ones make the suite too slow) or losing the ability to isolate prompt regressions from interaction regressions.

A two-tier architecture (deterministic validators + LLM-as-judge) validates the core approach but doesn't distinguish ND-unit from ND-e2e. When every non-deterministic test is implicitly session-level, cheap prompt-quality checks get blocked behind expensive full-session runs.

A 2025 study on LLM-conducted interviews established that ground truth is interview methodology, not reference output: evaluate whether the interview followed Socratic discipline and discovered constraints, not whether the output document matches a reference.

## Decision

### 1. Three-tier evaluation architecture

**Tier 1 — Deterministic validators** (CI, every run)
- Infrastructure: vitest + existing mock-resolver pattern.
- Content: existing 335+ tests, plus structural validators (no-self-resolution, trace-provenance, budget-compliance, waiting-room-lifecycle, confidence-monotonicity, chokepoint-routing).
- Gate: pass/fail. Any failure blocks.
- Cost: $0.
- Structural advantage: validators operate on the durable state log and structured artifacts, not regex patterns on transcript text.

**Tier 2 — Prompt quality** (on-demand, CI-graduable)
- Infrastructure: real LLM calls through Elaborate's interview layer, schema validation, content assertions.
- Content: single-LLM-call tests for extraction, composition, classification, and seed quality. ~20–30 test cases.
- Data: test fixtures (input strings + expected outputs) alongside test code. No scenario files, no simulated stakeholder.
- Gate: output matches expected Zod schema + key content assertions pass.
- Flakiness handling: run each test 3 times, pass if 2/3 succeed (majority vote).
- Cost: ~$0.01–0.05 per test. Full T2 suite: $0.20–1.50.
- CI graduation criteria: stable over 5+ consecutive runs, <$0.05/test, <15s latency.

**Tier 2 test anatomy:**
1. Test constructs a realistic input (e.g., messy user response with embedded goals).
2. Test calls the real LLM through Elaborate's interview layer (e.g., `ctx.extract` with preamble + schema).
3. Test asserts on the structured output: schema compliance, key content present, no hallucinated content.

**Tier 3 — Session quality** (on-demand only, fully automated)
- Infrastructure: scenario runner, simulated stakeholder LLM, deterministic validators on transcript, LLM-as-judge.
- Content: multi-phase scenarios with hidden constraints. 8–12 scenarios minimum, at least 2 per capability tag.
- Data: YAML scenario files (see §2).
- Gate: constraint discovery rate ≥ threshold per scenario (≥60% hard, ≥70% medium, ≥80% easy). No per-capability regression ≥2σ below baseline.
- Cost: ~$1–5 per test. Full T3 suite: $5–50.

**Tier 3 test anatomy:**
1. Runner loads scenario YAML (problem statement, hidden constraints, behavioral directives, success criteria, capability tags).
2. Runner starts Elaborate session programmatically via adapter API.
3. Simulated stakeholder LLM receives hidden constraints + behavioral directives, auto-responds to every Elaborate prompt. Only reveals constraints when directly asked.
4. Session runs to completion or hits a stop condition.
5. Deterministic validators run on session transcript/state log.
6. Judge LLM receives hidden constraints + success criteria + full transcript + final artifacts. Evaluates constraint discovery, process compliance, quality dimensions.
7. Self-consistency: step 6 runs 3× (temperature 0.3), scores averaged, high-variance flagged (see §4).
8. Results compared against statistical baseline per capability tag.

No human in the loop during execution. Humans write scenarios, review results, update baselines.

### 2. Scenario format

```yaml
scenario:
  id: string
  source: { dataset, url, original_id }
  problem_statement: string
  domain: string
  hidden_constraints:
    - { category, constraint, discovery_cue? }  # or plain string
  success_criteria: string[]
  difficulty: easy | medium | hard
  start_type: greenfield | brownfield
  existing_context?: string  # brownfield only
  capability_tags: string[]         # which capabilities this exercises
  behavioral_directives:            # per-turn stakeholder behavior scripting
    - { turn: number, directive: string }
  mid_conversation_assertions:      # checkpoints during session
    - { condition: string, by_turn?: number }
```

`behavioral_directives` replace a fixed persona enum (cooperative/indecisive/overconfident/contradicting) with per-turn scripting. A "cooperative" scenario has no adversarial directives. A "contradicting" scenario has directives like "contradict your turn-3 answer on turn 8."

### 3. Metrics — gates vs measurements

**Gates** (automated, regression triggers):

| Gate | Tier | Type |
|---|---|---|
| Deterministic validators | T1 | pass/fail, any failure blocks |
| Schema compliance (output matches Zod schema) | T2 | pass/fail |
| Key content assertions | T2 | pass/fail |
| Constraint discovery rate ≥ threshold | T3 | per-scenario threshold by difficulty |
| Per-capability regression ≤ 2σ below baseline | T3 | statistical, per capability tag |

**Measurements** (tracked for human trend review, not gating):

| Measurement | Purpose |
|---|---|
| Quality dimensions from judge (relevance, completeness, efficiency) | Detect slow degradation across releases |
| Session length (prompt count, LLM call count) | Detect interview chattiness drift |
| Cost per session | Operational planning |
| Judge variance | Meta-metric: signals rubric ambiguity |

Measurements are persisted to a `results/` directory with timestamped JSON per run, enabling cross-release trend comparison.

### 4. Judge design — self-consistency, not multi-judge

Single judge model, run 3× per scenario with temperature 0.3. Average scores. Flag any scenario where intra-judge variance exceeds σ > 15 points on any dimension — high variance means the rubric is ambiguous for that scenario, not that the average is trustworthy.

Judge model must differ from generation model to avoid self-enhancement bias (e.g., if Elaborate runs on Sonnet, judge on Opus). Final choice subject to empirical validation.

**Judge rubric:**
- **Constraint discovery**: per-constraint discovered/not-discovered with evidence quotes. Primary metric.
- **Process compliance**: did Elaborate follow Socratic backbone? Surface ambiguity without self-resolving? Maintain traceability? This is the "ground truth is methodology" principle operationalized.
- **Quality dimensions**: question relevance, completeness, interview efficiency.

Multi-judge consensus deferred. If data later shows single-judge bias is a problem, revisit.

### 5. Regression detection (T3 only)

Each scenario is tagged with 1+ capability tags derived from Elaborate's architecture (e.g., goal discovery, deviation resilience, cross-phase coherence). Minimum 2 scenarios per capability tag.

**Baseline computation**: Run each scenario N times (N≥3, prefer 5) on reference version. Compute mean and σ per capability tag. Store as `baselines.json`.

**Regression threshold**: Flag if current score drops below (mean − 2σ). Handles LLM non-determinism: stable tests have tight thresholds, noisy tests have loose ones.

**Filtered runs**: Runner supports `--capability=<tag>` to run only tagged scenarios for focused debugging.

T2 tests are binary pass/fail — no per-capability scoring or statistical baselines needed.

## Consequences

**Positive:**
- Three-tier split lets each tier run at its natural frequency without blocking the others.
- T2 catches prompt regressions cheaply. Most prompt changes only need T2 + T1 to validate.
- T3 catches interaction regressions that no unit test can detect.
- CI graduation path means T2 coverage grows over time without upfront commitment.
- Statistical baselines accommodate LLM non-determinism instead of fighting it.
- Fully automated T3 enables hands-off evaluation runs.

**Negative:**
- Three tiers means three sets of infrastructure to build and maintain. More complex than two.
- T3 is expensive enough that it won't run on every commit. Regressions that only T3 catches may persist until the next on-demand run.
- Self-consistency judge (3×) triples judge cost. Acceptable at 8–12 scenarios, but won't scale to hundreds.
- Statistical baselines require initial calibration runs (N≥3 per scenario) before they're useful. Cold-start cost.
- LLM-as-judge inherits known reliability issues (position bias, verbosity bias). Structured rubric + self-consistency mitigate but don't eliminate.
