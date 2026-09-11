---
name: memory-tasks-native-module-build
description: Task record for fixing the image build that node-gyp broke — the confirmed three-task plan, with one entry appended per task as it lands.
---

# Task: Fix the image build

## Goal

`docker build` on `master` fails. The image the previous plan shipped cannot be built, so the
service cannot be deployed.

## Objective

* `docker build` succeeds on `linux/amd64` with no build toolchain in any stage.
* The native module loads from the binary already inside its package, and the build **proves**
  it rather than assuming it.
* The two documents and the decision record that state the wrong reason are corrected, not
  quietly reworded.

## Detail

The failure, verbatim from the deploy log:

```
npm error path /app/node_modules/better-sqlite3
npm error command sh -c node-gyp rebuild
npm error gyp ERR! find Python  Could not find any Python installation to use
```

**npm runs `node-gyp rebuild` on its own** for any package carrying a `binding.gyp` and no
`install` script of its own. `better-sqlite3` is that. The prebuilt binaries were in the package
the whole time, at `prebuilds/`, including the musl ones an earlier record said did not exist.

One repository. `MCEngine/client-reactjs`'s image builds fine and is untouched.

The version does not move.

## Decisions

| Decision | Value |
|---|---|
| Fix | `--ignore-scripts` on both `npm ci` invocations |
| Proof | The deps stage opens an in-memory database, so a broken prebuild path fails the build |
| Rejected | `python3`, `make`, `g++` in the build stages — slower every build, to compile what ships |
| Base image | Unchanged. The musl claim was wrong; Debian slim stays for a smaller reason |
| Earlier record | Corrected in place with the wrong claim quoted, not silently edited |

Recorded in [`../decisions/native-module-install.md`](../decisions/native-module-install.md).

## Tasks

| # | Title | Scope | Repository | Branch | Files / areas | PR |
|---|---|---|---|---|---|---|
| 1 | Task record | This file, its decision, and the index rows | `server-expressjs` | `chore/native-module-build-plan` | `.agents/memory/`, `.agents/index/` | |
| 2 | Stop npm compiling a shipped binary | The flag, the assertion, and the corrections | `server-expressjs` | `fix/native-module-build` | `Dockerfile`, `wiki/environments/deployment.md`, `.agents/memory/decisions/` | |
| 3 | Release | Logs, this table, the record closed | `server-expressjs` | `chore/native-module-build-release` | `wiki/logs/0/0/0/`, `.agents/` | |

## Entries

### Task 1 — chore/native-module-build-plan

Wrote the record and the decision before the fix, because the interesting part is not the flag —
it is why the previous task's verification passed while the image could not build.

**The check that passed was answering a different question.** With no Docker daemon available,
that task verified `npm ci --omit=dev` on the development machine. That machine has `python3`,
`make` and `g++`, so node-gyp compiled the module and the install succeeded. The image has none
of those. The substitute check was not weaker than the real one; it was measuring something
else, and nothing in its output said so.

**An earlier record is corrected rather than quietly edited.** `container-image-shape.md` claimed
`better-sqlite3` publishes glibc prebuilds and no musl ones. The package ships eight binaries and
two of them are `linuxmusl`. The correction quotes the wrong sentence so the record stays
readable as a record.

Next task depends on: nothing beyond this record.
