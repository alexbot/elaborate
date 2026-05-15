---
title: Deviation resilience
status: accepted
---

## Context

Stakeholders respond unpredictably during interviews. They go off-topic, ask for clarification, push back on the process, express frustration, or try to change the subject. This is normal interview behavior — experienced interviewers expect it.

Without classification, every non-answer consumed a probe attempt because the system couldn't distinguish "tried to answer but extraction failed" from "talked about something else entirely." This penalized the stakeholder for normal conversational behavior.

The design question was how to handle these deviations without derailing the interview or fighting the user. Two sub-decisions arose:

1. **Error taxonomy**: coarse (2 buckets: clarification vs everything-else) or fine-grained (one class per observable behavior)?
2. **Exhaustion policy**: strict (terminate on repeated deviation) or permissive (continue with partial data)?

## Decision

### Interview behavior model

The guiding principle is **absorb, acknowledge, redirect** — what a skilled human interviewer does:

- Note off-topic content (it might matter later), give brief acknowledgment, steer back.
- After 1–2 redirects, don't fight. Either follow the tangent or move on with a gap noted.
- Clarification requests aren't deviation — rephrase and re-ask, no penalty.
- "Note and move on" is a legitimate technique. Not every question needs an answer.

### Response classification

Every extraction schema is augmented with a `responseClass` field (`z.enum(['answer', 'confusion', 'off_topic', 'pushback', 'topic_change', 'frustration'])`). Classification happens in the same LLM call as extraction — no extra round-trip.

Five deviation error classes, each named after the user's answer type (not the system's response):

| Error class | Behavior | Response |
|---|---|---|
| `Confusion` | User asked for clarification | Rephrase, re-ask |
| `OffTopic` | User introduced unrelated content | Park in waiting room, redirect |
| `Pushback` | User pushed back on the process | Acknowledge, redirect |
| `TopicChange` | User tried to steer to a different topic | Park content, redirect |
| `Frustration` | User expressed fatigue | Acknowledge, redirect |

The finer taxonomy (5 classes vs 2) was chosen because `deviationMessage(error)` generates different acknowledgment text per class. A confused user gets a rephrase; a frustrated user gets validation. This costs nothing — the LLM classifies in the same call — and improves rapport.

### Retry primitive

`ctx.retryOnDeviation(callback, options)` in `src/interview/deviation.ts` — a generic resilience wrapper. On deviation, it retries the callback with the error available for rephrase composition. Configurable `maxRetries` (default 2).

### Permissive exhaustion policy

When retries exhaust, the session continues with `defaults` — a caller-provided fallback value representing the least-harmful partial result. Only re-throw when defaults are impossible to identify (no known call site should lack defaults).

Rationale: Elaborate prioritizes session continuity over extraction precision. A session that completes with gaps is more valuable than one that terminates mid-interview. The user came for a conversation, not an error message.

### Schema augmentation pattern

`ctx.extract()` in `src/interview/extraction.ts` augments every Zod schema with `responseClass`, classifies the response, throws the appropriate deviation error if not `answer`, and strips `responseClass` from the return value. Callers that don't use retry never see it.

## Consequences

**Positive:**

- Normal conversational behavior (clarification, pushback) doesn't penalize the stakeholder
- Off-topic content is captured (waiting room), not discarded
- Sessions survive misclassification — worst case is a partial result, not a crash
- Acknowledgment text varies by deviation type, improving rapport
- No extra LLM round-trips for classification

**Negative:**

- Every extraction schema grows by one field (minor token cost)
- Permissive defaults can mask real extraction failures — a session might complete with empty artifacts if the user consistently deviates
- Five error classes is more than strictly necessary; the system could work with 2 (clarification vs other)
