/**
 * Opening phase — initial greeting, description extraction, and brownfield context ingestion.
 *
 * After collecting the user's idea and extracting initial signals, the opening
 * asks whether this is a brownfield project. If yes, the user indicates sources
 * (files, URLs, docs) and the agent extracts atomic information items, which are
 * deposited into the waiting room for later phases to consume.
 */

import { z } from "zod";
import type { WorkflowContext } from "../durable/index.js";
import type { ArtifactAggregate } from "./aggregate/index.js";
import { inferStep } from "../interview/index.js";
import { buildFullContext, confirmPhase } from "./shared.js";

function greeting(): { id: string; message: string } {
  return {
    id: "opening-greet",
    message: `Hey — I'm Elaborate! I'll help you shape your project idea through a quick conversation.\n\nWhat are you building, and what problem does it solve? If it builds on existing work, feel free to mention that too.`,
  };
}

const OpeningExtractionSchema = z.object({
  purpose: z.string().describe("the core purpose or problem being solved"),
  stakeholders: z.array(z.string()).describe("implied users or affected parties"),
  domainHints: z.array(z.string()).describe("domain or industry keywords"),
});

const BrownfieldScreenSchema = z.object({
  greenfieldConfidence: z.number().describe("1 (uncertain) to 10 (certain this is a brand-new project with no existing work)"),
});

const GREENFIELD_THRESHOLD = 7;

const BrownfieldClassificationSchema = z.object({
  isBrownfield: z.boolean().describe("true if the user indicated this is part of an existing project with existing artifacts to review"),
  sourceIndicators: z.array(z.string()).describe("file paths, URLs, or other source references the user mentioned, empty if greenfield"),
});

const BrownfieldExtractionSchema = z.object({
  items: z.array(z.string()).describe("atomic information items extracted from the sources, each a single fact about purpose, goals, stakeholders, scope, constraints, or assumptions"),
});

function brownfieldPrompt(): { id: string; message: string } {
  return {
    id: "opening-brownfield",
    message: `If there's existing work this builds on — code, docs, URLs — describe it here.\nOtherwise, **skip**.`,
  };
}

function summary(purpose?: string, stakeholders?: string[]): { id: string; message: string } {
  const parts: string[] = [];
  if (purpose) {
    parts.push(`So you want to ${purpose.toLowerCase()}.`);
  }
  if (stakeholders && stakeholders.length > 0) {
    parts.push(`It sounds like this is for ${stakeholders.join(", ")}.`);
  }
  parts.push("\nDoes that sound right so far?");
  return { id: "opening-summary", message: parts.join(" ") };
}

export async function runOpening(ctx: WorkflowContext, agg: ArtifactAggregate): Promise<string> {

  const { purpose, stakeholders, domainHints } = await ctx.promptExtract(
    greeting(),
    { artifactsContext: buildFullContext(agg.data), schema: OpeningExtractionSchema },
    { defaults: { purpose: "", stakeholders: [], domainHints: [] } },
  );

  const src = ctx.currentSource;
  if (purpose) {
    agg.setPurpose(purpose, 0.5, src);
  }
  if (stakeholders && stakeholders.length > 0) {
    agg.addIdentifiedStakeholders(
      stakeholders.map((name) => ({ name, type: "primary" as const })),
      src,
    );
  }
  if (domainHints && domainHints.length > 0) {
    agg.addDomainHints(domainHints);
  }

  // Brownfield screen: skip the brownfield question when clearly greenfield
  const { greenfieldConfidence } = await ctx.infer(inferStep({
    id: "opening-brownfield-screen",
    schema: BrownfieldScreenSchema,
    message: `Based on the user's description, how confident are you that this is a brand-new project with no existing work to build on?

"Existing work" means concrete artifacts that THIS project inherits as its starting point — things the new work will extend, replace, integrate with, or add on to (e.g. prior versions, legacy systems, existing tools, institutional infrastructure, prototypes, documents, databases).

Everything else is context about the problem space, NOT existing work — this includes competitors, similar products, industry references, domain expertise, prior research, regulations, inspiration sources, or experience with unrelated projects.

Score high (greenfield) unless the user explicitly describes artifacts this project builds on.

Context: ${buildFullContext(agg.data)}`,
  }));

  if (greenfieldConfidence < GREENFIELD_THRESHOLD) {
    const { isBrownfield, sourceIndicators } = await ctx.promptExtract(
      brownfieldPrompt(),
      { artifactsContext: buildFullContext(agg.data), schema: BrownfieldClassificationSchema, guidance: 'Classify the user\'s response to "Is this part of an existing project?"' },
      { defaults: { isBrownfield: false, sourceIndicators: [] } },
    );

    if (isBrownfield && sourceIndicators.length > 0) {
      const { items } = await ctx.seed({
        id: "opening-brownfield-extraction",
        artifactsContext: buildFullContext(agg.data),
        schema: BrownfieldExtractionSchema,
        guidance: `Read the indicated sources using your tools and extract atomic information items relevant to the idea.
Each item should be a single fact — one goal, one stakeholder, one constraint, one assumption, etc.
Focus on: purpose, goals, stakeholders, scope boundaries, constraints, assumptions.
Sources to read: ${JSON.stringify(sourceIndicators)}`,
      });

      if (items.length > 0) {
        agg.addWaitingRoomItems(items.map((content) => ({ content })));
      }
    }
  }

  const { response: opening } = await confirmPhase(ctx, summary(purpose, stakeholders), agg.data, "opening", 0, {
    defaults: { approved: true, revisionRequested: null },
  });

  return opening;
}
