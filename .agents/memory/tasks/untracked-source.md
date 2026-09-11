---
name: memory-tasks-untracked-source
description: Task record for a source file that was never committed because an ignore pattern over-matched — the three-task plan, with one entry appended per task.
---

# Task: A source file the repository did not have

## Goal

`docker build` fails on `master`, six imports deep:

```
src/app.ts(13,30): error TS2307: Cannot find module './storage/index.js'
```

The module is not missing from the image. It is missing from the **repository**.

## Objective

* `src/storage/index.ts` is tracked, and a clean clone typechecks.
* The ignore pattern that swallowed it is anchored, in `.gitignore` and `.dockerignore`.
* An over-matching pattern cannot do this silently again: `npm run check` fails if anything
  under `src/` is git-ignored.
* No behaviour change. The file's contents are what every local run has been using all along.

## Detail

`.gitignore` carried `storage/` for the directory the disk driver writes artifact bytes into. A
pattern with no leading slash matches at **every depth**, so it also matched `src/storage/` —
the module implementing that driver. `git add -A` never staged it and `git status` never
mentioned it.

One repository. `MCEngine/client-reactjs` was checked for the same class of fault and has none:
nothing under its `src/` or `test/` is ignored.

The version does not move, and the file's contents are unchanged — this commits what was
already there.

## Decisions

| Decision | Value |
|---|---|
| The file | Committed as-is. It is what 253 passing tests have been running against |
| `.gitignore` | `/storage/`, `/dist/`, `/coverage/` anchored; `node_modules/` left unanchored on purpose |
| `.dockerignore` | Anchored the same way, so the pattern says what it means whichever tool reads it |
| The guard | A test asserting nothing under `src/` is ignored, inside `npm run check` |
| Proving the guard | Run against the broken tree **first**, and seen to fail |

Recorded in [`../decisions/gitignore-anchoring.md`](../decisions/gitignore-anchoring.md).

## Tasks

| # | Title | Scope | Repository | Branch | Files / areas | PR |
|---|---|---|---|---|---|---|
| 1 | Task record | This file, its decision, and the index rows | `server-expressjs` | `chore/untracked-source-plan` | `.agents/memory/`, `.agents/index/` | |
| 2 | Track the storage driver, and stop this recurring | The file, the patterns, the guard | `server-expressjs` | `fix/untracked-source` | `src/storage/`, `.gitignore`, `.dockerignore`, `test/` | |
| 3 | Release | Logs, this table, the record closed | `server-expressjs` | `chore/untracked-source-release` | `wiki/logs/0/0/0/`, `.agents/` | |

## Entries

### Task 1 — chore/untracked-source-plan

Wrote the record first, because the file is a one-line fix and the interesting part is that
**this is the second time in two tasks that a check passed for a reason that did not exist in
the target environment.**

The node-gyp failure was a development machine with a compiler the image lacked. This one is a
development machine with a *file* the repository lacked. In both cases every local check was
green, and in both cases the output gave no hint — a green `npm run check` says nothing about
whether the files it ran on are in git.

So the fix is not just committing the file. It is asserting the invariant that would have caught
it — nothing under `src/` may be ignored — inside the gate that runs on every change. And that
assertion gets run against the broken tree first, because a regression test that has never
failed is a regression test nobody has checked.

Next task depends on: nothing beyond this record.
