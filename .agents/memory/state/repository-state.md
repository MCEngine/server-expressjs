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
`wiki/information/overview.md`, `wiki/information/data-model.md`,
`wiki/information/api-contract.md`, `wiki/logs/0/0/0/CHANGELOG.md`, `README.md`, and
`LICENSE` (MIT, MCEngine, 2026 — already present, not written by the setup).

Plus the runtime: `package.json` (`@mcengine/server-expressjs` at `0.0.0`), `tsconfig.json`
and `tsconfig.build.json`, `vitest.config.ts`, `.gitignore`, `.env.example`,
`package-lock.json`, `src/` and `test/`, and `wiki/environments/{setup,env}.md`.

**Does not exist:** the database. No schema, no migrations, no ORM, and no domain routes —
no accounts, no products, no fleet. `/health` and `/health/ready` are the only routes.
No Dockerfile and no CI workflow; neither was asked for.

## Stack

**Installed:** Node 22, Express 5, TypeScript 5.8 in strict mode with
`noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`, Zod for the environment schema,
Vitest with Supertest. Two runtime dependencies only — Express and Zod. The logger is fifty
lines over `console` rather than a dependency, because this service needs neither transports
nor redaction yet, and it is one file to replace when it does.

**Decided, not yet installed:** Prisma over SQLite for tests and PostgreSQL, MySQL and
MariaDB in production. MongoDB is deferred to a separate adapter behind the same repository
interfaces, because it needs its own Prisma schema and supports no migrations.

**Verified:** `npm run check` green — `tsc --noEmit` clean and 18 tests passing across four
suites. `npm run build` compiles, and the compiled entry point serves `/health`,
`/health/ready` and the 404 envelope, sets `X-Request-Id`, omits `X-Powered-By`, and exits
cleanly on SIGTERM.

## Next step

The persistence layer: repository interfaces, the Prisma schema for the four SQL engines,
migrations, and a SQLite harness the suite can build and tear down per run. It is checked
against `wiki/information/data-model.md`, which is already written.

The full ordered plan is in `MCEngine/plugin-manager` at
`.agents/memory/tasks/mcpluginmanager-platform.md`.
