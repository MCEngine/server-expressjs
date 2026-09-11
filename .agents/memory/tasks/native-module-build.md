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
| 1 | Task record | This file, its decision, and the index rows | `server-expressjs` | `chore/native-module-build-plan` | `.agents/memory/`, `.agents/index/` | MCEngine/server-expressjs#18 |
| 2 | Stop npm compiling a shipped binary | The flag, the assertion, and the corrections | `server-expressjs` | `fix/native-module-build` | `Dockerfile`, `wiki/environments/deployment.md`, `.agents/memory/decisions/` | MCEngine/server-expressjs#19 |
| 3 | Release | Logs, this table, the record closed | `server-expressjs` | `chore/native-module-build-release` | `wiki/logs/0/0/0/`, `.agents/` | MCEngine/server-expressjs#20 |

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

### Task 2 — fix/native-module-build

`--ignore-scripts` on both `npm ci` invocations, plus one line in the deps stage that proves the
native addon loads before the build may continue.

**The flag is the fix, and it is not about prebuild downloads.** `better-sqlite3` needs no
download: its binaries are inside the published tarball at `prebuilds/`. npm compiled anyway,
because it runs `node-gyp rebuild` on its own for any package with a `binding.gyp` and no
`install` script — an implicit default no flag about binaries turns off. `--ignore-scripts` is
what stops it.

**The assertion matters more than the flag.** Without
`node -e "new (require('better-sqlite3'))(':memory:').close()"`, a change that breaks the
prebuild path yields an image that builds cleanly and fails on its first request. With it, the
build fails at the line responsible.

**Two documents stated the wrong reason and are corrected, not reworded.**
`container-image-shape.md` keeps its original sentence as a block quote above the correction, so
it still reads as a record of what was believed; `wiki/environments/deployment.md` gains the
real mechanism and names the case to watch — `--ignore-scripts` is per-install, not per-package,
so a dependency that genuinely needs a `postinstall` would be skipped silently.

**The base image did not change**, and the reason for keeping it did. Not musl — musl prebuilds
exist. `node:22-bookworm-slim` stays because glibc is what the `linux-x64` prebuild targets and
what Node's official image defaults to.

Verified, still without a Docker daemon, but this time against the thing that actually failed:

* The deps stage command run **verbatim**, in a tree holding only `package.json`, the lockfile
  and `dist/`: exits `0`, leaves no `build/` directory, and the in-memory database opens.
* The service booted from that tree and answered `/health/ready` with the database check passing.
* The build stage's `npm ci --ignore-scripts` installs the full dev tree — all twenty `@types`
  packages — and `tsc` compiles. `esbuild`, the one devDependency with a `postinstall`, still
  loads and reports its version, which is the risk `--ignore-scripts` carries being measured
  rather than assumed.
* The repository's own `node_modules` has no `build/Release` either, and 253 tests pass against
  SQLite through it. The prebuilt binary has been what this project runs on all along.

**A harness slip while checking this is worth recording.** One run of the build-stage check
installed only 103 packages and failed with missing `@types`, which looked like `--ignore-scripts`
breaking the install. It was `NODE_ENV=production` left exported from an earlier command in the
same shell, which makes npm omit devDependencies. Re-run with `env -u NODE_ENV`, it installs the
full tree and compiles. The flag was never the problem.

Next task depends on: nothing. The release closes the record.

### Task 3 — chore/native-module-build-release

Filled the `PR` column, wrote this entry, and brought `repository-state.md` current.

**The version did not move.** `0.0.0`, and `wiki/logs/0/0/0/` already existed. The changelog
entry went under `Fixed`, which is where a build that could not run belongs.

**What this plan is really a record of.** Not a flag — a verification that answered the wrong
question. The previous plan said plainly that no Docker daemon was available and that each task
would verify what its image wrapped instead. It did, and the substitute check passed, because
the development machine has a compiler and the image does not. Saying "I could not build it" was
necessary and was not sufficient: what was missing was asking what the real environment lacks
that this one has.

Next task depends on: nothing. This closes the record.

## Status

**Done.** All three tasks landed; the table above carries the pull request each merged through.
