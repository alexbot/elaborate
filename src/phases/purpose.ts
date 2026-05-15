/**
 * Purpose clarification phase — PAM via laddering + slot-filling.
 *
 * Captures Purpose, Advantage, and Measurement through:
 * 1. Initial extraction from opening response
 * 2. Laddering (WHY-chain) if response is solution-framed
 * 3. Slot-filling for remaining gaps
 * 4. Confirmation with revision loop
 *
 * PAM is the capture schema (GQM-inspired). Laddering is the interview
 * technique — start concrete, abstract upward via "why?" until purpose surfaces.
 * Confidence is derived from artifact state, not tracked separately.
 */

import { z } from "zod";
import type { WorkflowContext } from "../durable/index.js";
import type { Artifacts } from "./schema.js";
import type { ArtifactAggregate } from "./aggregate/index.js";
import { buildFullContext, confirmationCloser, confirmPhase } from "./shared.js";
import { inferCompositionStep, isDeviationError } from "../interview/index.js";

type PamSlot = "purpose" | "advantage" | "measurement";

const SLOT_ORDER: PamSlot[] = ["purpose", "advantage", "measurement"];
const MAX_ATTEMPTS: Record<PamSlot, number> = { purpose: 3, advantage: 2, measurement: 2 };
const MAX_LADDER_DEPTH = 3;

const SLOT_DIRECTIONS: Record<PamSlot, { fresh: string; rephrase: string }> = {
  purpose: {
    fresh: "Ask what problem this project solves or what need it addresses.",
    rephrase: "The previous question about purpose didn't get a clear answer. Try a different angle — use a concrete example or offer choices.",
  },
  advantage: {
    fresh: "Ask what makes this approach better than alternatives or the status quo.",
    rephrase: "The previous question about advantage didn't get a clear answer. Try offering concrete alternatives to react to.",
  },
  measurement: {
    fresh: "Ask how the user would know if this project succeeded — what they would measure.",
    rephrase: "The previous question about measurement didn't get a clear answer. Offer concrete examples of metrics from similar projects.",
  },
};

const SLOT_FALLBACKS: Record<PamSlot, string> = {
  purpose: "What **problem** does this project solve?",
  advantage: "What makes this approach better than how people handle it today?",
  measurement: "How would you know if this project succeeded?",
};

const LADDER_DIRECTIONS: string[] = [
  "The stakeholder described a solution or feature. Ask WHY they need this — what underlying problem it solves.",
  "The stakeholder hasn't yet articulated the core problem. Ask WHY this matters — what underlying need drives it.",
  "Try a different angle. Ask what would be different for users if this problem were solved.",
];

const PamExtractionSchema = z.object({
  purpose: z.string().nullable().optional().describe("the core purpose/problem being solved, null if not addressed"),
  advantage: z.string().nullable().optional().describe("why this approach is better than alternatives, null if not addressed"),
  measurement: z.string().nullable().optional().describe("how success will be measured, null if not addressed"),
  responseInterpretation: z.string().describe("what the stakeholder meant, resolving any suggestion references (a, b, c) to their full text"),
  contradictions: z.array(z.string()).optional().describe("genuine logical contradictions with existing artifacts where both statements CANNOT be true simultaneously (e.g. 'app is free' vs 'revenue from subscriptions'). NOT: different priorities, complementary concerns, soft tensions, or different aspects of the same goal. Empty array if none"),
});

const FramingSchema = z.object({
  framing: z.enum(["solution", "problem", "mixed"]).describe("whether the response describes a solution/feature (solution), a problem/need (problem), or both (mixed)"),
  solutionDescription: z.string().nullable().describe("the solution or feature described, null if problem-framed"),
});

function ladderComposition(depth: number, solutionDescription: string, originalResponse: string, artifacts: Artifacts) {
  return inferCompositionStep({
    id: "",
    fallback: "What **underlying problem** does that solve?",
    message: `
      Compose a WHY question to abstract upward from a solution description toward the underlying purpose.
      ${LADDER_DIRECTIONS[Math.min(depth, LADDER_DIRECTIONS.length - 1)]}
      The solution described: "${solutionDescription}"
      The stakeholder's original words: "${originalResponse}"
      Include 2-3 suggested answers that show the expected level of specificity.

      Context:
      ${buildFullContext(artifacts)}
    `,
  });
}

const PurposeSeedSchema = z.object({
  purpose: z.string().nullable().optional().describe("purpose hint extracted from waiting room items, null if none"),
  advantage: z.string().nullable().optional().describe("advantage hint extracted from waiting room items, null if none"),
  measurement: z.string().nullable().optional().describe("measurement hint extracted from waiting room items, null if none"),
  drainedWaitingRoomIds: z.array(z.string()).optional()
    .describe('IDs of waiting room items consumed as purpose/advantage/measurement hints (e.g. ["waiting_001"]), empty if none'),
});

const LadderExtractionSchema = PamExtractionSchema.extend({
  waitingRoomItems: z.array(z.object({ content: z.string().describe("the item text") })).optional().describe("goals, stakeholder hints, or assumptions surfaced as byproducts — to be parked for later phases"),
});

function slotComposition(slot: PamSlot, attempt: number, artifacts: Artifacts) {
  const direction = attempt > 0 ? SLOT_DIRECTIONS[slot].rephrase : SLOT_DIRECTIONS[slot].fresh;
  return inferCompositionStep({
    id: "",
    fallback: SLOT_FALLBACKS[slot],
    message: `
      Compose a question for the stakeholder about: ${slot}.
      ${direction}
      Include 2-3 suggested answers that show the expected level of specificity.

      Context:
      ${buildFullContext(artifacts)}
    `,
  });
}

function confirmation(artifacts: Artifacts): { id: string; message: string } {
  const purposeFindings = artifacts.findings.filter((f) => f.phase === "purpose");
  const gaps = purposeFindings.length > 0
    ? `\n\n**Gaps noted**:\n${purposeFindings.map((f) => `- ${f.content}`).join("\n")}`
    : "";
  return {
    id: "purpose-confirmation",
    message: `
      Here's what I've captured so far:

      **Purpose**: ${artifacts.purpose ? artifacts.purpose.statement : "_(not yet defined)_"}
      **Advantage**: ${artifacts.advantage ? artifacts.advantage.statement : "_(not yet defined)_"}
      **Measurement**: ${artifacts.measurement ? artifacts.measurement.statement : "_(not yet defined)_"}${gaps}

      ${confirmationCloser()}
    `,
  };
}

export async function runPurpose(ctx: WorkflowContext, agg: ArtifactAggregate, opening?: string): Promise<void> {

  const artifacts = agg.data;

  // Step 0: Drain waiting room for purpose-related items (e.g. brownfield context)
  if (artifacts.waitingRoom.length > 0) {
    const preWaitingRoomIds = new Set(artifacts.waitingRoom.map((w) => w.id));

    const seeds = await ctx.seed({
      id: "purpose-seed-extraction",
      artifactsContext: buildFullContext(artifacts, { includeWaitingRoom: true }),
      schema: PurposeSeedSchema,
      guidance: "Extract purpose, advantage, or measurement hints from the waitingRoom items in the context. These are PAM (Purpose-Advantage-Measurement) slots. Return drainedWaitingRoomIds for the items you consumed.",
    });

    agg.applyPamExtraction(seeds, ctx.currentSource);

    const drainedIds = new Set(
      (seeds.drainedWaitingRoomIds ?? []).filter((id) => preWaitingRoomIds.has(id)),
    );
    agg.drainWaitingRoom(drainedIds);
  }

  // Step 1: Extract PAM slots from the opening response (if provided).
  // The opening may be a non-answer (e.g. the stakeholder asked a question back
  // during confirmation) — tolerate deviations and fall through to slot-filling.
  let openingUsable = false;
  if (opening) {
    try {
      const ext = await ctx.extract({
        id: "purpose-initial-extraction",
        response: opening, artifactsContext: buildFullContext(artifacts), schema: PamExtractionSchema,
      });
      agg.applyPamExtraction(ext, ctx.currentSource);
      openingUsable = true;

      if (ext.contradictions?.length) {
        const reExt = await ctx.promptReextract("purpose-initial-contradiction", ext.contradictions, buildFullContext(artifacts), PamExtractionSchema, { defaults: { purpose: null, advantage: null, measurement: null, responseInterpretation: "", contradictions: [] } });
        agg.applyPamExtraction(reExt, ctx.currentSource);
      }
    } catch (e) {
      if (!isDeviationError(e)) throw e;
    }
  }

  // Step 2: Laddering — if opening was solution-framed and purpose still missing,
  // ask WHY repeatedly to abstract upward toward the underlying need
  if (openingUsable && opening && !artifacts.purpose) {
    const { framing, solutionDescription } = await ctx.extract({
      id: "purpose-classify-framing",
      response: opening, artifactsContext: buildFullContext(artifacts), schema: FramingSchema,
    });

    if (framing !== "problem" && solutionDescription) {
      for (let depth = 0; depth < MAX_LADDER_DEPTH && !artifacts.purpose; depth++) {
        const ext = await ctx.composePromptExtract(
          `purpose-ladder-${depth}`,
          () => ladderComposition(depth, solutionDescription, opening, artifacts),
          { artifactsContext: buildFullContext(artifacts), schema: LadderExtractionSchema },
          { park: (items) => agg.addWaitingRoomItems(items), defaults: { purpose: null, advantage: null, measurement: null, responseInterpretation: "", contradictions: [], waitingRoomItems: [] } },
        );

        agg.applyPamExtraction(ext, ctx.currentSource);
        if (ext.waitingRoomItems?.length) {
          agg.addWaitingRoomItems(ext.waitingRoomItems);
        }

        if (ext.contradictions?.length) {
          const reExt = await ctx.promptReextract(`purpose-ladder-contradiction-${depth}`, ext.contradictions, buildFullContext(artifacts), LadderExtractionSchema, { defaults: { purpose: null, advantage: null, measurement: null, responseInterpretation: "", contradictions: [], waitingRoomItems: [] } });
          agg.applyPamExtraction(reExt, ctx.currentSource);
        }
      }
    }
  }

  // Step 3: Slot-filling — directly ask for any PAM slots still missing
  for (const slot of SLOT_ORDER) {
    if (artifacts[slot]) continue;

    let filled = false;
    const max = MAX_ATTEMPTS[slot];
    for (let attempt = 0; attempt < max && !filled; attempt++) {
      const ext = await ctx.composePromptExtract(
        `purpose-${slot}-${attempt}`,
        () => slotComposition(slot, attempt, artifacts),
        { artifactsContext: buildFullContext(artifacts), schema: PamExtractionSchema },
        { defaults: { purpose: null, advantage: null, measurement: null, responseInterpretation: "", contradictions: [] } },
      );

      if (ext.contradictions?.length) {
        agg.applyPamExtraction(ext, ctx.currentSource);
        const reExt = await ctx.promptReextract(`purpose-contradiction-${slot}-${attempt}`, ext.contradictions, buildFullContext(artifacts), PamExtractionSchema, { defaults: { purpose: null, advantage: null, measurement: null, responseInterpretation: "", contradictions: [] } });
        agg.applyPamExtraction(reExt, ctx.currentSource);
        filled = !!artifacts[slot];
        continue;
      }

      agg.applyPamExtraction(ext, ctx.currentSource);
      filled = !!artifacts[slot];
    }

    if (!artifacts[slot]) {
      agg.addFinding(`Stakeholder could not articulate ${slot} after ${max} attempts`, "purpose");
    }
  }

  // Step 4: Single-pass confirmation
  const { response, approved } = await confirmPhase(ctx, confirmation(artifacts), artifacts, "purpose", 0);

  if (!approved) {
    const ext = await ctx.extract({
      id: "purpose-revision",
      response,
      artifactsContext: buildFullContext(artifacts),
      schema: PamExtractionSchema,
    });
    agg.applyPamExtraction(ext, ctx.currentSource);
  }

  agg.confirmPam(0.9);
}
