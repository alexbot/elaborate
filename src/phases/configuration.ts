// Session configuration flags. Defaults correspond to the "standard" session.
// interview-advanced-optimization will replace these with runtime configuration
// (chosen at session start, persisted for the session lifetime).
//
// Durability caveat: flag values must not change between runs of the same
// persisted session, or memoized replay will drift.

export const ENABLE_ASSUMPTIONS_PHASE = false;
export const ENABLE_GOAL_NEGATIVE_STAGE = false;
export const GOAL_DETAIL_CAP = 3;
export const PRIMARY_SH_CAP = 5;
export const SECONDARY_SH_CAP = 4;
export const EXTERNAL_SH_CAP = 2;
export const SCOPE_CONTRAST_CAP = 3;
