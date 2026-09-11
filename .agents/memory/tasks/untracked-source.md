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
| 1 | Task record | This file, its decision, and the index rows | `server-expressjs` | `chore/untracked-source-plan` | `.agents/memory/`, `.agents/index/` | MCEngine/server-expressjs#21 |
| 2 | Track the storage driver, and stop this recurring | The file, the patterns, the guard | `server-expressjs` | `fix/untracked-source` | `src/storage/`, `.gitignore`, `.dockerignore`, `test/` | MCEngine/server-expressjs#22 |
| 3 | Release | Logs, this table, the record closed | `server-expressjs` | `chore/untracked-source-release` | `wiki/logs/0/0/0/`, `.agents/` | MCEngine/server-expressjs#23 |

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

### Task 2 — fix/untracked-source

Committed `src/storage/index.ts`, anchored the patterns that hid it, and added the guard.

**The file is committed as-is.** No line changed: it is what 253 passing tests, every local
build and the running service have been using all along. The repository simply did not have it.

**Three patterns anchored, one deliberately left alone.** `/storage/`, `/dist/` and `/coverage/`
each name one known directory at the repository root, and now say so. `node_modules/` stays
unanchored because it legitimately appears at any depth — which is the case the unanchored form
is actually for. `.dockerignore` got the same treatment, so the pattern means the same thing
whichever tool reads it.

**The guard was written against the broken tree first and watched to fail**, naming
`src/storage/index.ts` in its message, before anything was fixed. A regression test that has
never failed is a regression test nobody has checked.

It asserts one thing — **nothing under `src/` may be git-ignored** — by running
`git ls-files --others --ignored --exclude-standard -- src`. It skips silently where there is no
git work tree, because the invariant is about the repository and there is no repository there to
assert it against.

Verified against the environment that actually failed, not the one that passed:

| Check | Result |
|---|---|
| The guard, **before** the fix | fails, listing `src/storage/index.ts` |
| The guard, after | passes |
| `git check-ignore src/storage/index.ts` | no longer ignored; tracked normally, not force-added |
| `npm run check` | green — **254** tests across sixteen suites |
| A fresh `git clone` of this branch | `npm ci --ignore-scripts` and `npm run build` both succeed |
| `src/storage/` in that clone | present |

The clone is the check that matters. Every check in the previous two tasks ran in a working
directory that already had the file; this one runs where the Docker build runs.

Next task depends on: nothing. The release closes the record.

### Task 3 — chore/untracked-source-release

Filled the `PR` column, wrote this entry, and brought `repository-state.md` current.

**The version did not move**, and neither did a line of the file this task was about.

**The lesson is the deliverable, not the file.** Two consecutive tasks failed the same way: a
check passed on a machine that had something the target environment did not — a compiler, then
a file. Both times the check was honest about *what* it ran and silent about *where*.

The guard added here closes one instance of that. The general form has no test: before calling
something verified, name what the target environment has that this one does not, and check
there. That is now the first thing `repository-state.md` says about verification.

Next task depends on: nothing. This closes the record.

## Status

**Done.** All three tasks landed; the table above carries the pull request each merged through.
