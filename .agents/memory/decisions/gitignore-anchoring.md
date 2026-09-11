---
name: memory-decisions-gitignore-anchoring
description: Why ignore patterns naming a root artifact are anchored with a leading slash, and the guard that fails the suite if a source file is ever ignored again.
---

# Anchoring ignore patterns

`src/storage/index.ts` was **never committed**. `master` did not typecheck from a clean clone,
and had not since the catalogue task added the file.

## The cause, in one line

```gitignore
storage/
```

A `.gitignore` pattern containing no slash other than a trailing one matches **at every depth**,
not just at the root. It was written for the directory the disk driver writes artifact bytes
into — `./storage` — and it silently also matched `src/storage/`, the module that *implements*
that driver.

`git add -A` never staged the file. `git status` never mentioned it. Nothing was wrong on any
machine that had already created it.

## Why nothing caught it for so long

Every check that could have caught it ran where the file existed:

* `npm run check` — green, 253 tests, against the file on disk.
* `npm run build` — produced `dist/`, from the file on disk.
* The container image work — verified `npm ci` and a real boot, from the file on disk.

The first environment that did not already have the file was a `git clone` inside a Docker
build, which is where it failed.

**This is the same failure as the node-gyp one, a second time.** There, the development machine
had a compiler the image did not. Here, it had a file the repository did not. Both times the
check passed for a reason that did not exist in the target environment, and both times the
output said nothing about it.

## The rule

**A pattern that names a single artifact at the repository root is anchored with a leading
slash.** `/storage/`, `/dist/`, `/coverage/` — each of those describes one known directory, and
anchoring says so.

`node_modules/` stays unanchored deliberately: it legitimately appears at any depth, which is
the case the unanchored form is actually for.

The same applies to `.dockerignore`, which is anchored for the same reason even though its
matcher does not recurse the way git's does — the pattern should say what it means regardless
of which tool reads it.

## The guard

An ignore rule cannot be trusted to stay narrow, so the invariant is asserted instead:

> **Nothing under `src/` may be git-ignored.**

`test/repository.test.ts` runs `git ls-files --others --ignored --exclude-standard -- src` and
fails if it returns anything. It runs inside `npm run check`, which is the gate, so the next
pattern that over-matches fails a test rather than a deploy weeks later.

It was written against the broken tree first and observed to fail, then the tree was fixed and
it passed. A regression test that has never failed is a regression test nobody has checked.
