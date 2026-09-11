---
name: memory-tasks-writable-data
description: Task record for the image defaulting its database onto a read-only path — the three-task plan, with one entry appended per task.
---

# Task: The image's database default pointed at a read-only directory

## Goal

The image builds and pushes, then crash-loops on boot with `SQLITE_CANTOPEN`.

## Objective

* The image's defaults start a working service with only `JWT_SECRET` supplied.
* Every writable path the image defaults to lives under the volume it declares.
* A directory that is not writable fails startup with the path and the likely cause, not with
  `SQLITE_CANTOPEN`.
* A guard keeps the declared volume and the defaults in step.

## Detail

`DATABASE_URL` defaults to `file:./dev.sqlite`, relative to `WORKDIR /app` — created by Docker
as root, while the runtime runs as `node`. The image set `STORAGE_DIR=/data/storage` and left
`DATABASE_URL` at the source default, so one writable path landed on the volume and the other
did not.

One repository. The version does not move.

## Decisions

| Decision | Value |
|---|---|
| The default | `DATABASE_URL=file:/data/app.sqlite`, beside `STORAGE_DIR` on the volume |
| Preflight | Every directory the service must write to is checked before the first connection |
| A missing directory | Created, not refused — that is the ordinary case on a fresh volume |
| The guard | `test/image.test.ts` parses the `Dockerfile` and asserts every defaulted path is under `VOLUME` |
| `src/config.ts` | **Unchanged.** `file:./dev.sqlite` is the right default for `npm run dev` |

Recorded in [`../decisions/writable-paths.md`](../decisions/writable-paths.md).

## Tasks

| # | Title | Scope | Repository | Branch | Files / areas | PR |
|---|---|---|---|---|---|---|
| 1 | Task record | This file, its decision, and the index rows | `server-expressjs` | `chore/writable-data-plan` | `.agents/memory/`, `.agents/index/` | |
| 2 | Default the database onto the volume | The env, the preflight, the guard, the docs | `server-expressjs` | `fix/writable-data-dir` | `Dockerfile`, `src/lib/`, `src/index.ts`, `test/`, `wiki/environments/` | |
| 3 | Release | Logs, this table, the record closed | `server-expressjs` | `chore/writable-data-release` | `wiki/logs/0/0/0/`, `.agents/` | |

## Entries

### Task 1 — chore/writable-data-plan

**This is the third consecutive task where a check passed locally for a reason that did not
exist in the target environment**, and the first two were supposed to have taught it:

| | This machine had | The target did not |
|---|---|---|
| node-gyp | a C compiler | the image has none |
| the untracked file | the file on disk | the repository lacked it |
| this one | `DATABASE_URL` passed by hand | the image sets no such value |

Every boot check written in the previous two tasks exported `DATABASE_URL` explicitly, because
that is what a person does when starting a service by hand. Not one of them ran the image's own
defaults, so not one of them could have caught this — the previous task's own closing entry said
"name what the target environment has that this one does not", and the answer here was a value
my own commands supplied and the image did not.

So the guard is not only the preflight. It is that **the defaults themselves are now a tested
surface**: the `Dockerfile`'s declared volume and its defaulted paths are asserted against each
other, with no daemon required.

Next task depends on: nothing beyond this record.
