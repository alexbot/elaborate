/**
 * Scope definition phase — boundary classification via contrast questioning.
 *
 * Captures scope through:
 * 1. Seed extraction + waiting room drain
 * 2. Constraint discovery
 * 3. Contrast questions for ambiguous items (in/out/deferred)
 * 4. Contradiction check (scope vs goals alignment)
 * 5. Quality check (nudge if empty)
 * 6. Confirmation with revision loop
 *
 * Novel schema — no RE framework defines scope items for structured dialog.
 * No status progression: boundary decisions are binary. Confidence without status.
 */

import { z } from "zod";
import type { WorkflowContext } from "../durable/index.js";
import { inferStep, inferCompositionStep } from "../interview/index.js";
import type { Artifacts, Finding } from "./schema.js";
import type { ArtifactAggregate } from "./aggregate/index.js";
import { buildFullContext, confirmationCloser, confirmPhase } from "./shared.js";
import { SCOPE_CONTRAST_CAP } from "./configuration.js";

const SeedExtractionSchema = z.object({
  inScope: z.array(z.object({
    description: z.string().describe("what is in scope"),
    relatedGoals: z.array(z.string()).optional().describe("goal IDs this supports"),
  })).optional().describe("items clearly in scope from the conversation, empty if none"),
  outOfScope: z.array(z.object({
    description: z.string().describe("what is excluded"),
    reason: z.string().optional().describe("why it's excluded"),
    relatedGoals: z.array(z.string()).optional().describe("goal IDs this relates to"),
  })).optional().describe("items clearly excluded, empty if none"),
  ambiguous: z.array(z.object({
    description: z.string().describe("the ambiguous item"),
    relatedGoals: z.array(z.string()).optional().describe("goal IDs this relates to"),
  })).optional().describe("items mentioned but unclear if in or out, empty if none"),
  drainedWaitingRoomIds: z.array(z.string()).optional()
    .describe('IDs of waiting room items classified into scope (e.g. ["waiting_001"]), empty if none'),
});

const ScopeSeedResponseSchema = z.object({
  responseInterpretation: z.string().describe("what the respondent meant"),
  confirmedInScope: z.array(z.string()).optional().describe("IDs the user confirmed as in-scope (or all if confirmed)"),
  confirmedOutOfScope: z.array(z.string()).optional().describe("IDs the user confirmed as out-of-scope"),
  removedIds: z.array(z.string()).optional().describe("IDs to remove entirely"),
  newItems: z.array(z.object({ description: z.string().describe("the scope item"), classification: z.string().optional().describe("'in', 'out', or 'ambiguous'") })).optional().describe("new items mentioned, empty if none"),
  waitingRoomItems: z.array(z.object({ content: z.string().describe("the item text") })).optional().describe("items that sound like assumptions rather than scope, empty if none"),
});

const ConstraintExtractionSchema = z.object({
  responseInterpretation: z.string().describe("what the respondent meant, resolving any suggestion references"),
  constraints: z.array(z.object({ description: z.string().describe("the constraint") })).optional().describe("constraints extracted from the response, empty if none"),
  waitingRoomItems: z.array(z.object({ content: z.string().describe("the item text") })).optional().describe("items that sound like assumptions rather than constraints, empty if none"),
});

const ContrastExtractionSchema = z.object({
  responseInterpretation: z.string().describe("what the respondent meant, resolving any suggestion references"),
  classification: z.enum(["in", "out", "deferred"]).optional().describe("where this item belongs"),
  reason: z.string().optional().describe("why it's excluded (only if classification is 'out'), empty otherwise"),
  relatedGoals: z.array(z.string()).optional().describe("goal IDs this item relates to, empty if none"),
  waitingRoomItems: z.array(z.object({ content: z.string().describe("the item text") })).optional().describe("items that sound like assumptions, empty if none"),
});

const AmbiguousSortSchema = z.object({
  rankedAmbiguousIds: z.array(z.string()).describe("ambiguous item indices (as strings) ordered from highest to lowest priority for contrast questions"),
  autoClassifications: z.array(z.object({
    index: z.string().describe("the ambiguous item index (as string)"),
    classification: z.enum(["in", "out"]).describe("best-guess classification"),
    relatedGoals: z.array(z.string()).optional().describe("goal IDs this item relates to"),
    reason: z.string().optional().describe("why classified out (only if 'out')"),
  })).describe("default in/out classification for items that won't get contrast questions"),
});

function ambiguousSort(ambiguousItems: Array<{ description: string; relatedGoals?: string[] }>, artifacts: Artifacts) {
  const itemRef = ambiguousItems.map((item, i) => {
    const goals = item.relatedGoals?.length ? ` (goals: ${item.relatedGoals.join(", ")})` : "";
    return `[${i}] "${item.description}"${goals}`;
  }).join("; ");
  const goalRef = artifacts.goals.map((g) => `[${g.id}] "${g.title}" — ${g.description}`).join("; ");
  const scopeRef = [
    ...artifacts.inScope.map((s) => `IN: "${s.description}"`),
    ...artifacts.outOfScope.map((s) => `OUT: "${s.description}"`),
  ].join("; ");

  return inferStep({
    id: "scope-ambiguous-sort",
    schema: AmbiguousSortSchema,
    message: `
      Rank these ambiguous scope items by priority for boundary clarification, and provide default in/out classifications for lower-priority items.

      Ambiguous items: ${itemRef}
      Goals: ${goalRef}
      Existing scope: ${scopeRef}

      Ranking criteria (in order):
      1. Connected to more goals: items touching multiple goals affect more downstream requirements.
      2. Higher ambiguity: items where the in/out decision is genuinely unclear rank above items that are almost certainly one way.

      Return ALL indices in rankedAmbiguousIds (highest priority first).
      For items beyond the top ${SCOPE_CONTRAST_CAP}, provide autoClassifications with your best-guess in/out.
    `,
  });
}

const ContradictionCheckSchema = z.object({
  contradictions: z.array(z.object({
    description: z.string().describe("what the contradiction is"),
    scopeItemId: z.string().describe("the scope item ID"),
    goalId: z.string().describe("the conflicting goal ID"),
  })).optional().describe("scope items that make a confirmed/elaborated goal infeasible — the goal CANNOT be achieved without this item. NOT: soft tensions where a goal is merely weakened, less efficient, or harder to achieve. Empty array if none"),
  orphans: z.array(z.object({
    scopeItemId: z.string().describe("the scope item ID"),
    description: z.string().describe("what the orphan item is"),
  })).optional().describe("in-scope items with no goal connection"),
});

const ScopeDedupSchema = z.object({
  duplicateGroups: z.array(z.object({
    keepId: z.string().describe("the scope item ID to keep"),
    removeIds: z.array(z.string()).describe("scope item IDs that are semantically duplicate of keepId"),
  })).describe("groups of semantically duplicate scope items — only flag items you are CERTAIN describe the same thing with different wording"),
});

const ScopeRevisionSchema = z.object({
  responseInterpretation: z.string().describe("what the respondent meant, resolving any suggestion references"),
  inScope: z.array(z.object({ description: z.string().describe("what is in scope"), relatedGoals: z.array(z.string()).optional().describe("goal IDs this supports") })).optional().describe("new or updated in-scope items, empty if none"),
  outOfScope: z.array(z.object({ description: z.string().describe("what is excluded"), reason: z.string().optional().describe("why it's excluded"), relatedGoals: z.array(z.string()).optional().describe("goal IDs this relates to") })).optional().describe("new or updated out-of-scope items, empty if none"),
  removedIds: z.array(z.string()).optional().describe("scope item IDs to remove, empty if none"),
  reclassifiedItems: z.array(z.object({
    id: z.string().describe("scope item ID to reclassify"),
    newClassification: z.enum(["in", "out"]).describe("new classification"),
  })).optional().describe("existing scope items to move between in-scope and out-of-scope, empty if none"),
  waitingRoomItems: z.array(z.object({ content: z.string().describe("the item text") })).optional().describe("items that sound like assumptions, empty if none"),
});

function seedPresent(artifacts: Artifacts, ambiguousDescriptions: string[]): { id: string; message: string } {
  const letters = "abcdefghijklmnopqrstuvwxyz";
  const inStart = 0;
  const outStart = artifacts.inScope.length;
  const ambStart = outStart + artifacts.outOfScope.length;
  const total = ambStart + ambiguousDescriptions.length;

  if (total === 0) {
    return {
      id: "scope-seed-present",
      message: `I haven't identified specific **scope boundaries** from our conversation yet.\n\nWhat are the main things your project will definitely include or exclude?`,
    };
  }

  const inSection = artifacts.inScope.length > 0
    ? `**In scope:**\n${artifacts.inScope.map((item, i) => `${letters[inStart + i]}) ${item.description}`).join("\n")}\n\n`
    : "";
  const outSection = artifacts.outOfScope.length > 0
    ? `**Out of scope:**\n${artifacts.outOfScope.map((item, i) => {
      const reason = item.reason ? ` — ${item.reason}` : "";
      return `${letters[outStart + i]}) ${item.description}${reason}`;
    }).join("\n")}\n\n`
    : "";
  const ambSection = ambiguousDescriptions.length > 0
    ? `**Unclear (we'll sort these out):**\n${ambiguousDescriptions.map((desc, i) => `${letters[ambStart + i]}) ${desc}`).join("\n")}\n\n`
    : "";

  return {
    id: "scope-seed-present",
    message: `
      Based on our conversation, here's what I see for your project scope:
      ${inSection}${outSection}${ambSection}
      Does this look right? You can confirm, add items, remove items, or reclassify.
    `,
  };
}

function constraintComposition(artifacts: Artifacts) {
  return inferCompositionStep({
    id: "",
    fallback: "Are there any constraints your project must work within? Think about technical limits, budget, timeline, or regulations.",
    message: `
      Compose a question about project constraints — non-negotiable realities the project must work within.
      Ask about technical, budget, timeline, regulatory, or organizational constraints.
      Include 2-3 suggested constraints relevant to the project domain.

      Context:
      ${buildFullContext(artifacts)}
    `,
  });
}

function contrastComposition(description: string, artifacts: Artifacts) {
  return inferCompositionStep({
    id: "",
    fallback: `Is "${description}" in scope or out of scope for this project?`,
    message: `
      Compose a contrast question about: "${description}"
      Ask whether this item is in scope or out of scope for the project.
      Frame it as a clear choice. Include 2-3 suggested answers that clarify the boundary.

      Context:
      ${buildFullContext(artifacts)}
    `,
  });
}

function nudge(): { id: string; message: string } {
  return {
    id: "scope-nudge",
    message: `
      We haven't defined any scope boundaries yet.
      Could you tell me at least one thing that's definitely part of this project, or one thing that's explicitly NOT part of it?`,
  };
}

function contradictionCheck(artifacts: Artifacts) {
  const goalRef = artifacts.goals.map((g) => `[${g.id}] "${g.title}" (${g.status})`).join("; ");
  const scopeRef = [
    ...artifacts.inScope.map((s) => `IN [${s.id}]: "${s.description}" (goals: ${s.relatedGoals.join(", ") || "none"})`),
    ...artifacts.outOfScope.map((s) => `OUT [${s.id}]: "${s.description}" (goals: ${s.relatedGoals.join(", ") || "none"})`),
    ...artifacts.constraints.map((c) => `CONSTRAINT [${c.id}]: "${c.description}"`),
  ].join("; ");

  return inferStep({
    id: "scope-contradiction-check",
    message: `
      Check for contradictions between scope decisions and goals.

      Goals: ${goalRef}
      Scope: ${scopeRef}

      Find:
      1. Out-of-scope items needed by a confirmed/elaborated goal → contradiction
      2. Constraints that make a goal infeasible → contradiction
      3. In-scope items with no connection to any goal → orphan (not contradiction, just a note)
    `,
    schema: ContradictionCheckSchema,
  });
}

function scopeDedup(artifacts: Artifacts, suffix?: string) {
  const allItems = [
    ...artifacts.inScope.map((s) => `IN [${s.id}]: "${s.description}"`),
    ...artifacts.outOfScope.map((s) => `OUT [${s.id}]: "${s.description}"`),
  ].join("; ");

  return inferStep({
    id: suffix ? `scope-dedup-${suffix}` : "scope-dedup",
    schema: ScopeDedupSchema,
    message: `
      Identify semantically duplicate scope items — items that describe the same concept with different wording.

      Scope items: ${allItems}

      Rules:
      1. Only group items you are CERTAIN are duplicates (same concept, different words). Related but distinct items are NOT duplicates.
      2. For each group, pick the clearest/most specific description as keepId.
      3. Items in different classifications (IN vs OUT) are never duplicates — they represent a conflict, not a duplicate.
      4. Return an empty array if there are no duplicates.
    `,
  });
}

function confirmation(artifacts: Artifacts, findings: Finding[]): { id: string; message: string } {
  const inSection = artifacts.inScope.length > 0
    ? `**In scope:**\n${artifacts.inScope.map((s) => {
      const goals = s.relatedGoals.length > 0 ? ` (supports: ${s.relatedGoals.join(", ")})` : "";
      return `- ${s.description}${goals}`;
    }).join("\n")}\n\n`
    : "";
  const outSection = artifacts.outOfScope.length > 0
    ? `**Out of scope:**\n${artifacts.outOfScope.map((s) => {
      const reason = s.reason ? ` — ${s.reason}` : "";
      return `- ${s.description}${reason}`;
    }).join("\n")}\n\n`
    : "";
  const constSection = artifacts.constraints.length > 0
    ? `**Constraints:**\n${artifacts.constraints.map((c) => `- ${c.description}`).join("\n")}\n\n`
    : "";
  const scopeFindings = findings.filter((f) => f.phase === "scope");
  const findingsSection = scopeFindings.length > 0
    ? `**Notes:**\n${scopeFindings.map((f) => `- ${f.content}`).join("\n")}\n\n`
    : "";

  return {
    id: "scope-confirmation",
    message: `
      Here's what I've captured for your project scope:
      ${inSection}${outSection}${constSection}${findingsSection}
      ${confirmationCloser()}`,
  };
}

export async function runScope(ctx: WorkflowContext, agg: ArtifactAggregate): Promise<void> {
  const artifacts = agg.data;

  // Track waiting room IDs before seeding so we only drain pre-existing items
  const preWaitingRoomIds = new Set(artifacts.waitingRoom.map((w) => w.id));

  // Step 1: Seed extraction + waiting room drain
  const seeds = await ctx.seed({
    id: "scope-seed-extraction",
    artifactsContext: buildFullContext(artifacts, { includeWaitingRoom: true }),
    schema: SeedExtractionSchema,
    guidance: "Extract scope candidates. Classify each as clearly in-scope, out-of-scope, or ambiguous. Link to goal IDs. Pull hints from the waitingRoom items in the context; return drainedWaitingRoomIds for the items you consumed.",
  });

  const ambiguousItems: Array<{ description: string; relatedGoals?: string[] }> = seeds.ambiguous ?? [];
  const src = ctx.currentSource;
  agg.addInScopeItems(seeds.inScope ?? [], undefined, src);
  agg.addOutOfScopeItems(seeds.outOfScope ?? [], undefined, src);

  // Drain waiting room items the LLM reported as consumed (by ID)
  const drainedIds = new Set(
    (seeds.drainedWaitingRoomIds ?? []).filter((id) => preWaitingRoomIds.has(id)),
  );
  agg.drainWaitingRoom(drainedIds);

  // Present seed list
  const ambiguousDescriptions = ambiguousItems.map((a) => a.description);
  // Classify seed response
  const allItems = [...artifacts.inScope, ...artifacts.outOfScope];
  const itemRef = allItems.map((s) => `${s.id}: "${s.description}"`).join(", ");
  const seedClass = await ctx.promptReview(seedPresent(artifacts, ambiguousDescriptions), "scope-seed-classification", itemRef, buildFullContext(artifacts), ScopeSeedResponseSchema, { defaults: { responseInterpretation: "", confirmedInScope: [], confirmedOutOfScope: [], removedIds: [], newItems: [], waitingRoomItems: [] } });

  // Remove rejected items
  const removedIds = new Set(seedClass.removedIds ?? []);
  if (removedIds.size > 0) {
    agg.removeScopeItems(removedIds);
  }

  // Add new items from response
  const reviewSrc = ctx.currentSource;
  for (const item of seedClass.newItems ?? []) {
    if (item.classification === "out") {
      agg.addOutOfScopeItems([item], undefined, reviewSrc);
    } else {
      agg.addInScopeItems([item], undefined, reviewSrc);
    }
  }
  agg.addWaitingRoomItems(seedClass.waitingRoomItems ?? []);

  // Step 2: Constraints (with deviation resilience)
  const constExtraction = await ctx.composePromptExtract(
    "scope-constraint",
    () => constraintComposition(artifacts),
    { artifactsContext: buildFullContext(artifacts), schema: ConstraintExtractionSchema, guidance: "Constraints are non-negotiable external realities (technical limits, budget, timeline, regulations)." },
    { park: (items) => agg.addWaitingRoomItems(items), maxRetries: 2, defaults: { responseInterpretation: "", constraints: [], waitingRoomItems: [] } },
  );
  agg.addConstraints(constExtraction.constraints ?? [], ctx.currentSource);
  agg.addWaitingRoomItems(constExtraction.waitingRoomItems ?? []);

  // Steps 3-4: Sort + cap ambiguous items, then contrast questions for top items
  let contrastItems: typeof ambiguousItems;

  if (ambiguousItems.length > SCOPE_CONTRAST_CAP) {
    const sortResult = await ctx.infer(ambiguousSort(ambiguousItems, artifacts));
    const validIndices = new Set(ambiguousItems.map((_, i) => String(i)));
    const ranked = sortResult.rankedAmbiguousIds.filter((id) => validIndices.has(id));
    const keepIndices = ranked.length >= SCOPE_CONTRAST_CAP
      ? ranked.slice(0, SCOPE_CONTRAST_CAP)
      : ambiguousItems.slice(0, SCOPE_CONTRAST_CAP).map((_, i) => String(i));
    const keepSet = new Set(keepIndices);

    contrastItems = keepIndices.map((idx) => ambiguousItems[Number(idx)]);

    // Auto-classify excess items
    const autoMap = new Map(sortResult.autoClassifications.map((ac) => [ac.index, ac]));
    for (let i = 0; i < ambiguousItems.length; i++) {
      if (keepSet.has(String(i))) continue;
      const auto = autoMap.get(String(i));
      const item = ambiguousItems[i];
      if (auto?.classification === "out") {
        agg.addOutOfScopeItems([{ description: item.description, reason: auto.reason, relatedGoals: auto.relatedGoals }], undefined, src);
      } else {
        agg.addInScopeItems([{ description: item.description, relatedGoals: auto?.relatedGoals ?? item.relatedGoals }], undefined, src);
      }
    }
  } else {
    contrastItems = ambiguousItems;
  }

  for (let i = 0; i < contrastItems.length; i++) {
    const item = contrastItems[i];
    const contrastResult = await ctx.composePromptExtract(
      `scope-contrast-${i}`,
      () => contrastComposition(item.description, artifacts),
      { artifactsContext: buildFullContext(artifacts), schema: ContrastExtractionSchema, focus: `"${item.description}"` },
      { defaults: { responseInterpretation: "", classification: "deferred", reason: "", relatedGoals: [], waitingRoomItems: [] } },
    );

    const contrastSrc = ctx.currentSource;
    const resolvedDescription = contrastResult.responseInterpretation || item.description;
    if (contrastResult.classification === "in") {
      agg.addInScopeItems([{
        description: resolvedDescription,
        relatedGoals: contrastResult.relatedGoals,
      }], undefined, contrastSrc);
    } else if (contrastResult.classification === "out") {
      agg.addOutOfScopeItems([{
        description: resolvedDescription,
        reason: contrastResult.reason,
        relatedGoals: contrastResult.relatedGoals,
      }], undefined, contrastSrc);
    } else {
      agg.addWaitingRoomItems([{ content: item.description }]);
    }
    agg.addWaitingRoomItems(contrastResult.waitingRoomItems ?? []);
  }

  // Step 5: Contradiction check
  if (artifacts.goals.length > 0 && (artifacts.inScope.length > 0 || artifacts.outOfScope.length > 0)) {
    const checkResult = await ctx.infer(contradictionCheck(artifacts));

    // Surface contradictions
    if (checkResult.contradictions && checkResult.contradictions.length > 0) {
      const contradictionDescs = checkResult.contradictions.map((c) => c.description);
      await ctx.promptReextract("scope-contradiction-clarification", contradictionDescs, buildFullContext(artifacts), z.object({}), { defaults: {} });
    }

    // Record orphans as findings
    if (checkResult.orphans && checkResult.orphans.length > 0) {
      for (const orphan of checkResult.orphans) {
        agg.addFinding(`In-scope item "${orphan.description}" has no connection to any stated goal`, "scope");
      }
    }
  }

  // Step 6: Quality check
  if (artifacts.inScope.length === 0 && artifacts.outOfScope.length === 0) {
    // One nudge
    const nudgeClass = await ctx.promptExtract(
      nudge(),
      { artifactsContext: buildFullContext(artifacts), schema: SeedExtractionSchema },
      { defaults: { inScope: [], outOfScope: [], ambiguous: [], drainedWaitingRoomIds: [] } },
    );

    const nudgeSrc = ctx.currentSource;
    agg.addInScopeItems(nudgeClass.inScope ?? [], undefined, nudgeSrc);
    agg.addOutOfScopeItems(nudgeClass.outOfScope ?? [], undefined, nudgeSrc);

    // If still empty after nudge, finding
    if (artifacts.inScope.length === 0 && artifacts.outOfScope.length === 0) {
      agg.addFinding("No scope boundaries defined — downstream requirements may lack focus", "scope");
    }
  }

  // Step 6b: Semantic deduplication
  if (artifacts.inScope.length + artifacts.outOfScope.length >= 2) {
    const dedupResult = await ctx.infer(scopeDedup(artifacts));
    for (const group of dedupResult.duplicateGroups) {
      const validRemoveIds = group.removeIds.filter((id) =>
        artifacts.inScope.some((s) => s.id === id) || artifacts.outOfScope.some((s) => s.id === id),
      );
      if (validRemoveIds.length > 0) {
        agg.removeScopeItems(new Set(validRemoveIds));
      }
    }
  }

  // Step 7: Single-pass confirmation
  const { response, approved } = await confirmPhase(ctx, confirmation(artifacts, artifacts.findings), artifacts, "scope", 0);

  if (!approved) {
    const extraction = await ctx.extract({
      id: "scope-revision",
      response,
      artifactsContext: buildFullContext(artifacts),
      schema: ScopeRevisionSchema,
    });

    // Reclassify items first (before adds, so exact-match guard doesn't block re-adds)
    for (const item of extraction.reclassifiedItems ?? []) {
      const existing = artifacts.inScope.find((s) => s.id === item.id)
        ?? artifacts.outOfScope.find((s) => s.id === item.id);
      if (!existing) continue;
      agg.removeScopeItems(new Set([item.id]));
      if (item.newClassification === "in") {
        agg.addInScopeItems([{ description: existing.description, relatedGoals: existing.relatedGoals }], undefined, existing.source);
      } else {
        agg.addOutOfScopeItems([{ description: existing.description, relatedGoals: existing.relatedGoals }], undefined, existing.source);
      }
    }

    const revSrc = ctx.currentSource;
    agg.addInScopeItems(extraction.inScope ?? [], undefined, revSrc);
    agg.addOutOfScopeItems(extraction.outOfScope ?? [], undefined, revSrc);
    const revRemovedIds = new Set(extraction.removedIds ?? []);
    if (revRemovedIds.size > 0) {
      agg.removeScopeItems(revRemovedIds);
    }
    agg.addWaitingRoomItems(extraction.waitingRoomItems ?? []);

    // Post-revision dedup: revision may add items that overlap existing ones
    if (artifacts.inScope.length + artifacts.outOfScope.length >= 2) {
      const dedupResult = await ctx.infer(scopeDedup(artifacts, "post-revision"));
      for (const group of dedupResult.duplicateGroups ?? []) {
        const validRemoveIds = group.removeIds.filter((id) =>
          artifacts.inScope.some((s) => s.id === id) || artifacts.outOfScope.some((s) => s.id === id),
        );
        if (validRemoveIds.length > 0) {
          agg.removeScopeItems(new Set(validRemoveIds));
        }
      }
    }
  }

  agg.confirmScope();
}
