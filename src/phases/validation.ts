/**
 * Validation + completion phases — present summary, check consistency/completeness, confirm.
 *
 * Phase 7 (runValidation): WR classify-and-route → consistency check → present → classify.
 *
 * Bounded mutations: findings from consistency check, residual items from WR classification.
 * User concern (if any) is set on aggregate and bridged to persistence by the adapter.
 * No revision loop.
 */

import { z } from "zod";
import type { WorkflowContext } from "../durable/index.js";
import type { Artifacts } from "./schema.js";
import type { ArtifactAggregate } from "./aggregate/index.js";
import { buildFullContext, confirmPhase, section } from "./shared.js";
import { inferStep } from "../interview/index.js";

const WrClassifySchema = z.object({
  routed: z.array(z.object({
    id: z.string().describe("waiting room item ID"),
    target: z.enum(["assumption", "finding", "residual"]).describe("where to route this item"),
    content: z.string().describe("the item content (may be rephrased for the target format)"),
    reason: z.string().describe("why this item belongs in the target category, or why it is residual"),
  })).describe("classification for each remaining waiting room item"),
});

function wrClassifyAndRoute(artifacts: Artifacts) {
  return inferStep({
    id: "validation-wr-classify",
    message: `
      Classify each remaining waiting room item into the most appropriate artifact category.
      For each item, choose one target:
      - "assumption": an implicit belief that must be true for the project to succeed (testable or invariant)
      - "finding": a gap, risk, or quality observation worth flagging
      - "residual": content already absorbed into existing artifacts, too vague to classify, or genuinely not actionable

      Waiting room items:
      ${artifacts.waitingRoom.map((w) => `- ${w.id}: "${w.content}"`).join("\n")}

      Current artifacts (for context — avoid duplicating what's already captured):
      ${buildFullContext(artifacts)}
    `,
    schema: WrClassifySchema,
  });
}

const ConsistencyCheckSchema = z.object({
  contradictions: z.array(z.object({
    description: z.string(),
  })).optional().describe("cross-artifact contradictions found, empty if none"),
});

function consistencyCheck(artifacts: Artifacts) {
  return inferStep({
    id: "validation-consistency-check",
    message: `
      Review all captured artifacts for cross-artifact contradictions.
      Look for issues that no single phase could detect:
      - Goal references a stakeholder that doesn't exist
      - Scope item contradicts a stated goal
      - Assumption references a goal that was removed
      - Constraint makes a goal infeasible but wasn't flagged
      - In-scope item has no supporting goal

      Only report genuine cross-artifact contradictions.
      Do NOT repeat issues already captured as findings.

      Current artifacts:
      ${buildFullContext(artifacts)}

      Existing findings (do not duplicate):
      ${artifacts.findings.length > 0 ? artifacts.findings.map((f) => `- [${f.phase}] ${f.content}`).join("\n") : "(none)"}
    `,
    schema: ConsistencyCheckSchema,
  });
}

function summary(agg: ArtifactAggregate): { id: string; message: string } {
  const a = agg.data;

  const message = [
    "Here's a complete summary of everything we've captured:",

    section("**Purpose**", [
      a.purpose ? `- ${a.purpose.statement}` : "",
      a.advantage ? `- Advantage: ${a.advantage.statement}` : "",
      a.measurement ? `- Measurement: ${a.measurement.statement}` : "",
    ]),

    section("**Goals**",
      a.goals.map((g) => `- ${g.title} _(${g.status})_${g.rationale ? ` — ${g.rationale}` : ""}`)
    ),

    section("**Stakeholders**",
      a.stakeholders.map((s) => `- ${s.name} _(${s.type}, ${s.status})_${s.isRespondent ? " (you)" : ""}${s.role ? ` — ${s.role}` : ""}`)
    ),

    section("**Scope**", [
      ...a.inScope.map(s => `- IN: ${s.description}`),
      ...a.outOfScope.map(s => `- OUT: ${s.description}${s.reason ? ` — ${s.reason}` : ""}`),
    ]),

    section("**Constraints**", a.constraints.map(c => `- ${c.description}`)),
    section("**Assumptions**", a.assumptions.map((a) => `- ${a.statement} _(${a.type}, ${a.status})_`)),
    section("**Findings**", a.findings.map(f => `- [${f.phase}] ${f.content}`)),
    section("**Residual**", a.residual.map(r => `- ${r.content} _(${r.reason})_`)),

    section("**Gaps**", [
      !a.purpose || a.purpose.confidence < 0.5 ? "- No purpose defined" : "",
      !a.goals.some((g) => g.status !== "fuzzy") ? "- No non-fuzzy goal" : "",
      !a.stakeholders.some((s) => s.type === "primary") ? "- No primary stakeholder" : "",
      a.inScope.length === 0 && a.outOfScope.length === 0 ? "- No scope boundary defined" : "",
    ]),

    section("**Notes**", [
      !a.advantage ? "- No advantage articulated" : "",
      !a.measurement ? "- No measurement defined" : "",
      a.assumptions.length === 0 ? "- No assumptions captured" : "",
      a.findings.length > 0 ? `- ${a.findings.length} unresolved finding(s)` : "",
    ]),

    'What would you change or add? If everything looks right, let me know and we\'ll wrap up.',
  ].filter(Boolean).join("\n\n");

  return { id: "validation-summary-present", message };
}

export async function runValidation(ctx: WorkflowContext, agg: ArtifactAggregate) {

  // Classify and route remaining waiting room items before consistency check
  if (agg.data.waitingRoom.length > 0) {
    const { routed = [] } = await ctx.infer(wrClassifyAndRoute(agg.data));

    for (const item of routed) {
      if (item.target === "assumption") {
        agg.addAssumptions([{ statement: item.content, type: "hypothesis" }], undefined, undefined);
      } else if (item.target === "finding") {
        agg.addFinding(item.content, "validation");
      } else {
        agg.addResidualItems([{ content: item.content, reason: item.reason }]);
      }
    }

    agg.drainAllWaitingRoom();
  }

  const { contradictions = [] } = await ctx.infer(consistencyCheck(agg.data));

  for (const { description } of contradictions) {
    agg.addFinding(description, "validation");
  }

  const { approved, revisionRequested } = await confirmPhase(ctx, summary(agg), agg.data, "validation", 0);

  if (!approved && revisionRequested) {
    agg.setUserConcern(revisionRequested);
  }
}
