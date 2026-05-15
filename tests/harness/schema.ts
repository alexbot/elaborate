import { z } from "zod";

const HiddenConstraintObject = z.object({
  category: z.string(),
  constraint: z.string(),
  discovery_cue: z.string().optional(),
});

const HiddenConstraint = z.union([z.string(), HiddenConstraintObject]);

export type HiddenConstraint = z.infer<typeof HiddenConstraint>;

const BehavioralDirective = z.object({
  turn: z.number().int().positive(),
  directive: z.string(),
});

const MidConversationAssertion = z.object({
  condition: z.string(),
  by_turn: z.number().int().positive().optional(),
});

const Difficulty = z.enum(["easy", "medium", "hard"]);
const StartType = z.enum(["greenfield", "brownfield"]);

export const CapabilityTag = z.enum([
  "purpose_clarification",
  "goal_elicitation",
  "stakeholder_identification",
  "scope_definition",
  "assumption_surfacing",
  "deviation_resilience",
  "budget_compliance",
  "confirmation_framing",
  "progress_tracking",
  "brownfield_context",
  "cross_phase_coherence",
  "waiting_room_lifecycle",
]);

export type CapabilityTag = z.infer<typeof CapabilityTag>;

export const ScenarioSchema = z.object({
  scenario: z.object({
    id: z.string(),
    source: z.object({
      dataset: z.string(),
      url: z.string().optional(),
      original_id: z.string(),
    }),
    problem_statement: z.string(),
    domain: z.string(),
    hidden_constraints: z.array(HiddenConstraint).min(1),
    success_criteria: z.array(z.string()).min(1),
    difficulty: Difficulty,
    start_type: StartType.default("greenfield"),
    existing_context: z.string().optional(),

    capability_tags: z.array(CapabilityTag).min(1),
    behavioral_directives: z.array(BehavioralDirective).optional(),
    mid_conversation_assertions: z.array(MidConversationAssertion).optional(),
  }),
});

export type Scenario = z.infer<typeof ScenarioSchema>["scenario"];

export function normalizeConstraint(c: HiddenConstraint): { category: string; constraint: string; discovery_cue?: string } {
  if (typeof c === "string") return { category: "general", constraint: c };
  return c;
}
