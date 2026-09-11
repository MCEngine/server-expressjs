---
name: memory-decisions-writable-paths
description: Why the image defaults every writable path onto the declared volume, why startup fails loudly when one is not writable, and the guard that keeps the two in step.
---

# Writable paths in the image

The image built and pushed, then crash-looped:

```
SqliteError: unable to open database file
    at createDialect (file:///app/dist/db/dialect.js:17:30)
  code: 'SQLITE_CANTOPEN'
```

## The cause

Three facts, each fine alone:

1. `src/config.ts` defaults `DATABASE_URL` to `file:./dev.sqlite` — **relative**, so it resolves
   against the process working directory.
2. The `Dockerfile` sets `WORKDIR /app`, which Docker creates **owned by root**, and the runtime
   runs as the unprivileged `node` user. Only `/data` is chowned.
3. The `Dockerfile` set `STORAGE_DIR=/data/storage` but **left `DATABASE_URL` alone**.

So the service tried to create `/app/dev.sqlite` as a user with no write permission there.

**That third fact is the defect.** Setting one writable path in the image and not the other left
a default pointing at a directory the image deliberately does not let the service write to. The
deployment page had said all along to point `DATABASE_URL` inside the volume; the image just did
not do it.

## The fix

`DATABASE_URL=file:/data/app.sqlite` joins `STORAGE_DIR=/data/storage` in the runtime stage.
Both now sit under the declared `VOLUME ["/data"]`, which is the only path the image makes
writable.

## Why startup now refuses rather than throwing SQLITE_CANTOPEN

`SQLITE_CANTOPEN` names neither the path nor the reason, and the reason is almost always
ownership. `src/lib/writable.ts` checks every directory the service must write to **before** the
first connection, and fails with the path and the likely cause.

This matters most where the volume is real. A platform that mounts a disk at `/data` may mount
it owned by root, and the image runs as uid 1000 — the same crash, for a completely different
reason, with the same unhelpful message. Now it says which directory and why.

The check creates the directory if it is missing, because that is the ordinary case on a fresh
volume and failing on it would be pedantry.

## The guard

The two facts that must agree — what the image declares as its volume, and where its defaults
point — are asserted against each other in `test/image.test.ts`: **every filesystem path the
runtime stage defaults to must live under the declared `VOLUME`.**

That is the invariant that was broken. A guard on it is cheap and deterministic: it parses the
`Dockerfile`, and it needs no daemon, which is what makes it runnable in the gate that runs on
every change.

## The pattern this is the third instance of

A check passed locally for a reason that did not exist in the target environment:

| | This machine had | The target did not |
|---|---|---|
| node-gyp | a C compiler | the image has none |
| the untracked file | the file on disk | the repository lacked it |
| this one | `DATABASE_URL` **passed by hand in every test** | the image sets no such value |

Every local boot in the two previous tasks exported `DATABASE_URL` explicitly. Not one of them
ran the image's own defaults, so not one of them could have caught this.

**Booting with the defaults is now part of what "verified" means here** — see
`.agents/memory/state/repository-state.md`.
