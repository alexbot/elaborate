import { generateText, generateObject } from "ai";
import type { LanguageModel } from "ai";
import type { T3Driver } from "./driver.js";

const DEFAULT_TIMEOUT_MS = 60_000;

export function createApiDriver(model: LanguageModel): T3Driver {
  return {
    async chat(system, messages, options) {
      const result = await generateText({
        model,
        system,
        messages,
        temperature: options?.temperature ?? 0.7,
        maxTokens: options?.maxTokens ?? 4096,
        abortSignal: AbortSignal.timeout(options?.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      });
      return result.text;
    },

    async structuredOutput(system, prompt, schema, options) {
      const result = await generateObject({
        model,
        system,
        prompt,
        schema,
        temperature: options?.temperature ?? 0.3,
        maxTokens: options?.maxTokens ?? 4096,
        abortSignal: AbortSignal.timeout(options?.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      });
      return result.object;
    },
  };
}
