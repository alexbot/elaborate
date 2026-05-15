/**
 * Cross-domain helpers shared by the aggregate modules: ID generation,
 * PAM confidence promotion, and scope/confirmed confidence constants.
 */

export const SCOPE_DEFAULT_CONFIDENCE = 0.7;
export const CONFIRMED_CONFIDENCE = 0.9;

export function nextPamConfidence(current: number | undefined): number {
  if (!current || current < 0.5) return 0.5;
  if (current < 0.7) return 0.7;
  return current;
}

/**
 * Generate the next ID in a prefix_NNN sequence.
 * Scans existing entries for the max numeric suffix so removals are safe —
 * new IDs always exceed any previously used one.
 */
export function nextId(prefix: string, existing: Array<{ id: string }>): string {
  const max = existing.reduce((m, item) => {
    const num = parseInt(item.id.split("_").pop()!, 10);
    return isNaN(num) ? m : Math.max(m, num);
  }, 0);
  return `${prefix}_${String(max + 1).padStart(3, "0")}`;
}
