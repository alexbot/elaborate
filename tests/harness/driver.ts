import type { z } from "zod";
import type { Message } from "./types.js";

export interface ChatOptions {
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
}

export interface StructuredOutputOptions {
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
}

export interface T3Driver {
  chat(
    system: string,
    messages: Message[],
    options?: ChatOptions,
  ): Promise<string>;

  structuredOutput<T>(
    system: string,
    prompt: string,
    schema: z.ZodType<T>,
    options?: StructuredOutputOptions,
  ): Promise<T>;
}
