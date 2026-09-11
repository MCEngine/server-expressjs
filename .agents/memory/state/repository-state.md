---
name: memory-state-repository-state
description: What this repository contains right now, what it does not yet, and the next obvious step.
---

# Repository state

Overwritten in place, always current.

## As of the 0.0.0 pre-release

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

Plus authentication: `src/modules/auth/` (scrypt passwords, OAuth identities, per-device
sessions with rotating refresh tokens, scoped API tokens, and the guards) and
`src/http/params.ts`.

Plus the catalogue: `src/modules/product/` (repository, service, validation, routes, and the
jar inspector), `src/lib/zip.ts`, `src/storage/`, `src/http/multipart.ts`, and
`wiki/security/artifact-upload.md`.

Plus the fleet: `src/modules/fleet/` (repository, service, routes).

Plus the event logs: `src/modules/audit/`, wired into the identity, auth, product and fleet
routes.

Plus the external source resolver: `src/modules/source/`, `src/lib/net.ts` and
`wiki/security/external-fetch.md`.

**Does not exist:** rate limiting and artifact signing, both named under `Open` in
`wiki/security/artifact-upload.md`; redirect re-validation and a DNS-pinning fetch agent,
both named under `Open` in `wiki/security/external-fetch.md`. No OAuth provider redirect. No
Dockerfile and no CI workflow.

**The server is otherwise feature-complete against `wiki/information/api-contract.md`.** No OAuth provider is wired — `linkIdentity` and
`signInWithIdentity` work and are tested, but no route performs a provider redirect. No rate
limiting, though the contract specifies the limits. No Dockerfile and no CI workflow.

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

**Verified:** `npm run check` green — `tsc --noEmit` clean and 249 tests passing across fifteen
suites, including one case per rule in the data model's *What the schema enforces on its own*
table and thirty covering the identity domain. `npm run build` compiles; the compiled entry point applies migrations on first boot,
applies none on the second, reports the database in `/health/ready`, and exits cleanly on
SIGTERM.

## Next step

**The twenty-task plan is finished and its record is closed.** Follow-up work opens a new
record rather than appending to `../tasks/mcpluginmanager-platform.md`, which stays as the
account of how this repository got here. The plan table itself is in
`MCEngine/plugin-manager` at `.agents/memory/tasks/mcpluginmanager-platform.md`.

The candidates, in the order they matter: rate limiting, which the contract already specifies
and nothing enforces; artifact signing, which is the difference between "these bytes survived
the wire" and "this org published them" and needs `MCEngine/plugin-manager` to carry the
public key; an OAuth provider redirect, since linking and signing in already work beneath it;
and a Dockerfile with a CI workflow. A first shipping version is a version claim and
therefore asks first.
