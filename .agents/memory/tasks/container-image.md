---
name: memory-tasks-container-image
description: Task record for containerizing the platform — the confirmed four-task plan across two repositories, with one entry appended per task as it lands.
---

# Task: Container images for the server and the panel

## Goal

Both halves of the platform ship as container images, so a deployment is `docker run` rather
than a README describing how to install Node and hope.

## Objective

* `MCEngine/server-expressjs` builds an image that runs the compiled service, applies its
  migrations on boot, stores artifacts on a mounted volume, and reports readiness.
* `MCEngine/client-reactjs` builds an image that serves the bundle **and** proxies `/api` to the
  server, because the panel's requests are relative and its refresh cookie depends on one origin.
* Both run as a non-root user, carry a `.dockerignore`, and are documented in
  `wiki/environments/deployment.md`.
* No behaviour changes. No new dependency in either `package.json`.

## Detail

* Two repositories. `MCEngine/plugin-manager` is not one of them — it builds a jar that a
  Minecraft server loads, and there is nothing to containerize.
* The version carrier does not move. All repositories stay at `0.0.0`.
* **The images cannot be built in the session that writes them**: there is no Docker daemon
  here. Everything the Dockerfiles wrap is verified directly instead — the production
  dependency install, the compiled entry point starting and answering both health routes, the
  built bundle — and what was not run is named in the work summary rather than implied.

## Decisions

| Decision | Value |
|---|---|
| Server base | `node:22-bookworm-slim` — `better-sqlite3` has glibc prebuilds and no musl ones |
| Runtime dependencies | Installed in the runtime stage, never copied from the build stage |
| User | The base image's own unprivileged user; `STORAGE_DIR` chowned to it |
| Healthcheck | `/health/ready`, called with `node --eval` — no `curl` in the base image |
| Panel base | `nginxinc/nginx-unprivileged`, listening on 8080 |
| Panel topology | nginx serves the bundle and proxies `/api`, because the panel is same-origin with the API by design |
| `proxy_pass` | Through a variable plus a `resolver`, so a replaced API container is not cached forever |
| Compose file | Not committed — it would have to name both repositories. The example lives in each `deployment.md` |

Recorded in [`../decisions/container-image-shape.md`](../decisions/container-image-shape.md).

## Tasks

Task 1 branches from `master`; task `k` branches from task `k-1` **within the same
repository**. The two repositories cannot stack, so they are ordered instead.

**PR numbers restart per repository**, so each cell names the repository as well as the
number. Filled by task 4, which is last in every stack and therefore rebases nothing.

| # | Title | Scope | Repository | Branch | Files / areas | PR |
|---|---|---|---|---|---|---|
| 1 | Task record | This file, its decision, and the index rows | `server-expressjs` | `chore/container-image-plan` | `.agents/memory/`, `.agents/index/` | |
| 2 | Server container image | Dockerfile, dockerignore, deployment page | `server-expressjs` | `build/container-image` | `Dockerfile`, `.dockerignore`, `wiki/environments/` | |
| 3 | Panel container image | Dockerfile, nginx template, dockerignore, deployment page | `client-reactjs` | `build/container-image` | `Dockerfile`, `docker/`, `.dockerignore`, `wiki/environments/` | |
| 4 | Release | Logs, this table, the record closed | both | `chore/container-image-release` | `wiki/logs/0/0/0/`, `.agents/` | |

## Entries

### Task 1 — chore/container-image-plan

Wrote this record and the decision behind it first, because most of the work in a Dockerfile is
the choices it encodes and almost none of it is visible in the diff. A reviewer reading
`FROM node:22-bookworm-slim` cannot tell whether Alpine was considered and rejected or never
thought about.

**The record lives here rather than in `MCEngine/client-reactjs`.** The server is the half with
the constraints that drove the shape — a native module, a writable volume, a readiness probe —
and the panel's image exists to sit in front of it. The panel points at this record from its own
memory tree.

**The images are not built in this session.** There is no Docker daemon in it. That is a real
limit on what "verified" can mean here, so it is written into the plan rather than discovered at
the end: each task verifies what the image wraps, by hand, against the same commands the
Dockerfile runs.

Next task depends on: nothing beyond this record.

### Task 2 — build/container-image

A three-stage `Dockerfile`, a `.dockerignore`, and `wiki/environments/deployment.md`.

**Three stages, not two, because the production dependencies are installed rather than
copied.** The build stage has devDependencies and compiles `dist/`; a separate `deps` stage runs
`npm ci --omit=dev` on the same base image; the runtime copies both results. Copying
`node_modules` out of the build stage would ship a test runner and a compiler, and would also
bind `better-sqlite3`'s native binary to whatever stage happened to install it.

**`node:22-bookworm-slim`, not Alpine.** `better-sqlite3` publishes prebuilt binaries against
glibc and none against musl, so Alpine means `python3`, `make` and `g++` in a production image
to compile a dependency that has a binary already. Recorded in
[`../decisions/container-image-shape.md`](../decisions/container-image-shape.md).

**The healthcheck is readiness and is written in `node --eval`.** Docker's `HEALTHCHECK`
restarts nothing — it publishes the status other things gate on — so readiness is the right
probe, and liveness stays the one that checks nothing. Neither `curl` nor `wget` is in this base
image; Node 22's global `fetch` means the check adds no package.

**`.dockerignore` is a correctness file here, not a tidiness one.** Without it the whole working
tree becomes build context, which sends `.env` and `dev.sqlite` to the daemon and uploads
`node_modules` only for `npm ci` to discard it.

**Verified without building, because there is no Docker daemon in this session — and what was
not run is said rather than implied.** Everything the image wraps was run directly, against the
same commands the Dockerfile issues:

* `npm run build` produces `dist/index.js`.
* `npm ci --omit=dev` into a tree holding only `package.json`, the lockfile and `dist/` — which
  is exactly the runtime stage's contents — resolves cleanly at 46 MB, and `typescript` is
  absent from it. This is the check that matters most: a runtime import of a devDependency is
  the classic way a Dockerfile passes its build and fails on first boot.
* `node dist/index.js` under `NODE_ENV=production` applied `001-initial`, listened, answered
  `/health` with `{"status":"ok"}` and `/health/ready` with the database check passing.
* The literal `HEALTHCHECK` command, copied out of the Dockerfile and run as-is, exited `0`.
* `SIGTERM` logged `shutting down` and exited `0`, which is what the exec-form `CMD` is for.

What remains unverified is the image build itself: base image resolution, layer caching, and
`better-sqlite3` taking its prebuilt binary on `linux/amd64`. Those need a daemon.

Next task depends on: the topology. The panel's image proxies `/api` to this one, so its nginx
template is written against the port and the health route here.

