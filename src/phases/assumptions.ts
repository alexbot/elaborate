/**
 * Assumption capture phase — KAOS domain properties + SAST validation.
 *
 * Captures assumptions through:
 * 1. Seed extraction + waiting room drain (mines existing artifacts)
 * 2. Present seed list for review
 * 3. Gap-fill if no assumptions survived seeding
 * 4. Per-assumption validation (validated/flagged/unsure→probe)
 * 5. Generate findings for flagged assumptions
 * 6. Confirmation with revision loop
 *
 * First consolidative phase — mines artifacts, not generative.
 * Binary status: unvalidated(0.5) / validated(0.9) / flagged(0.7).
 * Adaptive: phase length scales with seed volume.
 */

import { z } from "zod";
import type { WorkflowContext } from "../durable/index.js";
import type { Artifacts, Assumption, Finding } from "./schema.js";
import { AssumptionType } from "./schema.js";
import type { ArtifactAggregate } from "./aggregate/index.js";
import { buildFullContext, confirmationCloser, confirmPhase } from "./shared.js";
import { inferCompositionStep } from "../interview/index.js";

const AssumptionItemSchema = z.object({
  statement: z.string().describe("the assumption text"),
  type: AssumptionType.optional().describe("'hypothesis' (testable) or 'invariant' (taken as given)"),
  relatedGoals: z.array(z.string()).optional().describe("goal IDs this assumption supports"),
});

const AssumptionSeedSchema = z.object({
  assumptions: z.array(AssumptionItemSchema).optional().describe("implicit assumptions from the conversation, empty if none"),
  drainedWaitingRoomIds: z.array(z.string()).optional().describe('IDs of waiting room items used as assumption sources (e.g. ["waiting_001"]), empty if none'),
});

const AssumptionSeedResponseSchema = z.object({
  responseInterpretation: z.string().describe("what the respondent meant"),
  confirmedIds: z.array(z.string()).optional().describe("assumption IDs the user confirmed (or all if confirmed), empty if none"),
  removedIds: z.array(z.string()).optional().describe("assumption IDs to remove, empty if none"),
  newAssumptions: z.array(AssumptionItemSchema).optional().describe("new assumptions mentioned, empty if none"),
  waitingRoomItems: z.array(z.object({ content: z.string().describe("the item text") })).optional().describe("items that aren't assumptions, empty if none"),
});

const GapFillExtractionSchema = z.object({
  responseInterpretation: z.string().describe("what the respondent meant, resolving any suggestion references"),
  assumptions: z.array(AssumptionItemSchema).optional().describe("assumptions extracted from the response, empty if none"),
  waitingRoomItems: z.array(z.object({ content: z.string().describe("the item text") })).optional().describe("items that aren't assumptions, empty if none"),
});

const ValidateExtractionSchema = z.object({
  responseInterpretation: z.string().describe("what the respondent meant, resolving any suggestion references"),
  verdict: z.enum(["validated", "flagged", "unsure"]).optional().describe("whether the user confirmed, denied, or is uncertain about this assumption"),
  waitingRoomItems: z.array(z.object({ content: z.string().describe("the item text") })).optional().describe("items that aren't about this assumption, empty if none"),
});

const ProbeExtractionSchema = z.object({
  responseInterpretation: z.string().describe("what the respondent meant"),
  impact: z.string().optional().describe("summary of what would change if the assumption weren't true"),
  waitingRoomItems: z.array(z.object({ content: z.string().describe("the item text") })).optional().describe("unrelated items, empty if none"),
});

const AssumptionRevisionSchema = z.object({
  responseInterpretation: z.string().describe("what the respondent meant, resolving any suggestion references"),
  newAssumptions: z.array(AssumptionItemSchema).optional().describe("new assumptions to add, empty if none"),
  removedIds: z.array(z.string()).optional().describe("assumption IDs to remove, empty if none"),
  waitingRoomItems: z.array(z.object({ content: z.string().describe("the item text") })).optional().describe("items that aren't assumptions, empty if none"),
});

function seedPresent(assumptions: Assumption[]): { id: string; message: string } {
  if (assumptions.length === 0) {
    return {
      id: "assumption-seed-present",
      message: `
        I haven't identified any implicit assumptions from our conversation yet.
        Are there things you're taking for granted about this project — beliefs about your users, technical feasibility, or the environment that haven't been verified?`,
    };
  }
  const letters = "abcdefghijklmnopqrstuvwxyz";
  const aList = assumptions.map((a, i) => {
    const tag = a.type === "invariant" ? "invariant" : "hypothesis";
    return `${letters[i]}) ${a.statement} _(${tag})_`;
  }).join("\n");
  return {
    id: "assumption-seed-present",
    message: `Based on our conversation, I've identified these implicit assumptions:
    ${aList}
    
    Does this look right? You can confirm, add, remove, or rephrase.`,
  };
}

function gapFillComposition(artifacts: Artifacts) {
  return inferCompositionStep({
    id: "",
    fallback: "What needs to be true for your project goals to work? Think about users, technology, market, or resources you're counting on.",
    message: `
      No assumptions were identified from the conversation. Compose a question using the SAST technique.
      Ask: "What needs to be true for your project goals to work?"
      Frame it around the specific goals and scope already captured.
      Include 2-3 suggested assumptions relevant to the project domain.

      Context:
      ${buildFullContext(artifacts)}
    `,
  });
}

function validationComposition(assumption: Assumption, artifacts: Artifacts) {
  return inferCompositionStep({
    id: "",
    fallback: "How confident are you that this assumption holds?",
    message: `
      Compose a validation question for assumption: "${assumption.statement}" (${assumption.type}).
      Ask whether the respondent believes this is true, and how confident they are.
      Include 2-3 suggested answers: one confirming, one expressing uncertainty, one challenging.

      Context:
      ${buildFullContext(artifacts)}
    `,
  });
}

function probeComposition(assumption: Assumption, artifacts: Artifacts) {
  return inferCompositionStep({
    id: "",
    fallback: "What would change about your project if this assumption turned out to be wrong?",
    message: `
      The respondent is unsure about assumption: "${assumption.statement}".
      Compose a probe question: "What would change if this weren't true?"
      Frame it around the specific goals and scope this assumption relates to.
      Include 2-3 suggested impacts.

      Context:
      ${buildFullContext(artifacts)}
    `,
  });
}

function confirmation(assumptions: Assumption[], findings: Finding[]): { id: string; message: string } {
  const aList = assumptions.length === 0
    ? "No assumptions were identified for this project.\n"
    : assumptions.map((a) => {
      const tag = a.type === "invariant" ? "invariant" : "hypothesis";
      const goals = a.relatedGoals.length > 0 ? ` (supports: ${a.relatedGoals.join(", ")})` : "";
      const badge = a.status === "validated" ? "validated" : a.status === "flagged" ? "FLAGGED" : "unvalidated";
      return `- ${a.statement} _(${tag}, ${badge})_${goals}`;
    }).join("\n");
  const aFindings = findings.filter((f) => f.phase === "assumptions");
  const findingsSection = aFindings.length > 0
    ? `\n\n**Notes:**\n${aFindings.map((f) => `- ${f.content}`).join("\n")}`
    : "";
  return {
    id: "assumptions-confirmation",
    message: `
      Here's what I've captured for your project assumptions:
      ${aList}${findingsSection}
      ${confirmationCloser()}
    `,
  };
}

export async function runAssumptions(ctx: WorkflowContext, agg: ArtifactAggregate): Promise<void> {
  const artifacts = agg.data;

  // Track waiting room IDs before seeding so we only drain pre-existing items
  const preWaitingRoomIds = new Set(artifacts.waitingRoom.map((w) => w.id));

  // Step 1: Seed extraction + waiting room drain
  const seeds = await ctx.seed({
    id: "assumption-seed-extraction",
    artifactsContext: buildFullContext(artifacts, { includeWaitingRoom: true }),
    schema: AssumptionSeedSchema,
    guidance: `Identify implicit assumptions — things that must be true but haven't been verified.
Classify each as "hypothesis" (testable belief) or "invariant" (unverified external reality). Link to goal IDs. Pull hints from the waitingRoom items in the context; return drainedWaitingRoomIds for the items you consumed.`,
  });

  agg.addAssumptions(seeds.assumptions ?? [], undefined, undefined, ctx.currentSource);

  // Drain waiting room items the LLM reported as consumed (by ID)
  const drainedIds = new Set(
    (seeds.drainedWaitingRoomIds ?? []).filter((id) => preWaitingRoomIds.has(id)),
  );
  agg.drainWaitingRoom(drainedIds);

  // Step 2: Present seed list
  const assumptionRef = artifacts.assumptions.map((a) => `${a.id}: "${a.statement}"`).join(", ");
  const seedClass = await ctx.promptReview(seedPresent(artifacts.assumptions), "assumption-seed-classification", assumptionRef, buildFullContext(artifacts), AssumptionSeedResponseSchema, { defaults: { responseInterpretation: "", confirmedIds: [], removedIds: [], newAssumptions: [], waitingRoomItems: [] } });

  // Remove rejected assumptions
  const removedIds = new Set(seedClass.removedIds ?? []);
  if (removedIds.size > 0) {
    agg.removeAssumptions(removedIds);
  }

  // Add new assumptions from response
  agg.addAssumptions(seedClass.newAssumptions ?? [], undefined, undefined, ctx.currentSource);
  agg.addWaitingRoomItems(seedClass.waitingRoomItems ?? []);

  // Step 3: Gap-fill (only if no assumptions after seed, with deviation resilience)
  if (artifacts.assumptions.length === 0) {
    const gapFill = await ctx.composePromptExtract(
      "assumption-gap-fill",
      () => gapFillComposition(artifacts),
      { artifactsContext: buildFullContext(artifacts), schema: GapFillExtractionSchema },
      { park: (items) => agg.addWaitingRoomItems(items), maxRetries: 2, defaults: { responseInterpretation: "", assumptions: [], waitingRoomItems: [] } },
    );
    agg.addAssumptions(gapFill.assumptions ?? [], undefined, undefined, ctx.currentSource);
    agg.addWaitingRoomItems(gapFill.waitingRoomItems ?? []);
  }

  // Step 4: Per-assumption validation
  for (const assumption of artifacts.assumptions) {
    if (assumption.status !== "unvalidated") continue;

    const validateResult = await ctx.composePromptExtract(
      `assumption-validation-${assumption.id}`,
      () => validationComposition(assumption, artifacts),
      { artifactsContext: buildFullContext(artifacts), schema: ValidateExtractionSchema, focus: `"${assumption.statement}" (${assumption.type})` },
      { defaults: { responseInterpretation: "", verdict: "flagged", waitingRoomItems: [] } },
    );
    agg.addWaitingRoomItems(validateResult.waitingRoomItems ?? []);

    if (validateResult.verdict === "validated") {
      agg.setAssumptionStatus(assumption.id, "validated");
    } else if (validateResult.verdict === "flagged") {
      agg.setAssumptionStatus(assumption.id, "flagged");
    } else {
      // "unsure" — probe then flag
      const probeResult = await ctx.composePromptExtract(
        `assumption-probe-${assumption.id}`,
        () => probeComposition(assumption, artifacts),
        { artifactsContext: buildFullContext(artifacts), schema: ProbeExtractionSchema, focus: `"${assumption.statement}"` },
        { defaults: { responseInterpretation: "", impact: "", waitingRoomItems: [] } },
      );
      agg.addWaitingRoomItems(probeResult.waitingRoomItems ?? []);

      // Flag regardless of probe answer
      agg.setAssumptionStatus(assumption.id, "flagged");
    }
  }

  // Step 5: Generate findings for flagged assumptions
  for (const assumption of artifacts.assumptions) {
    if (assumption.status !== "flagged") continue;
    const goalRef = assumption.relatedGoals.length > 0
      ? ` — goals ${assumption.relatedGoals.join(", ")} carry unverified dependency risk`
      : "";
    agg.addFinding(`Assumption "${assumption.statement}" could not be validated${goalRef}`, "assumptions");
  }

  // Step 6: Single-pass confirmation
  const { response, approved } = await confirmPhase(ctx, confirmation(artifacts.assumptions, artifacts.findings), artifacts, "assumptions", 0);

  if (!approved) {
    const extraction = await ctx.extract({
      id: "assumptions-revision",
      response,
      artifactsContext: buildFullContext(artifacts),
      schema: AssumptionRevisionSchema,
    });

    agg.addAssumptions(extraction.newAssumptions ?? [], 0.9, "validated", ctx.currentSource);
    const revRemovedIds = new Set(extraction.removedIds ?? []);
    if (revRemovedIds.size > 0) {
      agg.removeAssumptions(revRemovedIds);
    }
    agg.addWaitingRoomItems(extraction.waitingRoomItems ?? []);
  }
}
