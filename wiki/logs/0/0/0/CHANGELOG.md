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

- **The image crash-looped on boot with `SQLITE_CANTOPEN`.** `DATABASE_URL` was left at the
  source default `file:./dev.sqlite` — relative, so it resolved against `/app`, which Docker
  creates as root while the image runs unprivileged. The runtime stage now defaults it to
  `file:/data/app.sqlite`, beside `STORAGE_DIR` on the declared volume, and startup checks every
  directory it must write to before opening anything — failing with the path and the likely
  cause instead of a driver error that names neither.

- **`src/storage/index.ts` was never committed, so the repository did not typecheck from a clean
  clone.** A `.gitignore` pattern written for the directory the disk driver writes into —
  `storage/`, with no leading slash — matches at every depth, and silently also matched the
  module implementing that driver. The file is now tracked, the patterns that name a single
  root directory are anchored, and `npm run check` fails if anything under `src/` is ever
  git-ignored again.

- **The container image could not be built.** `npm ci` ran `node-gyp rebuild` against
  `better-sqlite3` and died looking for Python. npm does that by itself for any package with a
  `binding.gyp` and no `install` script of its own — and the binary was in the package the whole
  time, at `prebuilds/`. Both `npm ci` invocations now pass `--ignore-scripts`, and the deps
  stage opens an in-memory database so a broken prebuild path fails the build instead of the
  first request.

- `GET /api/v1/meta` — public, and an optional **demo account**. With `DEMO_ACCOUNT_ENABLED` on,
  the server seeds a real account through the same `register` path a person uses and advertises
  its credentials here, so an evaluation needs no registration. Off by default; registering and
  signing in are unaffected. What enabling it costs is in `wiki/environments/env.md`.

## Changed

- **Publishing a version moved to `PUT /api/v1/products/:id/versions/:version`**, from
  `POST /api/v1/products/:id/versions` with the version in the body. The product id is
  globally unique, so `(product_id, version)` already addresses a version — and the three
  routes that read, download and delete one already used that shape. A `version` field in the
  body is now refused rather than ignored, so a URL and a body that disagree fail the build
  instead of publishing the wrong one.
- `README.md` rewritten from a bare title into an overview: what the service is, its place
  in the platform, and links into `wiki/`.
- **`PANEL_ORIGIN` is documented as what it is: validated at startup and read by nothing.**
  `wiki/environments/deployment.md` had claimed it "is what the service allows cross-origin
  requests from" — this service has no CORS layer at all, and its refresh cookie is
  `SameSite=Lax` in code, so a panel on another origin fails at the preflight and then has no
  cookie to refresh with. A deployment followed that sentence into an outage. Both pages now
  say so, the variable is out of the `docker run` and compose examples, and the field's comment
  says it is reserved for a redirect this service does not yet issue. Nothing changed about how
  the service behaves.
- **`wiki/environments/deployment.md` says what a host that builds the image needs**: the four
  settings that decide whether a hosted deployment works — `JWT_SECRET`, a disk mounted at
  `/data`, `PORT`, and `DEMO_ACCOUNT_ENABLED` — plus Render's own rules about port `10000` and
  about a free web service being unable to receive private network traffic. Nothing about the
  service changed; a deployment showing no demo account is the flag being off, which the page
  now says where it will be read.
- **`POST /tokens` checks who a token may belong to.** It took `ownerAccountId` from the request
  body and wrote it unchecked, and a token authenticates **as its owner** — so any signed-in
  person could mint a credential that acts as somebody else, their organizations and their right
  to publish included. Account ids are public (`GET /accounts/:handle` needs none), so nothing
  had to be guessed. The owner is now checked against the rule the identity routes already use —
  your own account, or an organization you administer — which lives in
  `src/modules/identity/authorize.ts` so both routers ask one question.
- `GET`, `POST` and `DELETE` `/orgs/:handle/tokens` — **tokens an organization owns**, listed,
  minted and revoked by an `admin`. A token an org owns acts for that org at `owner`, which is
  what makes it usable for CI that outlives the person who set it up; `requireRole` gained that
  one branch, restricted to accounts that are organizations. It administers nothing: every route
  that governs an org needs a signed-in user and refuses a token with `session_required`.
- `GET /me/orgs` — the organizations the caller belongs to, with the role held. The repository
  query existed already and no route exposed it, which is why an organization was reachable only
  by knowing its handle.
- **A token says who minted it.** Every token payload now carries `created_by` — id, handle and
  display name — and an organization's `token.created` and `token.revoked` events are filed
  against the organization, so `GET /orgs/:handle/audit` shows them. The column existed and was
  never selected, and the events were filed against the token while that route reads
  `subject_type = 'org'`: the provenance of an org-owned credential was recorded and reached
  nobody. It matters for exactly those tokens, because the token acts as the organization and the
  row is the only thing that still says which admin made it.

