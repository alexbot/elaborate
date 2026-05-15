import { readFileSync, readdirSync } from "node:fs";
import { join, extname, basename } from "node:path";
import { parse as parseYaml } from "yaml";
import { ScenarioSchema } from "./schema.js";
import type { Scenario } from "./schema.js";

const SCENARIOS_DIR = join(import.meta.dirname, "..", "scenarios");

export function loadScenario(filePath: string): Scenario {
  const raw = readFileSync(filePath, "utf8");
  const parsed = parseYaml(raw);
  const result = ScenarioSchema.parse(parsed);
  return result.scenario;
}

export function loadAllScenarios(): Map<string, Scenario> {
  const files = readdirSync(SCENARIOS_DIR).filter(
    (f) => extname(f) === ".yaml" || extname(f) === ".yml",
  );
  const scenarios = new Map<string, Scenario>();
  for (const file of files) {
    const scenario = loadScenario(join(SCENARIOS_DIR, file));
    scenarios.set(scenario.id, scenario);
  }
  return scenarios;
}

export function loadScenariosByCapability(tag: string): Map<string, Scenario> {
  const all = loadAllScenarios();
  const filtered = new Map<string, Scenario>();
  for (const [id, scenario] of all) {
    if (scenario.capability_tags.includes(tag as any)) {
      filtered.set(id, scenario);
    }
  }
  return filtered;
}
