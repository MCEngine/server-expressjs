# Local Setup

[← Back to README](../../README.md)

## Requirements

- **Node 22 or newer.** `package.json` declares it, and the code uses `node:crypto`'s
  `randomUUID` and ES2023 language features.
- **npm 10 or newer**, which ships with Node 22.

Nothing else. The default database profile is SQLite in a local file, so there is no server
to install before the suite runs.

## Install and run

```bash
npm install
cp .env.example .env      # then set JWT_SECRET to something at least 32 characters
npm run dev               # watch mode on http://localhost:3000
```

`npm run dev` uses `tsx`, so TypeScript runs directly with no build step between an edit and
a reload.

## Commands

| Command | What it does |
|---|---|
| `npm run check` | Typecheck, then the full test suite. **This is what "verify" means here.** |
| `npm run typecheck` | `tsc --noEmit` over `src/` and `test/` |
| `npm test` | Vitest, once |
| `npm run test:watch` | Vitest, watching |
| `npm run build` | Compiles `src/` to `dist/` |
| `npm start` | Runs the compiled output — what production runs |
| `npm run dev` | Watch mode, no build step |

## Configuration

Every environment variable is listed in [`env.md`](env.md) and validated once at startup by
`src/config.ts`. A missing or malformed value fails the process immediately, naming the key.

There is no fallback to a default secret. `JWT_SECRET` has no default on purpose: a service
that boots with a well-known signing key is worse than one that refuses to boot.

## Verifying the service by hand

```bash
npm run build
JWT_SECRET=$(openssl rand -base64 36) PORT=3999 node dist/index.js
```

```bash
curl -s localhost:3999/health          # {"status":"ok"}
curl -s localhost:3999/health/ready    # {"status":"ready","checks":[]}
curl -s localhost:3999/nope            # the error envelope, 404 route_not_found
curl -sI localhost:3999/health | grep -i x-request-id
```

`/health` and `/health/ready` are deliberately different: liveness checks nothing, because an
orchestrator restarts what fails it and restarting does not fix an unreachable database.
Readiness checks every dependency, so a blip takes the instance out of rotation instead.

## Layout

| Path | What is in it |
|---|---|
| `src/config.ts` | The environment schema. Every key the service reads is here and nowhere else. |
| `src/errors.ts` | `ApiError` and the constructors for each status the contract defines. |
| `src/app.ts` | Builds the Express app from its dependencies. Never listens. |
| `src/index.ts` | Loads config, builds the app, listens, and shuts down gracefully. |
| `src/http/` | Middleware: the request id, and the error handler. |
| `src/routes/` | One file per route group. |
| `src/lib/` | Small shared pieces with no HTTP knowledge. |
| `test/` | Vitest suites, plus `helpers.ts` for building an app per suite. |

**`createApp()` takes its dependencies as arguments and never binds a port.** That is what
lets a suite build an app with a failing readiness probe, or a recording logger, and drive it
in-process — no port, no shared state between files, no cleanup.

## Testing

Suites live in `test/` and are named for the unit they cover. `test/helpers.ts` builds a
config and an app for a suite; use it rather than mutating `process.env`, which is shared
state that leaks between files.

`npm run check` is the gate. A change is not finished until it passes.
