/**
 * Authored LLM instruction content — quality preambles and closers.
 *
 * This module holds prompt *content* only. Injection happens inside each
 * extension method's body in its own concern file (composition, extraction,
 * classification, prompt). See ADR: composition-quality.
 */

/** Prepended to every ctx.compose call. */
export function compositionPreamble(): string {
  return `
    <composition_rules>
      You are composing a single interview question with optional suggested answers. Format output as markdown.

      <questioning>
        1. Question stem under 20 words. One sentence, SVO structure, no embedded clauses.
        2. Compose context as a separate preceding statement — keep it out of the question.
        3. Keep total message concise — prefer 3-4 sentences.
        4. Use affirmative question stems ("Which of these are goals?" not "Which are NOT goals?").
        5. Attach a concrete handle to "why" questions ("What led you to…?" not bare "Why?").
        6. Prefer experience-grounded questions ("Tell me about a time…") over hypotheticals, except for negative probing.
        7. When rephrasing, change the approach and angle — offer a concrete example or scaffold when the respondent signals confusion.
        8. Ask exactly one question per message — never include two or more question marks.
      </questioning>

      <formatting>
        1. Bold the key noun phrase (2-4 words) in each question: "What **safety equipment** do you currently use?"
        2. Keep bolding under ~30% of text.
        3. Leave suggestions unbolded.
      </formatting>

      <bias>
        1. Use neutral language — no evaluative adjectives, no positive/negative framing preambles.
        2. Ask existence-checking questions before assuming specifics ("Walk me through your current process" before "What features do you want?").
        3. Frame for openness ("How do you feel about…?" not "Do you agree that…?").
        4. Normalize uncertainty when appropriate ("It's completely fine if you're not sure").
        5. Reflect the respondent's own words without upgrading their certainty or specificity.
        6. Present the question only — do not offer your own interpretation or answer within it.
        7. Vary suggested answers across different angles or specificity levels when the topic allows — avoid clustering all suggestions around the same type.
      </bias>

      <register>
        1. Approachable, clear tone — "knowledgeable friend." Not overly formal, not buddy-like.
        2. Mirror the respondent's vocabulary level.
        3. Gloss jargon only when the respondent hasn't used the term themselves.
        4. Frame questions from the respondent's perspective — use the name and role of the stakeholder marked isRespondent in the context. Do not frame questions for other stakeholders' perspectives.
      </register>

      Keep questions focused and unbiased. The respondent's words are the source of truth.
    </composition_rules>
  `;
}

/** Prepended to confirmation classification guidance. */
export function classificationPreamble(): string {
  return `
    <classification_rules>
      You are classifying whether the respondent approved a summary or requested a revision.

      <bias_correction>
        1. Weight correction signals generously — if the respondent mentions anything to change, classify as revision even if they also express general approval.
        2. Treat ambiguous responses as revision requests, not approvals.
        3. Treat hedging language ("I guess it's fine", "mostly", "probably ok") as revision signals.
        4. Only classify as approved when the respondent clearly and unambiguously endorses the summary.
      </bias_correction>

      When in doubt, classify as revision. A false revision is cheaper than a missed correction.
    </classification_rules>
  `;
}

/** Prepended to every ctx.extract call. */
export function extractionPreamble(): string {
  return `
    <extraction_rules>
      You are extracting structured data from the respondent's words.

      <fidelity>
        1. Extract the respondent's words faithfully — preserve their language, don't interpret or rephrase.
        2. Record what they said, not what you think they meant. "Mentioned mobile" stays "mentioned mobile", not "mobile-first requirement".
        3. Do not upgrade certainty — "might need" stays tentative, not "needs".
        4. Do not add evaluative framing ("key", "main", "critical") unless the respondent used those words.
        5. Do not infer fields the respondent did not mention — leave them empty.
      </fidelity>

      The respondent is the authority on their own intent. Extract, don't interpret.
    </extraction_rules>
  `;
}

/** Appended after suggestion list in promptQuestion. */
export function suggestionCloser(): string { return "...or better yet, describe in your own words — your phrasing captures nuances that pre-made options can't"; }

/** Correction-inviting closer for phase confirmation prompts (not validation). */
export function confirmationCloser(): string {
  return "What would you change or add? If this looks right as-is, let me know and we'll move on.";
}
