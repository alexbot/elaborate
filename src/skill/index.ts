/**
 * Skill layer — public barrel.
 *
 * The skill is consumed primarily via the `bin` entry (`dist/skill/adapter.js`),
 * not via library import. This barrel exists for toolkit-shape symmetry and
 * surfaces only the logger interface for testability and any future
 * programmatic adapter use. `adapter.ts` itself self-invokes `main()` and is
 * not designed for library consumption.
 */

export { createLogger, noopLogger } from "./log.js";
export type { Logger, LogContext } from "./log.js";
