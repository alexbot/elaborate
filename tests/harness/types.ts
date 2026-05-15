import type { AdapterOutput } from "./adapter.js";

export interface Message {
  role: "user" | "assistant";
  content: string;
}

/**
 * Pluggable resolution strategy for the scenario runner.
 *
 * Level 2 (adapter-level): mechanical routing — "agent" targets call a
 * generation LLM, "user" targets call a simulated stakeholder LLM.
 *
 * Level 3 (skill-level, future): an orchestrator LLM reads SKILL.md and
 * decides how to handle each adapter output autonomously.
 */
export interface SessionDriver {
  resolveInfer(output: AdapterOutput, history: Message[]): Promise<Record<string, unknown>>;
  resolvePrompt(output: AdapterOutput, history: Message[]): Promise<string>;
}

export type ResultStatus =
  | "completed"
  | "truncated"
  | "error"
  | "loop_detected"
  | "judge_error"
  | "budget_exceeded"
  | "deviation_exhausted";

export interface ModelLabels {
  generation?: string;
  stakeholder?: string;
  judge?: string;
}

export interface RunResult {
  scenarioId: string;
  status: ResultStatus;
  turnCount: number;
  questionCount: number;
  transcript: Message[];
  error?: string;
  durationMs: number;
  sessionDir: string;
  models?: ModelLabels;
}

export interface ValidatorResult {
  name: string;
  pass: boolean;
  details?: string;
}

export interface ProcessFinding {
  finding: string;
  severity: "major" | "minor";
  polarity: "positive" | "negative";
  consensus?: number;
}

export interface QualityDimension {
  justification: string;
  score: number;
}

export interface JudgeScore {
  constraintDiscovery: {
    discovered: number;
    total: number;
    perConstraint: Array<{ constraint: string; discovered: boolean; evidence?: string }>;
  };
  processCompliance: {
    justification: string;
    score: number;
    findings: ProcessFinding[];
  };
  quality: {
    relevance: QualityDimension;
    completeness: QualityDimension;
    efficiency: QualityDimension;
  };
}

export interface JudgeResult {
  scores: JudgeScore[];
  averaged: JudgeScore;
  highVariance: boolean;
  varianceDetails?: string;
}

export interface EvaluationResult {
  scenarioId: string;
  run: RunResult;
  validators: ValidatorResult[];
  judge?: JudgeResult;
  timestamp: string;
}
