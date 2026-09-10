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
| `test/` | Vitest suites, plus `helpers.ts` for building an app per suite. |
| `.env.example` | Copyable template; every key is in `wiki/environments/env.md`. |

## What is deliberately absent

**There is no database and there are no domain routes.** No schema, no migrations, no ORM, no
accounts, no products, no fleet. `/health` and `/health/ready` are the only routes that
exist, and `createHealthRouter` is passed an empty list of probes because there is nothing
yet to probe.

No Dockerfile and no CI workflow either; neither has been asked for.

That is not an oversight. The runtime is one task of a twenty-task plan and the persistence
layer is the next one. The plan table lives in `MCEngine/plugin-manager` at
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
