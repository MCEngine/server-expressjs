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

Plus the persistence layer: `src/db/` (typed schema, dialect table, connection factory, two
Kysely plugins, the migration runner and the initial migration), `src/lib/ids.ts` and
`src/lib/version.ts`.

Plus the identity domain: `src/modules/identity/` (repository, service, validation, the public
account route) and `src/lib/clock.ts`.

**Does not exist:** authentication — no credentials, no sessions, no API tokens, and so no
authenticated routes; the identity service is complete but only `GET /accounts/:handle` is
mounted. No products, no uploads, no fleet. No storage driver: `storage_key` is specified and
nothing writes bytes yet. No Dockerfile and no CI workflow; neither was asked for.

## Stack

**Installed:** Node 22, Express 5, TypeScript 5.8 in strict mode with
`noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`, Zod for the environment schema,
Vitest with Supertest. Two runtime dependencies only — Express and Zod. The logger is fifty
lines over `console` rather than a dependency, because this service needs neither transports
nor redaction yet, and it is one file to replace when it does.

**Persistence: Kysely, not Prisma.** Hand-written migrations over SQLite, PostgreSQL, MySQL
and MariaDB, with `better-sqlite3`, `pg` and `mysql2` each imported only inside its own
branch. This reverses what the plan named, because Prisma cannot express the partial unique
indexes and `CHECK` constraints the approved data model puts in the database — see
[`../decisions/query-builder-over-orm.md`](../decisions/query-builder-over-orm.md). MongoDB
stays deferred to a separate adapter, and the reasons got stronger: it has neither of those
either.

**Verified:** `npm run check` green — `tsc --noEmit` clean and 97 tests passing across nine
suites, including one case per rule in the data model's *What the schema enforces on its own*
table and thirty covering the identity domain. `npm run build` compiles; the compiled entry point applies migrations on first boot,
applies none on the second, reports the database in `/health/ready`, and exits cleanly on
SIGTERM.

## Next step

Authentication: password credentials, OAuth identities, per-device sessions with rotating
refresh tokens, and scoped API tokens — then the authenticated identity routes, which are
written but not yet mounted because they need a caller.

The full ordered plan is in `MCEngine/plugin-manager` at
`.agents/memory/tasks/mcpluginmanager-platform.md`.
