# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-05-18

### Added

- Socratic interview workflow — structured 7-phase interview (opening, purpose, goals, stakeholders, scope, assumptions, validation) that moves projects from vague ideas to scoped definitions
- Structured YAML output — machine-consumable `.elaborate/session.yaml` with every goal, stakeholder, scope item, and assumption traced to conversation turns
- Multi-agent compatibility — works with Claude Code, Cursor, GitHub Copilot, and any agent supporting the agentskills.io standard
- Project-brief generation — `/project-brief` skill converts sessions into readable markdown briefs
- Session persistence — interview state survives IDE restarts with automatic archival and resumption
- Durable workflow engine — memoized coroutine execution with deterministic replay, retry, and deviation detection
- Qualitative research foundation — built on proven techniques from Kvale, Patton, Miller & Rollnick, Reynolds & Gutman, and KAOS goal modeling

[1.0.0]: https://github.com/alexbot/elaborate/releases/tag/v1.0.0
