/**
 * Simulated stakeholder agent.
 *
 * Receives hidden constraints + behavioral directives from the scenario,
 * calls an LLM to generate in-character responses to Eli's questions.
 */

import type { Scenario } from "./schema.js";
import { normalizeConstraint } from "./schema.js";
import type { T3Driver } from "./driver.js";
import type { Message } from "./types.js";

export interface StakeholderAgent {
  respond(eliMessage: string, turn: number): Promise<string>;
  history: Message[];
}

function buildSystemPrompt(scenario: Scenario): string {
  const constraints = scenario.hidden_constraints
    .map(normalizeConstraint)
    .map((c) => {
      let line = `- [${c.category}] ${c.constraint}`;
      if (c.discovery_cue) line += ` (reveal when: ${c.discovery_cue})`;
      return line;
    })
    .join("\n");

  return `You are a stakeholder being interviewed about a project. Stay in character throughout.

## Your project
${scenario.problem_statement}

## Domain
${scenario.domain}

${scenario.existing_context ? `## Existing context\n${scenario.existing_context}\n` : ""}
## Hidden constraints (NEVER volunteer these — only reveal when directly asked)
${constraints}

## Rules
- Answer ONLY what is asked. Do not volunteer information beyond the question's scope.
- When asked about a topic that relates to a hidden constraint, reveal the constraint naturally.
- If you don't know something, say so — don't speculate or fill in gaps with analysis.

## Response style — simulate a real person, not an analyst
- **Length**: 1-3 sentences is normal. 4-5 sentences max when the question genuinely demands detail. NEVER exceed 500 characters in a single response.
- **No unsolicited structure**: Do not reorganize lists, propose categories, segment groups, or restructure what the interviewer presented. If the interviewer's list has overlap, you might notice one thing ("I think X and Y are the same") — don't rewrite the whole list.
- **No strategic analysis**: Real people say "I think the staff might push back" — they don't produce paragraphs about power asymmetries, conflicting priorities, and decision-making authority. State your impression, not your analysis.
- **Realistic uncertainty**: Use natural hedging ("I think", "probably", "I'm not sure") when you genuinely aren't certain. Don't present guesses as facts.`;
}

function buildDirectiveInsert(scenario: Scenario, turn: number): string | undefined {
  if (!scenario.behavioral_directives) return undefined;
  const directive = scenario.behavioral_directives.find((d) => d.turn === turn);
  return directive?.directive;
}

export function createStakeholder(driver: T3Driver, scenario: Scenario): StakeholderAgent {
  const systemPrompt = buildSystemPrompt(scenario);
  const history: Message[] = [];

  return {
    history,
    async respond(eliMessage: string, turn: number): Promise<string> {
      history.push({ role: "user", content: eliMessage });

      let activeSystem = systemPrompt;
      const directive = buildDirectiveInsert(scenario, turn);
      if (directive) {
        activeSystem += `\n\n## SPECIAL DIRECTIVE FOR THIS TURN\n${directive}`;
      }

      const response = await driver.chat(activeSystem, history, { temperature: 0.7, maxTokens: 300 });
      history.push({ role: "assistant", content: response });
      return response;
    },
  };
}
