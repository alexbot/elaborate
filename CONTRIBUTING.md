# Contributing to Elaborate

## Prerequisites

- Node 22 or higher (`node --version`)
- npm (comes with Node)

## Setup

```bash
git clone https://github.com/alexbot/elaborate.git
cd elaborate
npm install
npm run build
```

## Running tests

```bash
npx vitest run        # deterministic unit tests (T1)
npm run build         # TypeScript compilation
npm run build:skill   # esbuild bundle → dist/skill/
npm run lint          # ESLint
```

Use `npx vitest run`, not `npm test` — `npm test` opens watch mode.

## Architecture

Four layers, alphabetic = dependency order (each layer may only import from layers above it in the alphabet):

| Layer | Directory | Role |
|-------|-----------|------|
| `durable` | `src/durable/` | Workflow framework — memoized coroutine execution |
| `interview` | `src/interview/` | Interview mechanics — extraction, composition, deviation detection |
| `phases` | `src/phases/` | Seven interview phases, artifact schemas, session persistence |
| `skill` | `src/skill/` | Claude Code adapter and logging |

If you're not sure which layer your change belongs in, `durable` and `interview` are foundational. Most feature work lives in `phases`.

## Finding work

Browse [open issues](https://github.com/alexbot/elaborate/issues) labeled [`good-first-issue`](https://github.com/alexbot/elaborate/issues?q=label%3Agood-first-issue) or [`help-wanted`](https://github.com/alexbot/elaborate/issues?q=label%3Ahelp-wanted).

Area labels match the architecture layers: `interview`, `phases`, `durable`, `skill`.

To claim an issue, comment `/take` on it. A bot will assign it to you.

## Submitting a PR

1. Fork the repo and create a branch from `main`.
2. Make your changes.
3. Verify locally:
   ```bash
   npx vitest run
   npm run build && npm run build:skill
   npm run lint
   ```
4. Open a PR against `main`. Reference the issue it closes.

**PR conventions:**
- One concern per PR — don't bundle unrelated changes.
- Match existing code style. Don't reformat code you're not changing.
- New behavior should be covered by tests.
- All CI checks must pass before merge.

## Code of conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md).
