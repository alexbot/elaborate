import type { Artifacts } from "../../src/phases/schema.js";

export interface StateEntry {
  id: string;
  value: unknown;
  suspended?: true;
}

export interface ValidatorInput {
  entries: StateEntry[];
  artifacts: Artifacts;
}

export interface ValidatorResult {
  name: string;
  pass: boolean;
  details?: string;
}

export type Validator = (input: ValidatorInput) => ValidatorResult;
