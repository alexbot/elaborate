/**
 * PAM aggregate mutations — Purpose, Advantage, Measurement singletons.
 *
 * The three slots share identical structure ({statement, confidence, source?}
 * with first-fill → update → confirm confidence progression), so the
 * implementation is a single `setPamSlot` helper; the facade exposes three
 * distinct methods for caller clarity.
 */

import type { Artifacts, Source } from "../schema.js";
import { nextPamConfidence } from "./shared.js";

type PamSlot = "purpose" | "advantage" | "measurement";

function setPamSlot(data: Artifacts, slot: PamSlot, statement: string, confidence: number, source?: Source): void {
  const effectiveSource = data[slot]?.source ?? source;
  data[slot] = { statement, confidence, ...(effectiveSource && { source: effectiveSource }) };
}

export function setPurpose(data: Artifacts, statement: string, confidence: number, source?: Source): void {
  setPamSlot(data, "purpose", statement, confidence, source);
}

export function setAdvantage(data: Artifacts, statement: string, confidence: number, source?: Source): void {
  setPamSlot(data, "advantage", statement, confidence, source);
}

export function setMeasurement(data: Artifacts, statement: string, confidence: number, source?: Source): void {
  setPamSlot(data, "measurement", statement, confidence, source);
}

export function confirmPam(data: Artifacts, confidence = 0.9): void {
  for (const slot of ["purpose", "advantage", "measurement"] as const) {
    const current = data[slot];
    if (current) data[slot] = { ...current, confidence };
  }
}

export function applyPamExtraction(
  data: Artifacts,
  ext: { purpose?: string | null; advantage?: string | null; measurement?: string | null },
  source?: Source,
): void {
  for (const slot of ["purpose", "advantage", "measurement"] as const) {
    const value = ext[slot];
    if (value) setPamSlot(data, slot, value, nextPamConfidence(data[slot]?.confidence), source);
  }
}
