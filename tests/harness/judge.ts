/**
 * LLM-as-judge integration.
 *
 * Evaluates a completed Elaborate session against scenario ground truth.
 * Three dimensions: constraint discovery, process compliance, quality.
 * Self-consistency: 3× runs at temp 0.3, average scores, flag high variance.
 */

import { z } from "zod";
import type { Scenario } from "./schema.js";
import { normalizeConstraint } from "./schema.js";
import type { Artifacts } from "../../src/phases/schema.js";
import type { Message, JudgeScore, JudgeResult, ProcessFinding } from "./types.js";
import type { T3Driver } from "./driver.js";

const PerConstraintSchema = z.object({
  constraint: z.string(),
  discovered: z.boolean(),
  evidence: z.string().optional(),
});

const ProcessFindingSchema = z.object({
  finding: z.string(),
  severity: z.enum(["major", "minor"]),
  polarity: z.enum(["positive", "negative"]),
});

const QualityDimensionSchema = z.object({
  justification: z.string().describe("Explain your reasoning BEFORE assigning the score"),
  score: z.number().describe("0-100"),
});

const JudgeOutputSchema = z.object({
  constraintDiscovery: z.object({
    perConstraint: z.array(PerConstraintSchema),
  }),
  processCompliance: z.object({
    justification: z.string().describe("Explain your overall assessment BEFORE assigning the score"),
    score: z.number().describe("0-100"),
    findings: z.array(ProcessFindingSchema),
  }),
  quality: z.object({
    relevance: QualityDimensionSchema,
    completeness: QualityDimensionSchema,
    efficiency: QualityDimensionSchema,
  }),
});

const ConsolidatedFindingSchema = z.object({
  finding: z.string(),
  severity: z.enum(["major", "minor"]),
  polarity: z.enum(["positive", "negative"]),
  consensus: z.number().describe("How many of the judge runs produced this or a semantically equivalent finding (1-3)"),
});

const ConsolidationOutputSchema = z.object({
  findings: z.array(ConsolidatedFindingSchema),
});

type JudgeOutput = z.infer<typeof JudgeOutputSchema>;

const PROGRESS_PREFIX = /^\s*\[\d+\/\d+/;

function filterUserFacing(transcript: Message[]): Message[] {
  return transcript.filter(
    (m) => m.role === "user" || PROGRESS_PREFIX.test(m.content),
  );
}

function buildRubricPrompt(
  scenario: Scenario,
  transcript: Message[],
  artifacts: Artifacts,
  sessionMetrics: { questionCount: number; turnCount: number },
): string {
  const constraints = scenario.hidden_constraints
    .map(normalizeConstraint)
    .map((c, i) => `${i + 1}. [${c.category}] ${c.constraint}`)
    .join("\n");

  const successCriteria = scenario.success_criteria
    .map((c, i) => `${i + 1}. ${c}`)
    .join("\n");

  const clean = filterUserFacing(transcript);
  const transcriptText = clean
    .map((m) => `[${m.role}]: ${m.content}`)
    .join("\n\n");

  const artifactSummary = JSON.stringify(artifacts, null, 2);

  return `You are evaluating an AI interview session. The AI ("Elaborate") conducted a project elaboration interview with a simulated stakeholder about: "${scenario.problem_statement}"

## Session metadata
- Interviewer questions: ${sessionMetrics.questionCount}
- Total turns (including system messages): ${sessionMetrics.turnCount}

## Hidden constraints (ground truth — the stakeholder knew these)
${constraints}

## Success criteria
${successCriteria}

## Full transcript
${transcriptText}

## Final artifacts produced
${artifactSummary}

## Evaluation rubric

For each scored dimension: explain your reasoning first, then assign a score.

### 1. Constraint Discovery
For EACH hidden constraint above, determine:
- Was it discovered during the interview? (the constraint's substance appears in the artifacts or was discussed)
- Quote evidence from the transcript or artifacts if discovered.

### 2. Process Compliance (0-100)
Evaluate whether Elaborate followed Socratic interview methodology:
- Did Elaborate surface ambiguity rather than self-resolving? Self-resolution means Elaborate filled in artifact content without giving the stakeholder a chance to respond. Presenting suggested answers or pre-extracted artifact lists for the stakeholder to confirm, modify, or reject is standard analyst-proposed review (IEEE 830 walkthroughs) and is NOT self-resolution — the stakeholder retains genuine veto power.
- Did Elaborate ask one question at a time?
- Did Elaborate confirm artifacts with the stakeholder before finalizing?
- Did Elaborate maintain traceability (artifacts linked to conversation turns)?
- Did Elaborate follow the phase progression (opening → purpose → goals → stakeholders → scope → validation)?

Explain your overall assessment, then assign a score, then list findings.

**Calibration note**: The brownfield question in the opening phase ("If there's existing work this builds on...") is acceptable when the stakeholder's intro does not clearly indicate greenfield status. Only penalize if the intro contains unambiguous greenfield signals (e.g., "starting from scratch", "no existing code") and the question still fires. A stakeholder saying "skip" is not evidence of a methodology failure — it means the question was low-value but not harmful.

**Findings instructions**: Report only findings that materially affected session quality. Do not balance positive and negative findings — report what you observe, even if the list is asymmetric. A single wasted turn in an otherwise efficient session is not material. List up to 8 findings, prioritized by impact. Fewer is acceptable.

For each finding, classify:
- **severity**: "major" (affected session outcome or stakeholder experience) or "minor" (noticeable but did not undermine session value)
- **polarity**: "positive" or "negative"

**Score bands**:
- 90-100: Exemplary methodology — all criteria met, no major negative findings
- 70-89: Sound methodology with minor lapses — criteria mostly met, at most one major negative finding
- 50-69: Methodology gaps — multiple criteria partially met, or two or more major negative findings
- Below 50: Fundamental methodology failures — criteria systematically violated

### 3. Quality Dimensions (each 0-100)
For each dimension, explain your reasoning first, then assign a score.

- **Relevance**: Were Elaborate's questions on-topic and productive?
  - 90-100: Every question advanced understanding; no tangents or irrelevant lines of inquiry
  - 70-89: Most questions were productive; occasional tangent or marginally useful question
  - 50-69: Several questions were off-topic or unproductive; noticeable time spent on irrelevant areas
  - Below 50: Frequent irrelevant questions; session lacked focus

- **Completeness**: Did the final artifacts cover the important aspects of the project?
  - 90-100: Artifacts capture all major aspects; goals, stakeholders, scope, and assumptions are thorough
  - 70-89: Artifacts cover most important aspects; some gaps in depth or coverage
  - 50-69: Notable gaps — important aspects of the project are missing or superficially covered
  - Below 50: Artifacts are fragmentary; major aspects of the project are absent

- **Efficiency**: Did Elaborate avoid redundant questions and reach useful conclusions without excessive turns? Note: presenting suggested answers alongside questions is an accepted interview technique that reduces cognitive load — do not penalize it as redundancy.
  - 90-100: No redundancy; every turn contributed new information or confirmed artifacts concisely
  - 70-89: Minor redundancy — a few questions revisited covered ground or could have been consolidated
  - 50-69: Noticeable redundancy — multiple questions that added little new information, or excessive confirmation rounds
  - Below 50: Significant time wasted on redundant, circular, or unnecessary exchanges

## Evaluation notes
- When evaluating quality, assess the **substance captured in the final artifacts**, not the verbosity or phrasing of user responses. A stakeholder who selects from suggested options still produces valid artifacts if the content is accurate.
- The session pipeline extracts structured data from each user response. Raw responses like "a and b" are resolved to their full content (e.g., the actual option text) in the final artifacts. Evaluate the resolved content, not the shorthand.

Respond with a structured evaluation.`;
}

function toJudgeScore(output: JudgeOutput, totalConstraints: number): JudgeScore {
  const discovered = output.constraintDiscovery.perConstraint.filter((c) => c.discovered).length;
  return {
    constraintDiscovery: {
      discovered,
      total: totalConstraints,
      perConstraint: output.constraintDiscovery.perConstraint,
    },
    processCompliance: {
      justification: output.processCompliance.justification,
      score: output.processCompliance.score,
      findings: output.processCompliance.findings,
    },
    quality: output.quality,
  };
}

function averageScores(scores: JudgeScore[], consolidatedFindings?: ProcessFinding[]): JudgeScore {
  const n = scores.length;
  const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / n;

  const discoveredCounts = scores.map((s) => s.constraintDiscovery.discovered);
  const total = scores[0].constraintDiscovery.total;

  const perConstraint = scores[0].constraintDiscovery.perConstraint.map((c, i) => ({
    constraint: c.constraint,
    discovered: scores.filter((s) => s.constraintDiscovery.perConstraint[i]?.discovered).length > n / 2,
    evidence: c.evidence,
  }));

  return {
    constraintDiscovery: {
      discovered: Math.round(avg(discoveredCounts)),
      total,
      perConstraint,
    },
    processCompliance: {
      justification: scores[0].processCompliance.justification,
      score: Math.round(avg(scores.map((s) => s.processCompliance.score))),
      findings: consolidatedFindings ?? scores[0].processCompliance.findings,
    },
    quality: {
      relevance: {
        justification: scores[0].quality.relevance.justification,
        score: Math.round(avg(scores.map((s) => s.quality.relevance.score))),
      },
      completeness: {
        justification: scores[0].quality.completeness.justification,
        score: Math.round(avg(scores.map((s) => s.quality.completeness.score))),
      },
      efficiency: {
        justification: scores[0].quality.efficiency.justification,
        score: Math.round(avg(scores.map((s) => s.quality.efficiency.score))),
      },
    },
  };
}

function checkVariance(scores: JudgeScore[]): { high: boolean; details?: string } {
  const dimensions = [
    { name: "processCompliance", values: scores.map((s) => s.processCompliance.score) },
    { name: "relevance", values: scores.map((s) => s.quality.relevance.score) },
    { name: "completeness", values: scores.map((s) => s.quality.completeness.score) },
    { name: "efficiency", values: scores.map((s) => s.quality.efficiency.score) },
  ];

  const highVariance: string[] = [];
  for (const dim of dimensions) {
    const mean = dim.values.reduce((a, b) => a + b, 0) / dim.values.length;
    const variance = dim.values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / dim.values.length;
    const sigma = Math.sqrt(variance);
    if (sigma > 15) {
      highVariance.push(`${dim.name} (σ=${sigma.toFixed(1)})`);
    }
  }

  return {
    high: highVariance.length > 0,
    details: highVariance.length > 0
      ? `High variance on: ${highVariance.join(", ")}`
      : undefined,
  };
}

export interface JudgeConfig {
  driver: T3Driver;
  scenario: Scenario;
  transcript: Message[];
  artifacts: Artifacts;
  questionCount: number;
  turnCount: number;
  runs?: number;
}

async function consolidateFindings(
  driver: T3Driver,
  scores: JudgeScore[],
): Promise<ProcessFinding[]> {
  const allFindings = scores.flatMap((s, runIndex) =>
    s.processCompliance.findings.map((f) => ({
      run: runIndex + 1,
      finding: f.finding,
      severity: f.severity,
      polarity: f.polarity,
    })),
  );

  const prompt = `You are deduplicating process compliance findings from ${scores.length} independent judge runs evaluating the same session.

## All findings across runs
${JSON.stringify(allFindings, null, 2)}

## Instructions
Merge semantically equivalent findings into a single canonical finding. For each merged finding:
- Write a clear canonical version of the finding text
- Preserve the severity and polarity (if runs disagree on severity, use the more severe)
- Set consensus to how many runs produced this or a semantically equivalent finding (1-${scores.length})

Do not add new findings. Do not change the substance of what was observed.`;

  const result = await driver.structuredOutput(
    "You are a careful deduplication assistant. Merge equivalent items faithfully.",
    prompt,
    ConsolidationOutputSchema,
    { temperature: 0, timeoutMs: 120_000 },
  );

  return result.findings;
}

export async function evaluateSession(config: JudgeConfig): Promise<JudgeResult> {
  const { driver, scenario, transcript, artifacts, questionCount, turnCount, runs = 3 } = config;
  const totalConstraints = scenario.hidden_constraints.length;
  const rubric = buildRubricPrompt(scenario, transcript, artifacts, { questionCount, turnCount });

  const scores: JudgeScore[] = [];
  for (let i = 0; i < runs; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, 30_000));
    const output = await driver.structuredOutput(
      "You are a rigorous evaluation judge. Score honestly and provide evidence for your assessments.",
      rubric,
      JudgeOutputSchema,
      { temperature: 0.3, timeoutMs: 180_000 },
    );
    scores.push(toJudgeScore(output, totalConstraints));
  }

  const consolidated = await consolidateFindings(driver, scores);
  const averaged = averageScores(scores, consolidated);
  const variance = checkVariance(scores);

  return {
    scores,
    averaged,
    highVariance: variance.high,
    varianceDetails: variance.details,
  };
}
