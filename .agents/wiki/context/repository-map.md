---
name: agent-wiki-context-repository-map
description: Orientation for agents — what currently lives in this repository, what is planned, and where each kind of file belongs.
---

# Repository map

Orientation before touching anything. For what this service *is*, read
[`wiki/information/overview.md`](../../../wiki/information/overview.md) — the facts live
there once, and this page links rather than repeats them.

## What exists right now

| Path | What it is |
|---|---|
| `AGENTS.md` | Entry point: shared set resolution, the tool declaration block, reading order. |
| `.claude/CLAUDE.md` | A single import of `../AGENTS.md`, so Claude Code and every other agent read the same instructions. Never paste content into it. |
| `.agents/index/` | Every index. Six files, flat, named `{scope}-index.md`. |
| `.agents/rules/repository.md` | This repository's own rules hub. |
| `.agents/wiki/context/` | This page. |
| `.agents/memory/` | Current state and this repository's entries in the platform task record. |
| `wiki/` | Human documentation, plus `wiki/logs/` for version history. |
| `README.md`, `LICENSE` | Overview and the MIT license. |
| `package.json` | `@mcengine/server-expressjs` at `0.0.0`. The version carrier. |
| `tsconfig.json`, `tsconfig.build.json` | Strict TypeScript. The build config excludes tests. |
| `vitest.config.ts` | Suites are `test/**/*.test.ts`. |
| `src/config.ts` | The environment schema. Nothing else reads `process.env`. |
| `src/errors.ts` | `ApiError` and one constructor per status the contract defines. |
| `src/app.ts` | Builds the app from its dependencies. Never listens. |
| `src/index.ts` | Loads config, listens, and shuts down gracefully on SIGTERM. |
| `src/http/` | The request id middleware and the error handler. |
| `src/routes/health.ts` | Liveness and readiness. |
| `src/lib/logger.ts` | JSON-line logger over `console`, no dependency. |
| `src/lib/ids.ts` | ULID generation, and the base64url secret used for tokens. |
| `src/lib/version.ts` | `normalizeVersion` and `compareVersions` — why `1.10.0` beats `1.9.0`. |
| `src/db/schema.ts` | The typed shape of every table. **Hand-written**; nothing generates it. |
| `src/db/types.ts` | The four dialects' column types, and which support a partial index. |
| `src/db/dialect.ts` | Builds the Kysely instance. Each driver is imported inside its branch. |
| `src/db/plugins.ts` | Normalizes driver results; rewrites booleans for SQLite. |
| `src/db/migrator.ts` | The migration list, as a literal. |
| `src/db/migrations/` | One file per migration. Never edited after shipping. |
| `src/lib/clock.ts` | Injected time, so a cooldown boundary is testable. |
| `src/modules/identity/` | Accounts, profiles, handles, emails, orgs, membership, settings. |
| `src/modules/auth/` | scrypt passwords, OAuth identities, per-device sessions, scoped API tokens, and the guards. |
| `src/modules/product/` | The catalogue, and `jar.ts` — the nine ordered upload checks. |
| `src/lib/zip.ts` | Reads a central directory. **Never decompresses.** |
| `src/storage/` | Generated storage keys and the disk and memory drivers. |
| `src/http/multipart.ts` | One-file multipart, capped while streaming. |
| `src/modules/fleet/` | Registered servers, their inventory, and the desired-state payload. |
| `src/modules/audit/` | Two event tables, written from the route layer. |
| `src/modules/source/` | Mirroring an artifact from an external site. |
| `src/lib/net.ts` | The private-range check that keeps `/sources/resolve` from being SSRF. |
| `src/http/params.ts` | Reads one route parameter as a string. Express 5 types them as `string \| string[]`. |
| `test/` | Vitest suites, plus `helpers.ts` for building an app per suite. |
| `.env.example` | Copyable template; every key is in `wiki/environments/env.md`. |

## What is deliberately absent

**The server implements the whole contract.** What is missing is named under `Open` in the
two security pages: rate limiting, artifact signing, redirect re-validation, and a DNS-pinning
fetch agent. No OAuth provider redirect is wired either, and there is no Dockerfile and no CI
workflow — neither was asked for.

Identity, authentication, the catalogue and the fleet are complete: register, sign in,
publish a versioned jar, register a server, report an inventory, set a desired version, and
poll for the actions that close the gap.

No rate limiting, though the contract specifies the limits, and no artifact signing — both
are named in `wiki/security/artifact-upload.md` under `Open`. The disk storage driver is
single-instance. No OAuth provider is actually wired — `linkIdentity` and `signInWithIdentity` exist and are
tested, but no route performs a provider redirect. No rate limiting yet, though the contract
specifies the limits. No Dockerfile and no CI workflow; neither was asked for.

No storage driver either — `product_files.storage_key` is specified but nothing writes bytes
yet. No Dockerfile and no CI workflow; neither has been asked for.

That is not an oversight. The persistence layer is one task of a twenty-task plan and the
identity module is the next one. The plan table lives in `MCEngine/plugin-manager` at
`.agents/memory/tasks/mcpluginmanager-platform.md`, and this repository's own entries are in
[`../../memory/tasks/mcpluginmanager-platform.md`](../../memory/tasks/mcpluginmanager-platform.md).

**Do not infer the build from this page** — it is updated by each task as that task makes
something true, so anything absent here is genuinely absent from the repository.

## Where a new file goes

| Kind | Path |
|---|---|
| A rule for this repository | `.agents/{folder}/{file}.md` — and a row in the `AGENTS.md` declaration block |
| Documentation a person reads | `wiki/{folder}/{file-name}.md` |
| Procedure or framing only an agent needs | `.agents/wiki/{type}/{file-name}.md` |
| Task state, a decision, current state | `.agents/memory/{type}/{file-name}.md` |
| A record of what changed | `wiki/logs/{Major}/{Minor}/{Patch}/CHANGELOG.md` — and creating the directory is gated |
| An index | `.agents/index/{scope}-index.md` |

Never an `INDEX.md`. Never a third documentation tree. The authority is
`{shared}/rules/directories.md`.

## Gotchas

* **`.claude/CLAUDE.md` imports `../AGENTS.md`, not `@AGENTS.md`.** The import path resolves
  relative to that file, so `@AGENTS.md` would point at `.claude/AGENTS.md`, which does not
  exist.
* **The trigger table is a declaration, not a mirror.** `AGENTS.md` names the shared tools
  this repository actually uses. A convention with no row does not apply here; adding one
  means adding its row in the same commit.
* **Memory is ungated, instructions are not.** Write `.agents/memory/` freely. Never create
  or edit an instruction file without the user selecting it first.
* **This repository's API is a contract two others depend on.** `MCEngine/plugin-manager`
  and `MCEngine/client-reactjs` both call it. Changing a route or a payload without updating
  the contract documentation in the same commit breaks a consumer silently.
* **Creating a log directory is a version claim** and needs explicit approval. Appending to
  the existing one does not.
* **`createApp()` never listens.** Binding a port is `src/index.ts` alone. A test builds an
  app per suite and drives it in-process, so nothing shares state between files and nothing
  needs a free port.
* **The environment is read once, in `src/config.ts`.** Reaching for `process.env` anywhere
  else defeats the startup validation that makes a missing key a boot failure rather than a
  request-time surprise.
* **A test never mutates `process.env`.** `test/helpers.ts` builds a config from a literal;
  the environment is shared state and it leaks between suite files.
* **`src/db/schema.ts` is hand-written and nothing keeps it in step with the migrations.**
  That is the cost of not using a code generator. `test/db-constraints.test.ts` is what
  catches the drift, and only where it looks.
* **SQLite needs two plugins and the other providers need one.** Its driver refuses to bind
  a boolean and it has no boolean type, so booleans are rewritten to integers going in and
  back on the way out.
* **`PRAGMA foreign_keys` is off by default in SQLite.** `dialect.ts` turns it on. Without
  it every foreign key in the schema is silently decorative, and the constraint suite would
  pass against a database enforcing nothing.
* **Nothing derived from a caller ever reaches a filesystem path.** Storage keys are
  generated. This is not a check to maintain, it is an absence to preserve — adding a code
  path that joins a filename onto a path is the whole vulnerability.
* **`src/lib/zip.ts` never decompresses, and must not start.** Every fact the upload path
  needs is in the central directory; extracting to learn a size is how a zip bomb wins.
* **An audit write never fails a request.** It is a side effect of something that already
  succeeded. Failures go to the logger, not to the caller.
* **Recording happens in routes, not services.** The route is the only layer holding both the
  actor and the subject, and the services stay free of HTTP.
* **`requireSession` and `requireScope` are different guards and both exist for a reason.**
  A person's session satisfies any scope; an API token satisfies only what it was granted,
  and is refused outright where a person is required — otherwise a leaked CI credential could
  mint itself a wider one.
* **An access token being valid is not enough.** Every request re-checks that the session it
  names is still live, because a JWT stays valid for its whole TTL and signing out has to
  mean something sooner than that.
* **A module is repository, service, validation, routes — in that order of dependency.** The
  service holds every rule the database cannot; the repository holds every query and knows no
  rules; the router holds no logic beyond parsing and serializing.
* **The test database is a real file, not `:memory:`.** WAL and foreign-key enforcement are
  what production uses, and an in-memory database differs on both.
