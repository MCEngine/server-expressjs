---
name: memory-state-repository-state
description: What this repository contains right now, what it does not yet, and the next obvious step.
---

# Repository state

Overwritten in place, always current.

## As of the agent instruction system landing

`MCEngine/server-expressjs` is a **Mode B consumer** of the shared instruction set served by
the `lxagents-agents-base` connector. It declares no overrides.

**Exists:** `AGENTS.md`, `.claude/CLAUDE.md`, the six indexes under `.agents/index/`,
`.agents/rules/repository.md`, `.agents/wiki/context/repository-map.md`, this memory tree,
`wiki/information/overview.md`, `wiki/logs/0/0/0/CHANGELOG.md`, `README.md`, and `LICENSE`
(MIT, MCEngine, 2026 — already present, not written by the setup).

**Does not exist:** every line of code. No `package.json`, no `src/`, no `tsconfig.json`, no
`.gitignore`, no lockfile, no tests, no Dockerfile, no CI. The version carrier itself —
`version` in `package.json` — does not exist yet either; `0.0.0` is the agreed value for
when it does.

## Stack

Decided in the plan, not yet installed: Node with Express and TypeScript, Prisma over
SQLite for tests and PostgreSQL, MySQL and MariaDB in production, Vitest for the suite.
MongoDB is deferred to a separate adapter behind the same repository interfaces, because it
needs its own Prisma schema and supports no migrations.

## Next step

The Express skeleton: `package.json` at `0.0.0` naming `@mcengine/server-expressjs`,
TypeScript configuration, the config and error-envelope layer, a health route, and the test
harness. The data model and the API contract are documented first, in the task before it, so
the schema is reviewable before any of it is implemented.

The full ordered plan is in `MCEngine/plugin-manager` at
`.agents/memory/tasks/mcpluginmanager-platform.md`.
