# Changelog — 0.0.0

**2026-09-11** — the central server behind MCPluginManager: accounts and organizations over
one handle namespace, scoped tokens, a product catalogue that validates every jar it accepts,
a fleet control plane, two audit trails, and an external source resolver.

Pre-release. This version covers the repository from its initial commit up to the first
release. Nothing has shipped; `0.0.0` has not moved and the first version that ships is the
one that asks.

## Added

- `AGENTS.md`, `.claude/CLAUDE.md`, and the `.agents/` tree — six indexes, the repository
  rules hub, the agent repository map, and the memory tree. The repository consumes the
  shared instruction set over the `lxagents-agents-base` connector as a Mode B consumer and
  declares no overrides.
- `wiki/information/overview.md` — what this service is, the three repositories it sits
  between, and the surfaces it will expose.
- This changelog, and the version-directory log structure it sits in.
- `wiki/information/data-model.md` — every table, column and constraint, the rules the schema
  carries itself rather than delegating to a handler, and what stays portable across SQLite,
  PostgreSQL, MySQL and MariaDB.
- `wiki/information/api-contract.md` — every route, the three authentication schemes, the
  error envelope, the nine ordered checks an upload must pass, and the single payload the
  plugin polls for.
- The Express runtime: `package.json` at `0.0.0`, strict TypeScript, Vitest with Supertest,
  and two runtime dependencies — Express and Zod.
- `src/config.ts` — every environment variable, validated once at startup, frozen, and taken
  as an argument so a test never mutates `process.env`.
- `src/errors.ts` and `src/http/errorHandler.ts` — the one error envelope the contract
  promises, with a deliberate `ApiError` rendered in full and anything else reduced to a bare
  `internal_error`.
- `src/http/requestContext.ts` — a request id per request, honouring a sanitized inbound one.
- `src/lib/logger.ts` — a JSON-line logger with no dependency.
- `src/routes/health.ts` — liveness that checks nothing and readiness that checks everything.
- `wiki/environments/setup.md` and `wiki/environments/env.md`.
- `src/db/` — the typed schema for all twenty-one tables, the four dialects' differences in
  one table, the connection factory with per-provider lazy driver imports, the migration
  runner, and the initial migration.
- `src/lib/ids.ts` — ULIDs, so identifiers sort by time and cannot be enumerated.
- `src/lib/version.ts` — `normalizeVersion` and `compareVersions`, so `1.10.0` is newer than
  `1.9.0` rather than older.
- Sixteen constraint tests, one per rule the data model says the schema carries itself.
- `src/modules/identity/` — accounts and organizations over one handle namespace, the
  thirty-day handle cooldown with its released-handle history, multiple email addresses with
  exactly one primary, org membership and roles, and free-tier org settings.
- `src/lib/clock.ts`, so a cooldown boundary is testable without sleeping.
- `GET /api/v1/accounts/:handle`, the one identity route that needs no caller.
- `src/modules/auth/` — scrypt password hashing from `node:crypto`, OAuth identities,
  per-device sessions with rotating refresh tokens where reuse signs out everywhere, scoped
  API tokens returned exactly once, and the `requireSession` and `requireScope` guards.
- The authenticated identity routes: `/me`, emails, profile and handle changes, and the
  organization member, transfer and settings routes.
- `src/http/params.ts`, because Express 5 types a route parameter as `string | string[]`.
- Zod rejections rendered as the documented `validation_failed` envelope, translated once in
  the error handler rather than per route.
- `src/modules/product/` — the catalogue: products owned by organizations, versions ordered
  by their normalized form, and publishing from the panel or from CI through the same nine
  ordered checks.
- `src/lib/zip.ts` — a central-directory reader that never decompresses, so a zip bomb is
  refused on its declared sizes rather than discovered by extracting it.
- `src/storage/` — generated, sharded storage keys, so no caller-supplied string ever reaches
  a filesystem path.
- `src/http/multipart.ts` — a multipart reader that caps the file while streaming rather than
  after buffering it.
- `wiki/security/artifact-upload.md` — the threat model for accepting and serving jars.
- `src/modules/fleet/` — the control plane: servers identified by a generated key rather than
  their URL, an inventory that is replaced rather than patched, and one `desired` payload
  carrying every action with its checksum and download URL.
- `src/modules/audit/` — two event tables with two readers: what people do, and what servers
  do. A logging failure never fails the request that caused it.
- `src/modules/source/` and `src/lib/net.ts` — mirroring an artifact from SpigotMC, Modrinth,
  Hangar, a GitHub release or a direct URL, fetched by this service rather than by the plugin
  and constrained so a caller cannot use it to reach a private address.
- `wiki/security/external-fetch.md` — the threat model for fetching a URL a caller chose.

- `Dockerfile` and `.dockerignore` — a three-stage image on `node:22-bookworm-slim`, running as
  the base image's unprivileged user, with `/data` as a volume for artifacts and, under SQLite,
  the database. The production dependencies are installed in their own stage rather than copied
  out of the build one, because `better-sqlite3` is a native module and the build tree carries
  devDependencies that must not ship.
- `wiki/environments/deployment.md` — building and running the container, what lives on the
  volume, why the healthcheck calls readiness rather than liveness, and the compose example that
  puts the panel in front.

## Fixed

- **The container image could not be built.** `npm ci` ran `node-gyp rebuild` against
  `better-sqlite3` and died looking for Python. npm does that by itself for any package with a
  `binding.gyp` and no `install` script of its own — and the binary was in the package the whole
  time, at `prebuilds/`. Both `npm ci` invocations now pass `--ignore-scripts`, and the deps
  stage opens an in-memory database so a broken prebuild path fails the build instead of the
  first request.

## Changed

- **Publishing a version moved to `PUT /api/v1/products/:id/versions/:version`**, from
  `POST /api/v1/products/:id/versions` with the version in the body. The product id is
  globally unique, so `(product_id, version)` already addresses a version — and the three
  routes that read, download and delete one already used that shape. A `version` field in the
  body is now refused rather than ignored, so a URL and a body that disagree fail the build
  instead of publishing the wrong one.
- `README.md` rewritten from a bare title into an overview: what the service is, its place
  in the platform, and links into `wiki/`.
