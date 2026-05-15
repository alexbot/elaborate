/**
 * ArtifactAggregate — facade over per-domain free functions.
 *
 * Phases own workflow orchestration (loops, async, LLM calls).
 * The aggregate owns domain operations (ID generation, defaults,
 * status+confidence pairing, deduplication), delegated to domain modules.
 *
 * Read access: use `.data` to get the plain Artifacts object.
 * Write access: use typed methods only.
 */

import type {
  Artifacts, Goal, Stakeholder, Assumption, Finding,
  GoalStatus, StakeholderType, StakeholderStatus, AssumptionType, AssumptionStatus, Source,
} from "../schema.js";
import { createEmptyArtifacts } from "../schema.js";
import * as pam from "./pam.js";
import * as goals from "./goals.js";
import * as stakeholders from "./stakeholders.js";
import * as scope from "./scope.js";
import * as assumptions from "./assumptions.js";
import * as waitingRoom from "./waitingRoom.js";
import * as findings from "./findings.js";

/** Lightweight artifact summary for re-orientation on resume. */
export interface ContextSummary {
  purpose?: string;
  advantage?: string;
  measurement?: string;
  goals: Array<{ id: string; title: string; status: string }>;
  stakeholders: Array<{ id: string; name: string; type: string }>;
  inScope: string[];
  outOfScope: string[];
  constraints: string[];
  assumptionCount: number;
  findingCount: number;
}

export class ArtifactAggregate {
  public readonly data: Artifacts;

  constructor() {
    this.data = createEmptyArtifacts();
  }

  // PAM singletons

  setPurpose(statement: string, confidence: number, source?: Source): void {
    pam.setPurpose(this.data, statement, confidence, source);
  }

  setAdvantage(statement: string, confidence: number, source?: Source): void {
    pam.setAdvantage(this.data, statement, confidence, source);
  }

  setMeasurement(statement: string, confidence: number, source?: Source): void {
    pam.setMeasurement(this.data, statement, confidence, source);
  }

  confirmPam(confidence = 0.9): void {
    pam.confirmPam(this.data, confidence);
  }

  applyPamExtraction(ext: { purpose?: string | null; advantage?: string | null; measurement?: string | null }, source?: Source): void {
    pam.applyPamExtraction(this.data, ext, source);
  }

  // Goals

  addFuzzyGoals(raws: Array<{ title: string; description: string; rationale?: string }>, source?: Source): string[] {
    return goals.addFuzzyGoals(this.data, raws, source);
  }

  updateGoal(goalId: string, fields: { title?: string | null; description?: string | null; rationale?: string | null }): boolean {
    return goals.updateGoal(this.data, goalId, fields);
  }

  setGoalStatus(goalId: string, status: GoalStatus): void {
    goals.setGoalStatus(this.data, goalId, status);
  }

  removeGoals(ids: Set<string>): void {
    goals.removeGoals(this.data, ids);
  }

  confirmElaboratedGoals(): void {
    goals.confirmElaboratedGoals(this.data);
  }

  applyGoalExtraction(goalId: string, ext: {
    title?: string | null;
    description?: string | null;
    rationale?: string | null;
    waitingRoomItems?: Array<{ content: string }>;
  }): boolean {
    return goals.applyGoalExtraction(this.data, goalId, ext);
  }

  goal(id: string): Goal | undefined {
    return goals.findGoal(this.data, id);
  }

  // Stakeholders

  addIdentifiedStakeholders(raws: Array<{ name: string; type: StakeholderType }>, source?: Source): void {
    stakeholders.addIdentifiedStakeholders(this.data, raws, source);
  }

  updateStakeholder(id: string, fields: { role?: string | null; type?: StakeholderType | null }): boolean {
    return stakeholders.updateStakeholder(this.data, id, fields);
  }

  addConcerns(id: string, concerns: string[]): number {
    return stakeholders.addConcerns(this.data, id, concerns);
  }

  setRespondent(id: string): void {
    stakeholders.setRespondent(this.data, id);
  }

  setStakeholderStatus(id: string, status: StakeholderStatus): void {
    stakeholders.setStakeholderStatus(this.data, id, status);
  }

  removeStakeholders(ids: Set<string>): void {
    stakeholders.removeStakeholders(this.data, ids);
  }

  confirmElaboratedStakeholders(): void {
    stakeholders.confirmElaboratedStakeholders(this.data);
  }

  applyStakeholderElaboration(id: string, ext: {
    role?: string | null;
    concerns?: string[];
    waitingRoomItems?: Array<{ content: string }>;
  }): boolean {
    return stakeholders.applyStakeholderElaboration(this.data, id, ext);
  }

  stakeholder(id: string): Stakeholder | undefined {
    return stakeholders.findStakeholder(this.data, id);
  }

  // Scope

  addInScopeItems(items: Array<{ description: string; relatedGoals?: string[] }>, confidence?: number, source?: Source): void {
    scope.addInScopeItems(this.data, items, confidence, source);
  }

  addOutOfScopeItems(items: Array<{ description: string; reason?: string; relatedGoals?: string[] }>, confidence?: number, source?: Source): void {
    scope.addOutOfScopeItems(this.data, items, confidence, source);
  }

  addConstraints(items: Array<{ description: string }>, source?: Source): void {
    scope.addConstraints(this.data, items, source);
  }

  removeScopeItems(ids: Set<string>): void {
    scope.removeScopeItems(this.data, ids);
  }

  confirmScope(): void {
    scope.confirmScope(this.data);
  }

  // Assumptions

  addAssumptions(
    items: Array<{ statement: string; type?: AssumptionType; relatedGoals?: string[] }>,
    confidence?: number,
    status?: AssumptionStatus,
    source?: Source,
  ): void {
    assumptions.addAssumptions(this.data, items, confidence, status, source);
  }

  setAssumptionStatus(id: string, status: AssumptionStatus): void {
    assumptions.setAssumptionStatus(this.data, id, status);
  }

  removeAssumptions(ids: Set<string>): void {
    assumptions.removeAssumptions(this.data, ids);
  }

  assumption(id: string): Assumption | undefined {
    return assumptions.findAssumption(this.data, id);
  }

  // Domain Hints / Findings

  addDomainHints(hints: string[]): void {
    findings.addDomainHints(this.data, hints);
  }

  addFinding(content: string, phase: string): void {
    findings.addFinding(this.data, content, phase);
  }

  findingsByPhase(phase: string): Finding[] {
    return findings.findingsByPhase(this.data, phase);
  }

  // Waiting Room

  addWaitingRoomItems(items: Array<{ content: string }>): void {
    waitingRoom.addWaitingRoomItems(this.data, items);
  }

  drainWaitingRoom(ids: Set<string>): void {
    waitingRoom.drainWaitingRoom(this.data, ids);
  }

  addResidualItems(items: Array<{ content: string; reason: string }>): void {
    waitingRoom.addResidualItems(this.data, items);
  }

  drainAllWaitingRoom(): void {
    waitingRoom.drainAllWaitingRoom(this.data);
  }

  // Summary

  /** Lightweight projection for re-orientation on resume. */
  summarize(): ContextSummary {
    return {
      ...(this.data.purpose && { purpose: this.data.purpose.statement }),
      ...(this.data.advantage && { advantage: this.data.advantage.statement }),
      ...(this.data.measurement && { measurement: this.data.measurement.statement }),
      goals: this.data.goals.map((g) => ({ id: g.id, title: g.title, status: g.status })),
      stakeholders: this.data.stakeholders.map((s) => ({ id: s.id, name: s.name, type: s.type })),
      inScope: this.data.inScope.map((s) => s.description),
      outOfScope: this.data.outOfScope.map((s) => s.description),
      constraints: this.data.constraints.map((c) => c.description),
      assumptionCount: this.data.assumptions.length,
      findingCount: this.data.findings.length,
    };
  }

  // Session

  /** User's concern from validation — absent means endorsed. */
  userConcern?: string;

  setUserConcern(concern: string): void {
    this.userConcern = concern;
  }
}
