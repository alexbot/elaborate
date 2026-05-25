# Elaborate

An agent skill that helps you turn vague ideas into structured requirements.

[![CI](https://github.com/alexbot/elaborate/actions/workflows/ci.yml/badge.svg)](https://github.com/alexbot/elaborate/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@alex.botez/elaborate)](https://www.npmjs.com/package/@alex.botez/elaborate)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

## The Problem

Most people either vibe-code, start building and figure it out along the way, or paste a one-line prompt and hope what comes back is a spec. Both skip the step before planning: figuring out what success looks like, who cares, where the boundaries are, and which assumptions will bite you later.

```
             Most projects start here
                        ↓
        ┌──────┐    ┌────────┐    ┌───────┐    ┌──────┐    ┌────────┐
  ?  →  │ Plan │ →  │ Design │ →  │ Build │ →  │ Test │ →  │ Launch │
        └──────┘    └────────┘    └───────┘    └──────┘    └────────┘
  ↑
  Elaborate sits here.
```

That step has methods (qualitative research, goal modeling, structured interviews) but they depend on trained facilitators and workshops. Solo developers, founders, and small teams skip it entirely, and discover the gaps mid-build.

## Quick Start

```bash
npx skills add alexbot/elaborate -a claude-code      # Claude Code
npx skills add alexbot/elaborate -a cursor            # Cursor
npx skills add alexbot/elaborate -a github-copilot    # GitHub Copilot
```

Then `/elaborate` in your agent. Any agent that supports [agentskills.io](https://agentskills.io) works. See the [full list](https://www.npmjs.com/package/skills#supported-agents).

## What It Does

Elaborate asks the right questions, 25–32 across seven phases, and you control every answer. It moves you from a vague idea to a scoped project definition.

- Catches gaps you'd miss on your own: undefined success criteria, wrong assumptions, conflicting premises nobody stated
- Every goal, stakeholder, scope decision, and assumption traces back to the conversation turn that produced it
- AI flags ambiguity, never self-resolves. You decide everything

## Example

The vague idea:

> *"Our local library branch is losing visitors and the city might close it. I want to help revive it."*

What AI generates from that prompt, versus what emerges after 28 Elaborate questions:

| | AI-generated | After Elaborate |
|---|---|---|
| **Purpose** | **Increase traffic by 40%** through events, outreach, and digital resources | **Determine whether the library is what the neighborhood actually needs** |
| **Goals** | 8 goals with **invented metrics**: 2,500 monthly visitors, $15K fundraising, 30% card registration increase | 3 goals that **flag unknowns**: what patrons actually need, what the city's closure criteria are, who the target visitors should be |
| **Scope** | **Execution**: launch 5 programs, recruit 15 volunteers, secure grants | **Research**: talk to families, interview city council, assess whether the library is even the right solution |
| **Insight** | "The library is **a critical community asset**" (stated as fact) | "I never stopped to ask **whether the library is actually what the neighborhood needs**" |

[AI-generated brief](docs/examples/library.brief.generated.md) · [Elaborate brief](docs/examples/library.brief.md) · [More examples](docs/examples/)

## Output

The interview produces two artifacts:

- **Session file** (`.elaborate/session.yaml`). YAML with every goal, stakeholder, scope item, and assumption traced to its conversation turn. Designed as input for spec-driven development tools or any pipeline that needs structured intent.
- **Project brief.** Run `/project-brief` on the session to generate a readable markdown summary for stakeholder pitches, project kickoffs, or business plans.

The session file lives in your project directory. AI coding agents (Claude Code, Cursor, Aider, etc.) can read it directly — no conversion or extra setup needed. Point your agent at the file and it has the full structured context from the interview.

## How It Works

The interview is complex: 7 phases, state persistence, extraction cycles, deviation handling. The phases are opening, purpose, goals, stakeholders, scope, assumptions, and validation. Rather than relying on the model to follow a long prompt correctly, Elaborate splits the work. A compiled script handles all process decisions (what to ask, when to transition, how to store artifacts) while the model handles only semantic work (understanding what you said, extracting meaning, composing follow-ups). The model can't skip phases or lose track; the script drives.

Interview techniques draw on Kvale & Patton (semi-structured interviewing), Miller & Rollnick (motivational interviewing), Reynolds & Gutman (means-end laddering), and KAOS (goal decomposition). See [docs/decisions/](docs/decisions/) for the full architecture story.

## Security

Elaborate runs locally. No telemetry, no analytics, no data sent anywhere. There are no postinstall scripts — `npm install` runs nothing. All writes go to `.elaborate/` inside your project directory; nothing touches shared caches, home directories, or system paths.

## Development

Requires **Node 22+**.

```bash
npm install
npm run build          # TypeScript compilation
npm run build:skill    # esbuild bundle → dist/skill/
npx vitest run         # Run tests
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, architecture, and how to pick up work.

## License

[MIT](LICENSE)
