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
`wiki/security/artifact-upload.md`. **All four version routes address a version by path**,
publishing included — `PUT /products/:id/versions/:version`, which refuses a `version` in the
body rather than ignoring it. See
[`../decisions/version-addressed-by-path.md`](../decisions/version-addressed-by-path.md).

Plus the fleet: `src/modules/fleet/` (repository, service, routes).

Plus the event logs: `src/modules/audit/`, wired into the identity, auth, product and fleet
routes.

Plus the external source resolver: `src/modules/source/`, `src/lib/net.ts` and
`wiki/security/external-fetch.md`.

**Ships as a container.** `Dockerfile` builds in three stages — compile, install the production
dependency set on the same base image, then a runtime carrying neither — on
`node:22-bookworm-slim`, running as the base image's unprivileged user with `/data` as the one
writable path. **Every `npm ci` passes `--ignore-scripts`**, without which npm compiles
`better-sqlite3` from source and the build dies looking for Python; the binary ships inside the
package, and the deps stage opens an in-memory database to prove it loaded. See
[`../decisions/native-module-install.md`](../decisions/native-module-install.md).
`wiki/environments/deployment.md` has the rest, including why the healthcheck calls readiness
and not liveness.

**Does not exist:** rate limiting and artifact signing, both named under `Open` in
`wiki/security/artifact-upload.md`; redirect re-validation and a DNS-pinning fetch agent,
both named under `Open` in `wiki/security/external-fetch.md`. No OAuth provider redirect. No CI
workflow.

**The server is otherwise feature-complete against `wiki/information/api-contract.md`.** No
OAuth provider is wired — `linkIdentity` and `signInWithIdentity` work and are tested, but no
route performs a provider redirect. No rate limiting, though the contract specifies the limits.
No CI workflow.

## Verifying anything here

Two rules, both paid for.

**1. Name what the target environment has that this one does not, and check there.** The
development machine had a C compiler the image lacked, then a file the repository lacked. Both
checks were honest about what they ran and silent about where.

**2. Run the defaults.** The third failure was the opposite shape: the target had *fewer* things,
not more. Every boot check written by hand exported `DATABASE_URL`, so none of them ever
exercised the value the image actually ships with — which pointed at a directory the runtime
user cannot write. A check that configures the thing it is checking has tested the
configuration, not the artifact.

Three guards now run inside `npm run check`, none needing a daemon: nothing under `src/` may be
git-ignored; every path the image's runtime stage defaults to must be absolute and under its
declared `VOLUME`; and every directory the configuration requires is checked for writability
before the first connection. See
[`../decisions/gitignore-anchoring.md`](../decisions/gitignore-anchoring.md),
[`../decisions/native-module-install.md`](../decisions/native-module-install.md) and
[`../decisions/writable-paths.md`](../decisions/writable-paths.md).

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

**Verified:** `npm run check` green — `tsc --noEmit` clean and 260 tests passing across eighteen
suites, including one case per rule in the data model's *What the schema enforces on its own*
table and thirty covering the identity domain. `npm run build` compiles; the compiled entry point applies migrations on first boot,
applies none on the second, reports the database in `/health/ready`, and exits cleanly on
SIGTERM.

## Next step

**Six plans are finished and all six records are closed.** The twenty-task platform plan
(`../tasks/mcpluginmanager-platform.md`, whose table is in `MCEngine/plugin-manager`), the
version-route plan (`../tasks/version-route.md`, whose table is here), which moved publishing
to `PUT /api/v1/products/:id/versions/:version`, the container-image plan
(`../tasks/container-image.md`, also here), `../tasks/native-module-build.md`, which fixed
the image build that plan shipped broken, `../tasks/untracked-source.md`, which committed a
source file an ignore pattern had kept out of the repository, and `../tasks/writable-data.md`,
which stopped the image defaulting its database onto a read-only path. Follow-up work opens a
new record rather than appending to any of them.

The candidates, in the order they matter: rate limiting, which the contract already specifies
and nothing enforces; artifact signing, which is the difference between "these bytes survived
the wire" and "this org published them" and needs `MCEngine/plugin-manager` to carry the
public key; an OAuth provider redirect, since linking and signing in already work beneath it;
and a CI workflow that builds and pushes the image the Dockerfile now
defines. A first shipping version is a version claim and therefore asks first.
