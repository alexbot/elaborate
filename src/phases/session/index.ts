/**
 * Session module barrel — public surface of the former `phases/persistence.ts`.
 * Consumers should import from here, not the sibling files.
 */

export { CorruptedSessionError } from "./file.js";
export { createFilePersistence, type SessionPersistence } from "./persistence.js";
export { archiveSession, archiveCorrupted, slugify } from "./archive.js";
