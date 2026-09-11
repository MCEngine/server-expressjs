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
| `PANEL_ORIGIN` | URL | `http://localhost:5173` | The web panel's origin, for CORS and OAuth redirects |

## Adding a key

Add it to the schema in `src/config.ts`, to `.env.example`, and to this page — in the same
commit. A key that exists in only one of the three is one a deployment discovers at runtime.
