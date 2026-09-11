# Environment Variables

[← Back to README](../../README.md)

Every key this service reads. All of them are validated once at startup by `src/config.ts`;
a missing or malformed value stops the process with the name of the key rather than
surfacing as `undefined` at the first request that needs it.

`.env.example` is a copyable template of this table. `.env` itself is never committed.

## Required

| Key | Type | Notes |
|---|---|---|
| `JWT_SECRET` | string, ≥ 32 chars | Signs access tokens. **No default** — a service that boots with a well-known signing key is worse than one that refuses to boot. Refresh tokens are random rather than signed, so this key does not protect them. |

## Runtime

| Key | Type | Default | Notes |
|---|---|---|---|
| `NODE_ENV` | `development` \| `test` \| `production` | `development` | |
| `PORT` | integer 1–65535 | `3000` | |
| `LOG_LEVEL` | `debug` \| `info` \| `warn` \| `error` \| `silent` | `info` | `silent` is for tests |

## Database

| Key | Type | Default | Notes |
|---|---|---|---|
| `DATABASE_PROVIDER` | `sqlite` \| `postgresql` \| `mysql` \| `mariadb` | `sqlite` | |
| `DATABASE_URL` | string | `file:./dev.sqlite` | |

**`DATABASE_PROVIDER` is separate from `DATABASE_URL` on purpose.** A MySQL URL and a MariaDB
URL are indistinguishable, and the two differ in ways the schema has to know about. Deriving
the dialect from the URL would guess wrong exactly where guessing is most expensive.

`mongodb` is not a valid value. It is deferred to a separate adapter behind the same
repository interfaces — it has no foreign keys, no partial unique indexes, and no
transactions across the shapes the schema uses, so it is not one more dialect. See
[Data Model](../information/data-model.md).

## Tokens

| Key | Type | Default | Notes |
|---|---|---|---|
| `ACCESS_TOKEN_TTL_SECONDS` | positive integer | `900` | Fifteen minutes |
| `REFRESH_TOKEN_TTL_SECONDS` | positive integer | `2592000` | Thirty days |

## Storage and origins

| Key | Type | Default | Notes |
|---|---|---|---|
| `STORAGE_DIR` | string | `./storage` | Where artifact bytes go when storage is disk-backed |
| `PANEL_ORIGIN` | URL | `http://localhost:5173` | Validated at startup and **not read by anything yet**. See below before relying on it |

### `PANEL_ORIGIN` does not configure CORS

It is reserved for a redirect target this service does not yet issue. Nothing reads it after
`src/config.ts` validates it, and setting it does not permit anything:

**This service has no CORS layer.** There is no `cors` dependency and no `Access-Control-*`
header anywhere in `src/`. Booted with `PANEL_ORIGIN` set to a panel's exact origin, a
preflight from that origin still comes back with nothing a browser can act on:

```
OPTIONS /api/v1/auth/login    Origin: https://mcpm-panel.onrender.com
HTTP/1.1 200 OK
Allow: POST                   <- Express's own 200 for OPTIONS; no Access-Control-Allow-Origin
```

The browser refuses the real request on the strength of that, so the request never arrives and
this service logs nothing. A panel reporting "failed to fetch" against a server whose log is
empty is this, every time.

**And the refresh cookie is `SameSite=Lax`, hardcoded** in `src/modules/auth/routes.ts`:

```
Set-Cookie: mcpm_refresh=...; Path=/api/v1/auth; HttpOnly; SameSite=Lax
```

`Lax` is not sent on a cross-site request. Even with CORS granted, sign-in would appear to
work and the session would end at the first refresh.

**So the panel must be served from this service's origin**, which is what the panel's own
container image does — its nginx serves the bundle and proxies `/api` here, so the browser
sees one origin. The panel's `VITE_API_BASE_URL` must stay empty; its `API_UPSTREAM` is the
variable that points it at this service. That repository's `wiki/environments/env.md` has the
detail.

Making a cross-origin panel work would mean adding a CORS layer here and making the cookie's
`SameSite` configurable. Both are changes to this service, not settings on it.

## Adding a key

Add it to the schema in `src/config.ts`, to `.env.example`, and to this page — in the same
commit. A key that exists in only one of the three is one a deployment discovers at runtime.

## The demo account

| Key | Type | Default | What it does |
|---|---|---|---|
| `DEMO_ACCOUNT_ENABLED` | `true` / `false` | `false` | Seeds a demo account and advertises it on `GET /api/v1/meta` |
| `DEMO_ACCOUNT_HANDLE` | string | `demo` | |
| `DEMO_ACCOUNT_EMAIL` | email | `demo@mcengine.local` | |
| `DEMO_ACCOUNT_PASSWORD` | string, 12+ | `demo-password-1234` | |

**Read this before turning it on.** The demo account is a **real user account** with the usual
permissions. Anyone who can reach the panel can sign in as it, create an organization, mint API
tokens, and publish artifacts — which Minecraft servers then download and execute. On a
deployment reachable from the internet, that is a stranger publishing into your catalogue.

It exists so an evaluation needs no registration. Registering and signing in are unaffected and
still work; the demo account is an addition, not a replacement.

When it is on, the server logs a warning naming this at every startup, and the panel says on the
sign-in page that the account is shared. Turn it off before the deployment matters.

`DEMO_ACCOUNT_ENABLED` takes the literal strings `true` and `false`. It is not coerced, because
`Boolean("false")` is `true` and a flag that turns itself on is worse than no flag.

