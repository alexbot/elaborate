import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type { LanguageModel } from "ai";
import type { T3Driver } from "./driver.js";
import { createApiDriver } from "./driver-api.js";
import { createCliDriver } from "./driver-cli.js";

export interface ModelConfig {
  judge: LanguageModel;
  generation: LanguageModel;
  stakeholder: LanguageModel;
}

export function resolveModel(spec: string): LanguageModel {
  const colonIdx = spec.indexOf(":");
  if (colonIdx === -1) {
    throw new Error(
      `Invalid model spec "${spec}". Expected "provider:model-id" (e.g., "anthropic:claude-sonnet-4-6-20250514").`,
    );
  }
  const provider = spec.slice(0, colonIdx);
  const modelId = spec.slice(colonIdx + 1);

  switch (provider) {
    case "anthropic":
      return createAnthropic()(modelId);
    case "openai":
      return createOpenAI()(modelId);
    case "google":
      return createGoogleGenerativeAI()(modelId);
    case "openrouter": {
      const orProvider = process.env.OPENROUTER_PROVIDER;
      const or = createOpenRouter({ apiKey: process.env.OPENROUTER_API_KEY });
      return or.chat(modelId, orProvider
        ? { provider: { order: [orProvider], allow_fallbacks: false } }
        : undefined,
      );
    }
    default:
      throw new Error(
        `Unknown provider "${provider}". Supported: anthropic, openai, google, openrouter.`,
      );
  }
}

export function loadModelConfig(): ModelConfig {
  const judgeSpec = process.env.JUDGE_MODEL;
  const genSpec = process.env.ELI_MODEL;
  const shSpec = process.env.SH_MODEL;

  if (!judgeSpec) throw new Error("JUDGE_MODEL env var required (e.g., anthropic:claude-sonnet-4-6-20250514)");
  if (!genSpec) throw new Error("ELI_MODEL env var required (e.g., anthropic:claude-haiku-4-5-20251001)");

  return {
    judge: resolveModel(judgeSpec),
    generation: resolveModel(genSpec),
    stakeholder: resolveModel(shSpec ?? genSpec),
  };
}

export type DriverType = "api" | "cli";

export interface DriverConfig {
  generation: T3Driver;
  stakeholder: T3Driver;
  judge: T3Driver;
}

export function loadModelLabels(): import("./types.js").ModelLabels {
  const driverType = (process.env.T3_DRIVER ?? "cli") as DriverType;
  if (driverType === "cli") {
    const gen = process.env.CLI_ELI_MODEL ?? "cli-default";
    return {
      generation: gen,
      stakeholder: process.env.CLI_SH_MODEL ?? gen,
      judge: process.env.CLI_JUDGE_MODEL ?? "cli-default",
    };
  }
  const gen = process.env.ELI_MODEL ?? "unknown";
  return {
    generation: gen,
    stakeholder: process.env.SH_MODEL ?? gen,
    judge: process.env.JUDGE_MODEL ?? "unknown",
  };
}

export function loadDriverConfig(): DriverConfig {
  const driverType = (process.env.T3_DRIVER ?? "cli") as DriverType;

  if (driverType === "cli") {
    const judgeModel = process.env.CLI_JUDGE_MODEL;
    const genModel = process.env.CLI_ELI_MODEL;
    const shModel = process.env.CLI_SH_MODEL;
    return {
      generation: createCliDriver({ model: genModel }),
      stakeholder: createCliDriver({ model: shModel ?? genModel, persistent: true }),
      judge: createCliDriver({ model: judgeModel, timeoutMs: 180_000, persistent: true }),
    };
  }

  const models = loadModelConfig();
  return {
    generation: createApiDriver(models.generation),
    stakeholder: createApiDriver(models.stakeholder),
    judge: createApiDriver(models.judge),
  };
}
