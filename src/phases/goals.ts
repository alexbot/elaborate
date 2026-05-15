/**
 * Goal discovery phase — KAOS-inspired WHY/HOW probing.
 *
 * Captures goals through:
 * 1. Seed extraction from prior artifacts + waiting room drain + list review (upfront)
 * 2. Per-goal refinement (clarify → why → negative probing stages)
 * 3. Confirmation with revision loop
 *
 * Goals follow KAOS goal model (MVP subset). Progressive status:
 * fuzzy(0.5) → elaborated(0.7) → confirmed(0.9).
 */

import { z } from "zod";
import type { WorkflowContext } from "../durable/index.js";
import type { Artifacts, Goal, Finding, Source } from "./schema.js";
import type { ArtifactAggregate } from "./aggregate/index.js";
import { buildFullContext, confirmationCloser, confirmPhase } from "./shared.js";
import { inferCompositionStep, inferStep } from "../interview/index.js";
import { ENABLE_GOAL_NEGATIVE_STAGE, GOAL_DETAIL_CAP } from "./configuration.js";

type ProbingStage = "clarify" | "why" | "negative";

/** Max probe attempts per stage before giving up. Keep low to avoid interrogation spirals. */
const MAX_PROBE_ATTEMPTS = 2;

const GoalSeedSchema = z.object({
  goals: z.array(z.object({
    title: z.string().describe("short goal name"),
    description: z.string().describe("what the goal means"),
    rationale: z.string().optional().describe("why this goal matters"),
  })).optional().describe(`candidate goals extracted from the conversation so far, 1-${GOAL_DETAIL_CAP} goals`),
  drainedWaitingRoomIds: z.array(z.string()).optional()
    .describe('IDs of waiting room items used as goal sources (e.g. ["waiting_001"]), empty if none'),
});

const GoalSeedResponseSchema = z.object({
  responseInterpretation: z.string().describe("what the stakeholder meant, resolving any suggestion references"),
  confirmedGoalIds: z.array(z.string()).optional().describe("IDs the user confirmed (or all IDs if they confirmed)"),
  removedGoalIds: z.array(z.string()).optional().describe("IDs the user wants removed"),
  newGoals: z.array(z.object({ title: z.string().describe("short goal name"), description: z.string().describe("what the goal means") })).optional().describe("new goals the user mentioned, empty if none"),
  waitingRoomItems: z.array(z.object({ content: z.string().describe("the item text") })).optional().describe("items that sound like scope or assumptions rather than goals, empty if none"),
});

const GoalExtractionSchema = z.object({
  responseInterpretation: z.string().describe("what the stakeholder meant, resolving any suggestion references (a, b, c) to their full text"),
  title: z.string().nullable().optional().describe("updated goal title if the response clarified it, null to keep current"),
  description: z.string().nullable().optional().describe("updated description if the response expanded it, null to keep current"),
  rationale: z.string().nullable().optional().describe("why this goal matters, extracted from the response, null if not addressed"),
  contradictions: z.array(z.string()).optional().describe("genuine logical contradictions with existing goals or purpose/advantage where both statements CANNOT be true simultaneously (e.g. 'goal requires real-time' vs 'constraint is batch-only'). NOT: different priorities between stakeholders, complementary concerns, soft tensions, or different aspects of the same goal. Empty array if none"),
  waitingRoomItems: z.array(z.object({ content: z.string().describe("the item text") })).optional().describe("items that sound like scope or assumptions rather than goals, empty if none"),
});

const InitialGoalExtractionSchema = z.object({
  responseInterpretation: z.string().describe("what the stakeholder meant, resolving any suggestion references"),
  goals: z.array(z.object({ title: z.string().describe("short goal name"), description: z.string().describe("what the goal means") })).optional().describe("goals mentioned by the stakeholder, empty if none"),
  waitingRoomItems: z.array(z.object({ content: z.string().describe("the item text") })).optional().describe("items that sound like scope or assumptions rather than goals, empty if none"),
});

const GoalSortSchema = z.object({
  rankedGoalIds: z.array(z.string()).describe("goal IDs ordered from highest to lowest priority for probing"),
});

function goalSort(artifacts: Artifacts, confirmedGoalIds: string[]) {
  const goalRef = artifacts.goals.map((g) => `[${g.id}] "${g.title}" — ${g.description}`).join("; ");
  const pamRef = [
    artifacts.purpose ? `Purpose: ${artifacts.purpose}` : null,
    artifacts.advantage ? `Advantage: ${artifacts.advantage}` : null,
    artifacts.measurement ? `Measurement: ${artifacts.measurement}` : null,
  ].filter(Boolean).join("; ");
  const confirmedRef = confirmedGoalIds.length > 0
    ? `Confirmed from suggestions (not user-originated): ${confirmedGoalIds.join(", ")}`
    : "All goals are user-originated.";

  return inferStep({
    id: "goal-sort",
    schema: GoalSortSchema,
    message: `
      Rank these goals by priority for detailed probing.

      Goals: ${goalRef}
      PAM: ${pamRef}
      ${confirmedRef}

      Criteria (in order):
      1. Genuine uniqueness: goals that don't substantially overlap with purpose/advantage/measurement rank highest.
      2. User-originated: goals the user stated rank above goals they merely confirmed from suggestions.
      3. Listing order as tertiary tiebreaker.

      Return ALL goal IDs, ordered from highest to lowest priority.
    `,
  });
}

function parkExcessGoals(
  agg: ArtifactAggregate,
  goalStates: Record<string, { attempts: number; probingStage: ProbingStage }>,
  keepIds: Set<string>,
): void {
  const parked = agg.data.goals.filter((g) => !keepIds.has(g.id));
  for (const goal of parked) {
    agg.addWaitingRoomItems([{ content: `Goal: ${goal.title} — ${goal.description}` }]);
    delete goalStates[goal.id];
  }
  agg.removeGoals(new Set(parked.map((g) => g.id)));
}

function seedPresent(goals: Goal[]): { id: string; message: string } {
  const letters = "abcdefghijklmnopqrstuvwxyz";
  const goalList = goals.map((g, i) => `${letters[i]}) **${g.title}** — ${g.description}`).join("\n");
  return {
    id: "goal-seed-present",
    message: `
      Based on what you've told me, I see these potential goals:
      ${goalList}
      
      Did I capture the right goals? You can confirm, add new ones, or tell me which to remove.
    `,
  };
}

function initialComposition(artifacts: Artifacts) {
  return inferCompositionStep({
    id: "",
    fallback: "What are the main **goals** for your project?",
    message: `
      Compose a question asking the stakeholder about their project goals — the outcomes they want to achieve.
      Suggest 2-3 concrete goals relevant to their stated purpose.

      Context:
      ${buildFullContext(artifacts)}
    `,
  });
}

function refinementComposition(goalTitle: string, stage: ProbingStage, attempt: number, artifacts: Artifacts) {
  const rephrase = attempt > 0;
  let direction: string;
  let fallback: string;
  switch (stage) {
    case "clarify":
      direction = rephrase
        ? `The previous question about "${goalTitle}" didn't get a clear answer. Offer concrete examples or choices to help them articulate it.`
        : `Ask what "${goalTitle}" means concretely — what achieving it would look like in practice.`;
      fallback = `What would achieving "${goalTitle}" look like in practice?`;
      break;
    case "why":
      direction = rephrase
        ? `Rephrase the "why" question for "${goalTitle}". Try grounding it in a specific scenario or user experience.`
        : `Ask why "${goalTitle}" is important — what value achieving it creates.`;
      fallback = `What **value** does achieving "${goalTitle}" create?`;
      break;
    case "negative":
      direction = rephrase
        ? `Rephrase the negative question for "${goalTitle}". Try a concrete scenario — e.g., imagine launching without it, what workaround people would use.`
        : `Ask what would happen if "${goalTitle}" didn't exist or wasn't achieved.`;
      fallback = `What would happen if "${goalTitle}" wasn't achieved?`;
      break;
  }
  return inferCompositionStep({
    id: "",
    fallback,
    message: `
      Compose a question for the stakeholder about goal: "${goalTitle}".
      ${direction}
      Include 2-3 suggested answers that show the expected level of specificity.

      Context:
      ${buildFullContext(artifacts)}
    `,
  });
}

function confirmation(goals: Goal[], findings: Finding[]): { id: string; message: string } {
  const goalList = goals.map((g) => {
    const rationale = g.rationale ? `\n  _Why it matters:_ ${g.rationale}` : "";
    return `**${g.title}** [${g.status}]\n  ${g.description}${rationale}`;
  }).join("\n\n");
  const goalsFindings = findings.filter((f) => f.phase === "goals");
  const findingsSection = goalsFindings.length > 0
    ? `\n**Gaps noted**:\n${goalsFindings.map((f) => `- ${f.content}`).join("\n")}\n`
    : "";
  return {
    id: "goals-confirmation",
    message: `
      Here's what I've captured for your project goals:
      
      ${goalList}
      ${findingsSection}
      ${confirmationCloser()}
    `,
  };
}

function addFuzzyGoals(
  agg: ArtifactAggregate,
  goalStates: Record<string, { attempts: number; probingStage: ProbingStage }>,
  raws: Array<{ title: string; description: string; rationale?: string }>,
  source?: Source,
): void {
  const ids = agg.addFuzzyGoals(raws, source);
  for (const id of ids) goalStates[id] = { attempts: 0, probingStage: "clarify" };
}

export async function runGoals(ctx: WorkflowContext, agg: ArtifactAggregate): Promise<void> {
  const artifacts = agg.data;
  const goalStates: Record<string, { attempts: number; probingStage: ProbingStage }> = {};

  // Track waiting room IDs before seeding so we only drain pre-existing items
  const preWaitingRoomIds = new Set(artifacts.waitingRoom.map((w) => w.id));

  // Step 1: Seed extraction + waiting room drain + list review (upfront)
  const seeds = await ctx.seed({
    id: "goal-seed-extraction",
    artifactsContext: buildFullContext(artifacts, { includeWaitingRoom: true }),
    schema: GoalSeedSchema,
    guidance: `Extract candidate project goals. Each goal: clear title (verb + outcome), description, optional rationale. 1-${GOAL_DETAIL_CAP} goals. Prefer goals that capture outcomes beyond what's already stated in purpose, advantage, and measurement. Pull hints from the waitingRoom items in the context; return drainedWaitingRoomIds for the items you consumed.`,
  });
  const goals = seeds.goals ?? [];

  // Drain waiting room items the LLM reported as consumed (by ID)
  const drainedIds = new Set(
    (seeds.drainedWaitingRoomIds ?? []).filter((id) => preWaitingRoomIds.has(id)),
  );
  agg.drainWaitingRoom(drainedIds);

  if (goals.length > 0) {
    addFuzzyGoals(agg, goalStates, goals, ctx.currentSource);

    const goalRef = artifacts.goals.map((g) => `${g.id}: "${g.title}"`).join(", ");
    const seedClass = await ctx.promptReview(seedPresent(artifacts.goals), "goal-seed-classification", goalRef, buildFullContext(artifacts), GoalSeedResponseSchema, { defaults: { responseInterpretation: "", confirmedGoalIds: [], removedGoalIds: [], newGoals: [], waitingRoomItems: [] } });

    const removedIds = new Set(seedClass.removedGoalIds ?? []);
    if (removedIds.size > 0) {
      agg.removeGoals(removedIds);
      for (const id of removedIds) delete goalStates[id];
    }

    addFuzzyGoals(agg, goalStates, seedClass.newGoals ?? [], ctx.currentSource);
    agg.addWaitingRoomItems(seedClass.waitingRoomItems ?? []);

    // Sort + cap: only probe top N goals, park the rest
    if (artifacts.goals.length > GOAL_DETAIL_CAP) {
      const effectiveConfirmed = (seedClass.confirmedGoalIds ?? []).filter((id) => !removedIds.has(id));
      const sortResult = await ctx.infer(goalSort(artifacts, effectiveConfirmed));
      const validIds = new Set(artifacts.goals.map((g) => g.id));
      const ranked = sortResult.rankedGoalIds.filter((id) => validIds.has(id));
      const keepIds = ranked.length >= GOAL_DETAIL_CAP
        ? new Set(ranked.slice(0, GOAL_DETAIL_CAP))
        : new Set(artifacts.goals.slice(0, GOAL_DETAIL_CAP).map((g) => g.id));
      parkExcessGoals(agg, goalStates, keepIds);
    }
  } else {
    // No seeds — ask user to name goals directly
    const extraction = await ctx.composePromptExtract(
      "goal-initial",
      () => initialComposition(artifacts),
      { artifactsContext: buildFullContext(artifacts), schema: InitialGoalExtractionSchema },
      { defaults: { responseInterpretation: "", goals: [], waitingRoomItems: [] } },
    );

    addFuzzyGoals(agg, goalStates, extraction.goals ?? [], ctx.currentSource);
    agg.addWaitingRoomItems(extraction.waitingRoomItems ?? []);

    // Cap without sort: all user-originated, take first N in listing order
    if (artifacts.goals.length > GOAL_DETAIL_CAP) {
      const keepIds = new Set(artifacts.goals.slice(0, GOAL_DETAIL_CAP).map((g) => g.id));
      parkExcessGoals(agg, goalStates, keepIds);
    }
  }

  // Step 2: Per-goal refinement (clarify → why → negative)
  for (const goal of artifacts.goals) {
    if (goal.status !== "fuzzy") continue;

    // Skip refinement if seed/review already provided rationale
    if (goal.rationale) {
      agg.setGoalStatus(goal.id, "elaborated");
      continue;
    }

    const gs = goalStates[goal.id] ?? { attempts: 0, probingStage: "clarify" as ProbingStage };
    if (!goalStates[goal.id]) goalStates[goal.id] = gs;

    let goalDone = false;

    while (!goalDone && gs.probingStage) {
      let stageAdvanced = false;

      for (let attempt = gs.attempts; attempt < MAX_PROBE_ATTEMPTS && !stageAdvanced; attempt++) {
        gs.attempts = attempt + 1;
        const stage = gs.probingStage;

        const extraction = await ctx.composePromptExtract(
          `goal-refinement-${goal.id}-${stage}-${attempt}`,
          () => refinementComposition(goal.title, stage, attempt, artifacts),
          { artifactsContext: buildFullContext(artifacts), schema: GoalExtractionSchema, focus: `[${goal.id}] "${goal.title}"` },
          { defaults: { responseInterpretation: "", title: null, description: null, rationale: null, contradictions: [], waitingRoomItems: [] } },
        );

        // Handle contradictions
        if (extraction.contradictions && extraction.contradictions.length > 0) {
          agg.applyGoalExtraction(goal.id, extraction);

          const reExtraction = await ctx.promptReextract(`goal-contradiction-${goal.id}-${stage}-${attempt}`, extraction.contradictions, buildFullContext(artifacts), GoalExtractionSchema, { defaults: { responseInterpretation: "", title: null, description: null, rationale: null, contradictions: [], waitingRoomItems: [] } });
          stageAdvanced = agg.applyGoalExtraction(goal.id, reExtraction);
          continue;
        }

        stageAdvanced = agg.applyGoalExtraction(goal.id, extraction);
      }

      if (!stageAdvanced) {
        agg.addFinding(`Stakeholder could not elaborate goal "${goal.title}" after ${gs.attempts} attempts`, "goals");
        goalDone = true;
      } else {
        let nextStage: ProbingStage | null = null;
        if (gs.probingStage === "clarify" && !goal.rationale) nextStage = "why";
        else if (ENABLE_GOAL_NEGATIVE_STAGE && gs.probingStage !== "negative") nextStage = "negative";
        if (nextStage) {
          gs.probingStage = nextStage;
          gs.attempts = 0;
        } else {
          agg.setGoalStatus(goal.id, "elaborated");
          goalDone = true;
        }
      }
    }
  }

  // Quality check
  const hasElaborated = artifacts.goals.some((g) => g.status === "elaborated" || g.status === "confirmed");
  if (!hasElaborated) {
    agg.addFinding("No goals reached elaborated status — downstream requirements may lack direction", "goals");
  }

  // Step 3: Single-pass confirmation
  const { response, approved, targetId } = await confirmPhase(ctx, confirmation(artifacts.goals, artifacts.findings), artifacts, "goals", 0);

  if (!approved) {
    const extraction = await ctx.extract({
      id: "goals-revision",
      response,
      artifactsContext: buildFullContext(artifacts),
      schema: GoalExtractionSchema,
    });

    const target = (targetId && artifacts.goals.find((g) => g.id === targetId))
      ?? artifacts.goals[0];
    if (target) {
      agg.applyGoalExtraction(target.id, extraction);
    }
  }

  agg.confirmElaboratedGoals();
}
