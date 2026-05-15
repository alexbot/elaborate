/**
 * Stakeholder identification phase — list-upfront, elaborate, confirm.
 *
 * Captures stakeholders through:
 * 1. Waiting room drain + list review — present seeds, collect corrections/additions
 * 2. Respondent identification — who is answering on behalf of whom
 * 3. Per-stakeholder elaboration (role + concerns + conditional follow-up)
 * 4. Confirmation with revision loop
 *
 * Uses iStar/Pohl actor model. Progressive status:
 * identified(0.5) → elaborated(0.7) → confirmed(0.9).
 * List-upfront (not iterative "more?") — contrast with goals phase.
 */

import { z } from "zod";
import type { WorkflowContext } from "../durable/index.js";
import type { Artifacts, Stakeholder, Finding } from "./schema.js";
import { StakeholderType } from "./schema.js";
import type { ArtifactAggregate } from "./aggregate/index.js";
import { buildFullContext, confirmationCloser, confirmPhase } from "./shared.js";
import { compositionPreamble, inferCompositionStep, inferStep } from "../interview/index.js";
import { PRIMARY_SH_CAP, SECONDARY_SH_CAP, EXTERNAL_SH_CAP } from "./configuration.js";

const MAX_ELABORATION_ATTEMPTS = 3;

const StakeholderSeedSchema = z.object({
  stakeholders: z.array(z.object({
    name: z.string().describe("stakeholder name or role"),
    type: StakeholderType.optional().describe("'primary', 'secondary', or 'external'"),
  })).optional().describe("stakeholder candidates from the waiting room, empty if none"),
  drainedWaitingRoomIds: z.array(z.string()).optional()
    .describe('IDs of waiting room items used as stakeholder sources (e.g. ["waiting_001"]), empty if none'),
});

const ReviewExtractionSchema = z.object({
  responseInterpretation: z.string().describe("what the respondent meant, resolving any references"),
  updatedTypes: z.array(z.object({ id: z.string().describe("stakeholder ID"), type: StakeholderType.describe("corrected type") })).optional().describe("type corrections (primary/secondary/external), empty if none"),
  removedIds: z.array(z.string()).optional().describe("stakeholder IDs to remove, empty if none"),
  newStakeholders: z.array(z.object({ name: z.string().describe("stakeholder name or role"), type: StakeholderType.describe("'primary', 'secondary', or 'external'") })).optional().describe("new stakeholders mentioned, empty if none"),
});

const RespondentExtractionSchema = z.object({
  responseInterpretation: z.string().describe("what the respondent meant"),
  respondentId: z.string().nullable().optional().describe("ID of the stakeholder that IS the respondent, null if unclear"),
});

const ElaborationExtractionSchema = z.object({
  responseInterpretation: z.string().describe("what the respondent meant, resolving any suggestion references (a, b, c) to their full text"),
  role: z.string().nullable().optional().describe("this specific stakeholder's role as described by the respondent — not the respondent's own role or any other stakeholder's role from context. null if not addressed"),
  concerns: z.array(z.string()).optional().describe("stakeholder concerns extracted from the response, empty if none"),
  contradictions: z.array(z.string()).optional().describe("genuine logical contradictions between stated concerns and existing goals or purpose where both statements CANNOT be true simultaneously (e.g. 'stakeholder opposes feature X' vs 'goal requires feature X'). NOT: different priorities between stakeholders, complementary concerns, soft tensions, or different aspects of the same goal. Empty array if none"),
  waitingRoomItems: z.array(z.object({ content: z.string().describe("the item text") })).optional().describe("items that sound like scope or assumptions rather than stakeholder concerns, empty if none"),
});

const FollowUpAssessmentSchema = z.object({
  needed: z.boolean().describe("true if the elaboration answer has meaningful gaps worth probing — missing role, thin concerns (0-1), or unexplored domain-specific angles. false if role and 2+ specific concerns were captured"),
  question: z.string().optional().describe("a targeted follow-up question addressing the identified gap, only when needed is true"),
  suggestions: z.array(z.string()).optional().describe("2-3 suggested answers for the follow-up question, only when needed is true"),
});

const StakeholderDedupSchema = z.object({
  duplicateGroups: z.array(z.object({
    keepId: z.string().describe("the stakeholder ID to keep"),
    removeIds: z.array(z.string()).describe("stakeholder IDs that are semantically duplicate of keepId — same actor/role, different wording"),
  })).describe("groups of semantically duplicate stakeholders — only flag entries you are CERTAIN represent the same actor/role with different wording"),
});

const StakeholderSortSchema = z.object({
  rankedStakeholderIds: z.array(z.string()).describe("stakeholder IDs ordered from highest to lowest priority for probing"),
});

function stakeholderSort(type: string, stakeholders: Stakeholder[], artifacts: Artifacts, userAddedIds: string[]) {
  const shRef = stakeholders.map((s) => `[${s.id}] "${s.name}" (${s.type})`).join("; ");
  const goalRef = artifacts.goals.map((g) => `[${g.id}] "${g.title}" — ${g.description}`).join("; ");
  const pamRef = [
    artifacts.purpose ? `Purpose: ${artifacts.purpose.statement}` : null,
    artifacts.advantage ? `Advantage: ${artifacts.advantage.statement}` : null,
    artifacts.measurement ? `Measurement: ${artifacts.measurement.statement}` : null,
  ].filter(Boolean).join("; ");
  const userAddedRef = userAddedIds.length > 0
    ? `User-added during review (not agent-inferred): ${userAddedIds.join(", ")}`
    : "All stakeholders are agent-inferred.";

  return inferStep({
    id: `stakeholder-sort-${type}`,
    schema: StakeholderSortSchema,
    message: `
      Rank these stakeholders by priority for detailed probing.

      Stakeholders: ${shRef}
      Goals: ${goalRef}
      PAM: ${pamRef}
      ${userAddedRef}

      Criteria (in order):
      1. Stakeholder importance: how central is this stakeholder to the product's value delivery? End-users and primary beneficiaries of the product rank highest — their unmet needs represent the highest-risk gaps.
      2. Information gap: how much do we actually know about their specific concerns vs. inferring from goals? Rank higher when concerns are unknown or merely assumed, even if they seem to echo stated goals.
      3. User-added: stakeholders the user named during review rank above agent-inferred ones.

      Return ALL stakeholder IDs, ordered from highest to lowest priority.
    `,
  });
}

function stakeholderDedup(artifacts: Artifacts) {
  const shRef = artifacts.stakeholders.map((s) => `[${s.id}] "${s.name}" (${s.type})`).join("; ");

  return inferStep({
    id: "stakeholder-dedup",
    schema: StakeholderDedupSchema,
    message: `
      Identify semantically duplicate stakeholders — entries that represent the same actor or role with different wording.

      Stakeholders: ${shRef}

      Rules:
      1. Only group entries you are CERTAIN represent the same actor/role (e.g. "Healthcare Providers" and "Healthcare Provider Representatives" describing the same group). Related but distinct actors are NOT duplicates.
      2. Actors with overlapping concerns but different roles are NOT duplicates (e.g. "Nurses" and "Doctors" both care about patient outcomes but are distinct stakeholders).
      3. For each group, pick the clearest/most specific name as keepId.
      4. Return an empty array if there are no duplicates.
    `,
  });
}

function reviewPresent(stakeholders: Stakeholder[]): { id: string; message: string } {
  if (stakeholders.length === 0) {
    return {
      id: "stakeholder-review-present",
      message: `
        I haven't identified any specific stakeholders yet from our conversation.

        Who will be the main people involved in or affected by this project?
        Think about: direct users, administrators, managers, external parties, regulators, etc.
      `,
    };
  }
  const letters = "abcdefghijklmnopqrstuvwxyz";
  const shList = stakeholders.map((s, i) => `${letters[i]}) **${s.name}** (${s.type})`).join("\n");
  return {
    id: "stakeholder-review-present",
    message: `
      Based on what you've told me, I see these people involved in your project:
      ${shList}
      
      What would you change, add, or remove?
    `,
  };
}

function respondentPresent(stakeholders: Stakeholder[]): { id: string; message: string } {
  const names = stakeholders.map((s) => s.name).join(", or ");
  return {
    id: "stakeholder-respondent-present",
    message: `Which of these roles best describes you — ${names}?`,
  };
}

function elaborationComposition(stakeholder: Stakeholder, isRephrase: boolean, attempt: number, artifacts: Artifacts) {
  const direction = isRephrase
    ? `The previous question about "${stakeholder.name}" didn't get a clear answer about their role or concerns. Try a different angle — offer concrete examples relevant to the project domain.`
    : `Ask about "${stakeholder.name}"'s role in the project and what they would care most about.`;
  return inferCompositionStep({
    id: "",
    fallback: "Could you tell me more about this stakeholder's role and what they'd care most about?",
    message: `
      Compose a question for the respondent about stakeholder: "${stakeholder.name}" (${stakeholder.type}).
      ${direction}
      Include 2-3 suggested answers that show the expected level of specificity.

      Context:
      ${buildFullContext(artifacts)}
    `,
  });
}


function followUpAssessment(stakeholder: Stakeholder, elaborationResult: { role?: string | null; concerns?: string[] }, artifacts: Artifacts) {
  const role = elaborationResult.role ?? "(not captured)";
  const concerns = (elaborationResult.concerns ?? []).length > 0
    ? (elaborationResult.concerns ?? []).join("; ")
    : "(none captured)";

  return inferStep({
    id: `stakeholder-followup-assessment-${stakeholder.id}`,
    schema: FollowUpAssessmentSchema,
    message: `
      Assess whether a follow-up question about "${stakeholder.name}" (${stakeholder.type}) would surface meaningful new information.

      Elaboration captured:
      - Role: ${role}
      - Concerns: ${concerns}

      If the elaboration answer is rich (role present AND 2+ specific concerns), set needed=false.
      If there are meaningful gaps (missing role, thin/generic concerns, unexplored domain-specific angles), set needed=true and compose a targeted follow-up question.

      The follow-up should address the specific gap — do not default to "if you were in their shoes" unless no better angle exists. Consider:
      - Missing role → ask about their relationship to the project
      - Thin concerns → probe for specific domain-relevant worries
      - Generic concerns → ask for concrete examples
      - Perspective-switching is one option when the respondent struggles to articulate proxy concerns

      ${compositionPreamble()}

      Context:
      ${buildFullContext(artifacts)}
    `,
  });
}


function confirmation(stakeholders: Stakeholder[], findings: Finding[]): { id: string; message: string } {
  const shList = stakeholders.map((s) => {
    const respondent = s.isRespondent ? " _(you)_" : "";
    const role = s.role ? `\n  Role: ${s.role}` : "";
    const concerns = s.concerns.length > 0 ? `\n  Concerns: ${s.concerns.join("; ")}` : "";
    return `**${s.name}** [${s.type}, ${s.status}]${respondent}${role}${concerns}`;
  }).join("\n\n");
  const shFindings = findings.filter((f) => f.phase === "stakeholders");
  const findingsSection = shFindings.length > 0
    ? `\n**Notes**:\n${shFindings.map((f) => `- ${f.content}`).join("\n")}\n`
    : "";
  return {
    id: "stakeholders-confirmation",
    message: `
      Here's what I've captured for your project stakeholders:
      ${shList}
      ${findingsSection}
      ${confirmationCloser()}`,
  };
}

export async function runStakeholders(ctx: WorkflowContext, agg: ArtifactAggregate): Promise<void> {
  const artifacts = agg.data;

  // Step 1: Waiting room drain, list review — present seeds, collect corrections/additions
  if (artifacts.waitingRoom.length > 0) {
    const preWaitingRoomIds = new Set(artifacts.waitingRoom.map((w) => w.id));
    const seeds = await ctx.seed({
      id: "stakeholder-seed-extraction",
      artifactsContext: buildFullContext(artifacts, { includeWaitingRoom: true }),
      schema: StakeholderSeedSchema,
      guidance: "Identify stakeholder candidates — people, roles, groups, or organizations involved in or affected by the project. Pull hints from the waitingRoom items in the context; return drainedWaitingRoomIds for the items you consumed.",
    });

    agg.addIdentifiedStakeholders(
      (seeds.stakeholders ?? []).map((s) => ({ name: s.name, type: s.type ?? "secondary" })),
      ctx.currentSource,
    );

    const drainedIds = new Set(
      (seeds.drainedWaitingRoomIds ?? []).filter((id) => preWaitingRoomIds.has(id)),
    );
    agg.drainWaitingRoom(drainedIds);
  }

  const stakeholderRef = artifacts.stakeholders.map((s) => `${s.id}: "${s.name}" (${s.type})`).join(", ");
  const classification = await ctx.promptReview(reviewPresent(artifacts.stakeholders), "stakeholder-review-classification", stakeholderRef, buildFullContext(artifacts), ReviewExtractionSchema, { defaults: { responseInterpretation: "", updatedTypes: [], removedIds: [], newStakeholders: [] } });

  // Apply type corrections
  if (classification.updatedTypes) {
    for (const update of classification.updatedTypes) {
      agg.updateStakeholder(update.id, { type: update.type });
    }
  }

  // Remove rejected stakeholders
  const removedIds = new Set(classification.removedIds ?? []);
  if (removedIds.size > 0) {
    agg.removeStakeholders(removedIds);
  }

  // Track user-added stakeholders for sort tiebreaker
  const preReviewIds = new Set(artifacts.stakeholders.map((s) => s.id));
  agg.addIdentifiedStakeholders(classification.newStakeholders ?? [], ctx.currentSource);
  const userAddedIds = artifacts.stakeholders
    .filter((s) => !preReviewIds.has(s.id))
    .map((s) => s.id);

  // Step 2: Respondent identification
  if (artifacts.stakeholders.length > 0) {
    const updatedRef = artifacts.stakeholders.map((s) => `${s.id}: "${s.name}" (${s.type})`).join(", ");
    const respondentResult = await ctx.promptExtract(
      respondentPresent(artifacts.stakeholders),
      { artifactsContext: buildFullContext(artifacts), schema: RespondentExtractionSchema, guidance: `The respondent was asked which stakeholder best describes them.\nStakeholder IDs: ${updatedRef}\nThe respondent may describe their role in their own words rather than picking a listed name. This is a valid answer — match to the closest stakeholder by role overlap. Only classify as confusion if the response genuinely asks for clarification.` },
      { defaults: { responseInterpretation: "", respondentId: null } },
    );

    if (respondentResult.respondentId) {
      if (agg.stakeholder(respondentResult.respondentId)) {
        agg.setRespondent(respondentResult.respondentId);
      } else {
        agg.addFinding(`Respondent identification failed — "${respondentResult.respondentId}" not found among stakeholder IDs`, "stakeholders");
      }
    }
  }

  // Step 2b: Sort + cap — build set of stakeholders to probe
  const probeIds = new Set<string>();
  const capByType: Record<string, number> = { primary: PRIMARY_SH_CAP, secondary: SECONDARY_SH_CAP, external: EXTERNAL_SH_CAP };

  for (const type of ["primary", "secondary", "external"] as const) {
    const ofType = artifacts.stakeholders.filter((s) => s.type === type);
    const cap = capByType[type];

    if (ofType.length <= cap) {
      for (const s of ofType) probeIds.add(s.id);
    } else {
      const sortResult = await ctx.infer(stakeholderSort(type, ofType, artifacts, userAddedIds.filter((id) => ofType.some((s) => s.id === id))));
      const validIds = new Set(ofType.map((s) => s.id));
      const ranked = sortResult.rankedStakeholderIds.filter((id) => validIds.has(id));
      const keepIds = ranked.length >= cap
        ? ranked.slice(0, cap)
        : ofType.slice(0, cap).map((s) => s.id);
      for (const id of keepIds) probeIds.add(id);
    }
  }

  // Step 3: Per-stakeholder elaboration (probed set only, type-based depth)
  for (const stakeholder of artifacts.stakeholders) {
    if (stakeholder.status !== "identified") continue;
    if (!probeIds.has(stakeholder.id)) continue;

    // Elaboration: role + concerns
    let elaborated = false;
    for (let attempt = 0; attempt < MAX_ELABORATION_ATTEMPTS && !elaborated; attempt++) {
      const isRephrase = attempt > 0;

      const extraction = await ctx.composePromptExtract(
        `stakeholder-elaboration-${stakeholder.id}-${attempt}`,
        () => elaborationComposition(stakeholder, isRephrase, attempt, artifacts),
        { artifactsContext: buildFullContext(artifacts), schema: ElaborationExtractionSchema, focus: `[${stakeholder.id}] "${stakeholder.name}" (${stakeholder.type})` },
        { defaults: { responseInterpretation: "", role: null, concerns: [], contradictions: [], waitingRoomItems: [] } },
      );

      // Handle contradictions
      if (extraction.contradictions && extraction.contradictions.length > 0) {
        agg.applyStakeholderElaboration(stakeholder.id, extraction);

        const reExtraction = await ctx.promptReextract(`stakeholder-elaboration-contradiction-${stakeholder.id}-${attempt}`, extraction.contradictions, buildFullContext(artifacts), ElaborationExtractionSchema, { defaults: { responseInterpretation: "", role: null, concerns: [], contradictions: [], waitingRoomItems: [] } });
        elaborated = agg.applyStakeholderElaboration(stakeholder.id, reExtraction);
        continue;
      }

      elaborated = agg.applyStakeholderElaboration(stakeholder.id, extraction);
    }

    if (!elaborated) {
      agg.addFinding(`Could not elaborate stakeholder "${stakeholder.name}" after ${MAX_ELABORATION_ATTEMPTS} attempts`, "stakeholders");
      continue;
    }

    // Conditional follow-up: primary non-respondent only, assessment-driven
    if (stakeholder.type === "primary" && !stakeholder.isRespondent) {
      const assessment = await ctx.infer(followUpAssessment(stakeholder, { role: stakeholder.role, concerns: stakeholder.concerns }, artifacts));

      if (assessment.needed && assessment.question) {
        const response = await ctx.promptQuestion(
          `stakeholder-followup-${stakeholder.id}-question-r0`,
          { question: assessment.question, suggestions: assessment.suggestions },
        );

        const followUpExtraction = await ctx.extract({
          id: `stakeholder-followup-${stakeholder.id}-extraction-r0`,
          response,
          artifactsContext: buildFullContext(artifacts),
          schema: ElaborationExtractionSchema,
          focus: `[${stakeholder.id}] "${stakeholder.name}" (${stakeholder.type})`,
        });

        agg.applyStakeholderElaboration(stakeholder.id, followUpExtraction);

        if (followUpExtraction.contradictions && followUpExtraction.contradictions.length > 0) {
          const reExtraction = await ctx.promptReextract(`stakeholder-followup-contradiction-${stakeholder.id}`, followUpExtraction.contradictions, buildFullContext(artifacts), ElaborationExtractionSchema, { defaults: { responseInterpretation: "", role: null, concerns: [], contradictions: [], waitingRoomItems: [] } });
          agg.applyStakeholderElaboration(stakeholder.id, reExtraction);
        }
      }

      // Proxy reliability check: if no concerns after elaboration + optional follow-up
      if (stakeholder.concerns.length === 0) {
        agg.addFinding(`Respondent could not articulate concerns for "${stakeholder.name}" — proxy knowledge may be limited, consider direct validation`, "stakeholders");
      }
    }

    // Mark elaborated
    agg.setStakeholderStatus(stakeholder.id, "elaborated");
  }

  // Quality check: only among probed stakeholders
  const hasElaboratedPrimary = artifacts.stakeholders.some(
    (s) => s.type === "primary" && probeIds.has(s.id) && (s.status === "elaborated" || s.status === "confirmed"),
  );
  if (!hasElaboratedPrimary) {
    agg.addFinding("No primary stakeholder has been elaborated — downstream requirements may miss critical perspectives", "stakeholders");
  }

  // Step 3b: Semantic deduplication
  if (artifacts.stakeholders.length >= 2) {
    const dedupResult = await ctx.infer(stakeholderDedup(artifacts));
    for (const group of dedupResult.duplicateGroups ?? []) {
      const keep = agg.stakeholder(group.keepId);
      if (!keep) continue;
      const validRemoveIds = group.removeIds.filter((id) => agg.stakeholder(id));
      for (const removeId of validRemoveIds) {
        const removed = agg.stakeholder(removeId)!;
        if (removed.concerns.length > 0) agg.addConcerns(keep.id, removed.concerns);
        if (removed.isRespondent) agg.setRespondent(keep.id);
        if (removed.status === "elaborated" && keep.status === "identified") {
          agg.setStakeholderStatus(keep.id, "elaborated");
        }
      }
      if (validRemoveIds.length > 0) {
        agg.removeStakeholders(new Set(validRemoveIds));
      }
    }
  }

  // Step 4: Single-pass confirmation
  const { response, approved, targetId } = await confirmPhase(ctx, confirmation(artifacts.stakeholders, artifacts.findings), artifacts, "stakeholders", 0);

  if (!approved) {
    const extraction = await ctx.extract({
      id: "stakeholders-revision",
      response,
      artifactsContext: buildFullContext(artifacts),
      schema: ElaborationExtractionSchema,
    });

    const target = (targetId && artifacts.stakeholders.find((s) => s.id === targetId))
      ?? artifacts.stakeholders[0];
    if (target) {
      agg.applyStakeholderElaboration(target.id, extraction);
    }
  }

  agg.confirmElaboratedStakeholders();
}
