# Tests

## Structure

- `__tests__/` — Evaluation tests (judge validation, schema checks)
- `harness/` — T3 evaluation harness (scenario runner, simulated stakeholders, LLM judge)
- `scenarios/` — YAML scenario definitions for session-quality evaluation
- `validators/` — Deterministic validators (budget compliance, confidence monotonicity, etc.)

Unit tests for each layer live in `src/<layer>/__tests__/`.

## Running

```bash
# Unit tests (T1 — deterministic, CI)
npx vitest run

# Evaluation suite (T3 — requires LLM API keys)
npx vitest run --config vitest.eval.config.ts
```

## Related datasets

The scenario corpus draws on user stories originally collected alongside the [LLM-REI dataset](https://github.com/lm-rei/lm-rei) (Rodeghero et al.), a set of 30 interview transcripts exploring how LLMs conduct requirements elicitation. The dataset informed early scenario design but is not included in this repository.
