---
name: repository-rules
description: Rules specific to MCEngine/server-expressjs — what it is, what it consumes, its version carrier, and the boundaries that hold once code exists.
---

# Repository-specific rules — server-expressjs

This repository is **`MCEngine/server-expressjs`**, published as
`@mcengine/server-expressjs`: the central server behind MCPluginManager. Read
[`../wiki/context/repository-map.md`](../wiki/context/repository-map.md) for what currently
lives where before making changes.

## Mode and the shared set

This repository is a **Mode B consumer**. The shared instruction set — branching, commits,
pull requests, the task workflow, the creators, the placement and versioning rules — is
served by the **`lxagents-agents-base`** MCP connector and is never copied here. This
repository carries only what is its own: its indexes, this file, its two wiki trees, and its
memory.

## Rules

* **Nothing shared is copied here.** A file readable from `agents://` must not exist in
  `.agents/` unless it is a declared override with a row in
  [`../index/root-index.md`](../index/root-index.md). There are currently no overrides.
* **The package name is `@mcengine/server-expressjs`** and the version carrier is `version`
  in `package.json`. It is `0.0.0` and never moves without explicit user approval —
  `{shared}/rules/versioning.md`.
* **`createApp()` takes its dependencies as arguments and never binds a port.** Listening is
  `src/index.ts` alone. A route that reaches for a module-level singleton cannot be tested
  against a failing dependency, which is the case worth testing.
* **Every environment variable is declared in `src/config.ts`**, and nothing else reads
  `process.env`. Adding a key means adding it there, to `.env.example`, and to
  `wiki/environments/env.md` in the same commit.
* **Every error a route raises is an `ApiError`.** Anything else that escapes is a defect and
  is rendered as a bare `internal_error` with no message, because an unexpected exception's
  message is the kind of thing that carries a query fragment or a path.
* **This repository is one of three.** `MCEngine/plugin-manager` is the Minecraft plugin and
  `MCEngine/client-reactjs` is the web panel; both are clients of this service's HTTP API.
  A change to a route, a payload, or an error shape is a change to a contract two other
  repositories compile against — see `{shared}/rules/change-propagation.md` and update the
  contract documentation in the same commit.
* **Only organizations publish.** An account of type `user` never owns a product. This is a
  domain invariant, not a permission check to be relaxed for convenience.
* **One product page carries exactly one jar.** Enforce it in the schema, not only in a
  handler — a check that lives only in code is a check someone eventually routes around.
* **Never build a filesystem path from user input.** Uploaded filenames are stored as data;
  the path a file is written to is a generated opaque key. This is the whole of the
  path-traversal defence and it has no exceptions.
* **Secrets are stored hashed, never in plaintext.** Passwords with a memory-hard hash,
  tokens and refresh tokens as digests with a separate non-secret prefix for lookup and
  display.
* **Docs and indexes.** Keep both wiki trees current with any structural change, and update
  the index that owns the changed scope in the same commit. See
  `{shared}/creators/index-creator.md`.

## Build and test commands

| Command | Purpose |
|---|---|
| `npm run check` | Typecheck, then the full suite. **This is what "verify" means here.** |
| `npm run typecheck` | `tsc --noEmit` over `src/` and `test/` |
| `npm test` | Vitest, once |
| `npm run build` | Compile `src/` to `dist/` |
| `npm start` | Run the compiled output — what production runs |
| `npm run dev` | Watch mode through `tsx`, no build step |

Full setup notes are in [`../../wiki/environments/setup.md`](../../wiki/environments/setup.md).

**What "verify" means here.** The shared task workflow says to finish and verify each task
before starting the next. In this repository that means `npm run check` passes — both halves,
not just the tests.

## Version carriers in this repository

`{shared}/rules/versioning.md` gates every one of these; this table says where they are.

| Carrier | Where |
|---|---|
| Package version | `package.json` |
| Log directories | `wiki/logs/{Major}/{Minor}/{Patch}/` |
| Git tags and release drafts | GitHub releases |
