---
name: memory-decisions-native-module-install
description: Why npm ci runs with --ignore-scripts in the image, what it prevents, and the correction to an earlier claim about better-sqlite3 prebuilds.
---

# Installing the native module in the image

`npm ci` in the `Dockerfile` runs with `--ignore-scripts`, and the deps stage asserts the
native binary loads before the build is allowed to continue.

## What went wrong

The first image failed to build:

```
npm error path /app/node_modules/better-sqlite3
npm error command sh -c node-gyp rebuild
npm error gyp ERR! find Python  Could not find any Python installation to use
```

**npm runs `node-gyp rebuild` by itself for any package that has a `binding.gyp` at its root
and declares no `install` or `preinstall` script of its own.** `better-sqlite3` is exactly
that. It is not an install script the package asked for; it is npm's implicit default, and no
flag about prebuilt binaries turns it off.

## The correction

The earlier decision record — `container-image-shape.md`, written before the image was ever
built — asserted:

> `better-sqlite3` ships prebuilt binaries for linux-x64 and linux-arm64 against **glibc**, and
> none against musl.

**Half of that is wrong, and it was wrong when it was written.** `better-sqlite3@13.0.3` ships
its binaries inside the published tarball, at `prebuilds/`, and the set is:

```
darwin-arm64  darwin-x64  linux-arm64  linux-x64
linuxmusl-arm64  linuxmusl-x64  win32-arm64  win32-x64
```

musl is there. Alpine would have worked. The real obstacle was never the libc — it was npm
compiling a binary that was already in the package.

## The fix

`--ignore-scripts` on both `npm ci` invocations. The prebuilt binary is already inside the
package, so nothing needs to be compiled or downloaded; skipping the lifecycle scripts is what
lets npm use it.

**The deps stage then proves it rather than assuming it:**

```dockerfile
RUN npm ci --omit=dev --ignore-scripts \
 && node -e "new (require('better-sqlite3'))(':memory:').close()" \
 && npm cache clean --force
```

Opening an in-memory database is the smallest thing that forces the addon to load. Without that
line, a future change that breaks the prebuild path produces an image that builds cleanly and
fails on first boot; with it, the build fails where the mistake is.

## What `--ignore-scripts` costs

It is blunt: it disables lifecycle scripts for **every** package, not just this one. npm has no
per-package switch. If a dependency is ever added that genuinely needs a postinstall, it will
not run and nothing will say so.

That was measured rather than assumed. With `--ignore-scripts`, `npm ci` installs the full dev
tree, `tsc` compiles, `esbuild` — the one devDependency that has a postinstall — still loads and
reports its version, and the production install boots the service and answers `/health/ready`.

The alternative is `python3`, `make` and `g++` in the build and deps stages so node-gyp can
compile a binary the package already contains. That is slower on every build and buys nothing.

## Why the base image stays Debian slim

Not because of musl — see the correction above. With `--ignore-scripts` and bundled prebuilds,
Alpine would work too. `node:22-bookworm-slim` stays because glibc is what the `linux-x64`
prebuild targets and what Node's official image defaults to; moving to Alpine would switch to
the `linuxmusl` prebuild for no benefit.

## The lesson about the verification

The task that wrote this Dockerfile could not build it — there was no Docker daemon — so it
verified `npm ci --omit=dev` **on the development machine instead**. That machine has `python3`,
`make` and `g++`, so node-gyp succeeded there. The check passed for a reason that did not exist
in the image, which is the specific way a substitute check misleads: it was not weaker than the
real one, it was answering a different question.

A substitute check must be examined for what the real environment has that this one does not.
Here that was a compiler.
