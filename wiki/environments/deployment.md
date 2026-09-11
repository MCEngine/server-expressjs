# Deployment

[← Back to README](../../README.md)

This page covers running the central server as a container. For running it from source, see
[`setup.md`](setup.md); for what every environment variable means, see [`env.md`](env.md).

## Build

```bash
docker build -t mcengine/server-expressjs:0.0.0 .
```

Three stages. The first compiles TypeScript with devDependencies available; the second installs
the **production** dependency set on the same base image; the third copies `dist/` and those
`node_modules` into a runtime that carries neither a compiler nor a test runner.

The production set is installed rather than copied out of the build stage, and that is not
tidiness: `better-sqlite3` is a native module whose binary is bound to the platform and ABI it
was installed for, and the build stage's tree also carries devDependencies that must not ship.

**No stage carries a compiler, and every `npm ci` runs with `--ignore-scripts`.**
`better-sqlite3` ships its binaries inside the package at `prebuilds/` — glibc and musl, x64 and
arm64 — so there is nothing to build. The flag is what lets npm use them: npm runs
`node-gyp rebuild` on its own for any package that has a `binding.gyp` and declares no `install`
script, and without the flag the build stops looking for Python.

The deps stage then opens an in-memory database before the build may continue. That one line is
the difference between a broken prebuild path failing here, at the line responsible, and
shipping an image that builds cleanly and dies on its first request.

Adding a dependency that genuinely needs a `postinstall` is the case to watch: `--ignore-scripts`
is per-install, not per-package, so it would be skipped silently.

## Run

```bash
docker run -d --name mcpm-server \
  -p 3000:3000 \
  -v mcpm-data:/data \
  -e JWT_SECRET="$(openssl rand -base64 36)" \
  -e PANEL_ORIGIN=https://panel.example.com \
  mcengine/server-expressjs:0.0.0
```

`JWT_SECRET` has no default and must be at least 32 characters; the process refuses to boot
without it, which is the intended behaviour rather than an inconvenience to work around.

Everything else has a default. The defaults baked into the image are `NODE_ENV=production`,
`PORT=3000` and `STORAGE_DIR=/data/storage`; the rest come from `src/config.ts`.

## What is on the volume

`/data` is declared as a volume and owned by the image's unprivileged user.

| Path | What | When |
|---|---|---|
| `/data/storage` | Every published jar | Always |
| Wherever `DATABASE_URL` points | The database | Only with `DATABASE_PROVIDER=sqlite` |

With SQLite, point `DATABASE_URL` inside the volume — `file:/data/app.sqlite` — or the database
is written into the container's writable layer and is gone when the container is replaced.

With PostgreSQL, MySQL or MariaDB the database is external and only the artifacts are on the
volume:

```bash
-e DATABASE_PROVIDER=postgresql \
-e DATABASE_URL=postgres://mcpm:secret@db:5432/mcpm
```

Migrations run at startup from a list compiled into `dist/`, so there is no separate migrate
step and no directory scan that could apply something that was not built.

## Health

| Route | Checks | Used by |
|---|---|---|
| `/health` | Nothing | Liveness |
| `/health/ready` | Every dependency, naming the one that failed | Readiness, and the image's `HEALTHCHECK` |

The image's `HEALTHCHECK` calls **readiness**. Docker's healthcheck restarts nothing — it
publishes the status that `depends_on: condition: service_healthy` and load balancers gate on.
Liveness is the one that must not check the database, because an orchestrator restarts what
fails it and restarting does not fix an unreachable database; it turns an outage into a crash
loop.

```bash
docker inspect --format '{{.State.Health.Status}}' mcpm-server
```

## Signals

`node` is PID 1 and receives `SIGTERM` directly. `src/index.ts` stops accepting connections,
closes the database, and exits `0`. Nothing needs an init process: the service spawns no child
processes, so there are no zombies to reap. `docker run --init` is available if a future change
makes that untrue.

## Both halves together

The panel's requests are **relative** — `/api/v1/...` — because its refresh token is an
`HttpOnly` cookie and a second origin would make every request cross-site in production while
the dev proxy keeps it same-site. So the panel's image serves the bundle *and* proxies `/api`
here, and the browser only ever talks to the panel.

```yaml
# compose.yaml — not committed to either repository, because it names both
services:
  server:
    image: mcengine/server-expressjs:0.0.0
    environment:
      JWT_SECRET: ${JWT_SECRET:?set me}
      DATABASE_PROVIDER: sqlite
      DATABASE_URL: file:/data/app.sqlite
      PANEL_ORIGIN: http://localhost:8080
    volumes:
      - mcpm-data:/data

  panel:
    image: mcengine/client-reactjs:0.0.0
    environment:
      API_UPSTREAM: server:3000
    ports:
      - '8080:8080'
    depends_on:
      server:
        condition: service_healthy

volumes:
  mcpm-data:
```

The server is not published on a host port here: nothing but the panel needs to reach it. Give
it one only to call the API directly — a CI job publishing a version, for instance — and
remember that doing so makes it a second origin for anything a browser does.

`PANEL_ORIGIN` must match the origin a person types into their browser, since it is what the
service allows cross-origin requests from.
