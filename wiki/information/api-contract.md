# API Contract

[← Back to README](../../README.md)

Every route this service exposes, what authenticates it, and what it returns. Two clients
depend on it — the `MCEngine/plugin-manager` plugin and the `MCEngine/client-reactjs` panel —
and neither owns any of it, so a change here is a change to a contract two repositories
compile against.

The tables and columns named below are defined in [Data Model](data-model.md); this page does
not repeat them.

## Base

All routes are under `/api/v1`. Requests and responses are JSON, UTF-8, except artifact
downloads and uploads.

Breaking changes get `/api/v2`; the plugin sends its own version and the panel is deployed
alongside the server, so neither is helped by silent reshaping of a v1 payload.

## Authenticating

Three schemes, and which one a route accepts is part of its definition.

| Scheme | Header | Used by |
|---|---|---|
| **Session** | `Authorization: Bearer <access JWT>` | The panel |
| **API token** | `Authorization: Bearer mcpm_<prefix><secret>` | The plugin, and CI |
| **None** | — | Public reads |

The two bearer forms are told apart by prefix: an API token always begins `mcpm_`. A JWT
never does, so no route has to guess.

**Access tokens are short-lived** (15 minutes) and are not stored. **Refresh tokens** are
stored only as digests in `sessions`, rotate on every use, and a reused refresh token
revokes the whole session — that is what makes a stolen refresh token detectable rather than
merely time-limited.

**API tokens are scoped.** A route that needs one names the scope; a token without it gets
`403`, never `404`, because the caller is authenticated and hiding existence from an
authenticated caller only makes the failure harder to debug.

## Errors

One shape, always:

```json
{
  "error": {
    "code": "product_slug_cooldown",
    "message": "This product's id was changed 12 days ago and can be changed again in 18 days.",
    "details": { "changed_at": "2026-08-29T10:14:00Z", "available_at": "2026-09-28T10:14:00Z" }
  }
}
```

`code` is a stable machine-readable string and is what a client branches on. `message` is
for a person and may be reworded without a version bump. `details` is optional and its shape
is documented per code.

| Status | When |
|---|---|
| `400` | Malformed request or failed validation |
| `401` | No credential, or an expired or revoked one |
| `403` | Authenticated, but not permitted — including a missing scope |
| `404` | Does not exist, or exists privately and the caller may not see it |
| `409` | Conflict: handle taken, version already published, cooldown active |
| `413` | Upload exceeds `max_file_bytes` |
| `422` | The upload is not a valid jar for the product's `kind` |
| `429` | Rate limited; `Retry-After` is always set |
| `507` | The org's storage quota would be exceeded |

`409` covers cooldowns rather than `403` deliberately: the caller *may* perform the action,
just not yet, and `details.available_at` says when.

## Pagination

List routes take `?limit=` (default 25, max 100) and `?cursor=`, and return
`{ "data": [...], "next_cursor": "..." | null }`. Cursors are opaque and encode the sort key,
not an offset — an offset re-reads rows that shifted under it.

## Accounts and namespaces

| Method | Route | Auth | Notes |
|---|---|---|---|
| `POST` | `/auth/register` | none | Creates a `user` account, an unverified email, and a handle |
| `POST` | `/auth/login` | none | Returns an access token and sets a refresh cookie |
| `POST` | `/auth/refresh` | refresh cookie | Rotates the refresh token |
| `POST` | `/auth/logout` | session | Revokes the current session only |
| `GET` | `/auth/identities/:provider/start` | none | Begins an OAuth flow |
| `GET` | `/auth/identities/:provider/callback` | none | Links the identity, or signs in |
| `DELETE` | `/auth/identities/:id` | session | Refused if it is the last way in |
| `GET` | `/me` | session | The signed-in account |
| `GET` | `/me/sessions` | session | Every signed-in device |
| `DELETE` | `/me/sessions/:id` | session | Revoke one device |
| `GET` | `/me/orgs` | session | The organizations the caller is in, with the role held |
| `GET` | `/me/emails` | session | |
| `POST` | `/me/emails` | session | Adds an unverified address |
| `POST` | `/me/emails/:id/primary` | session | Refused unless verified |
| `DELETE` | `/me/emails/:id` | session | Refused if primary |
| `GET` | `/accounts/:handle` | none | Public profile; works for a user or an org |
| `PATCH` | `/accounts/:handle` | session | `display_name`, `bio`, `avatar_url` |
| `PUT` | `/accounts/:handle/handle` | session | `409 handle_cooldown` inside thirty days |

`DELETE /auth/identities/:id` refusing the last credential is the rule that stops an account
becoming unreachable: an account must retain at least one of a password or an identity.

## Organizations

| Method | Route | Auth | Notes |
|---|---|---|---|
| `POST` | `/orgs` | session | Creator becomes the single `owner` |
| `GET` | `/orgs/:handle/members` | session, member | |
| `POST` | `/orgs/:handle/members` | session, `admin`+ | Invite by handle or email |
| `PATCH` | `/orgs/:handle/members/:userId` | session, `admin`+ | Change role |
| `DELETE` | `/orgs/:handle/members/:userId` | session, `admin`+ | Refused for the owner |
| `POST` | `/orgs/:handle/transfer` | session, `owner` | One transaction: demote, promote |
| `GET` | `/orgs/:handle/settings` | session, `admin`+ | Tier, quota, usage |
| `GET` | `/orgs/:handle/tokens` | session, `admin`+ | The org's own tokens; never a secret |
| `POST` | `/orgs/:handle/tokens` | session, `admin`+ | **The only response that contains the token** |
| `DELETE` | `/orgs/:handle/tokens/:id` | session, `admin`+ | Revokes immediately |

**A token an organization owns acts for that organization**, at `owner`. That is what makes it
usable for CI: it does not stop working when the person who created it leaves, and it reaches
nothing outside the org. It cannot administer the org either — every route that does needs a
signed-in user, and an API token is refused with `session_required`.

Removing the owner is refused rather than cascaded. An org with no owner has no one who can
delete it or transfer it, which is a state with no exit.

## Meta

| Method | Route | Auth | Notes |
|---|---|---|---|
| `GET` | `/meta` | none | What a client needs to know before it has credentials |

```json
{ "demo_account": { "email": "demo@mcengine.local", "password": "..." } }
```

`demo_account` is `null` unless `DEMO_ACCOUNT_ENABLED` is on. **The password is returned on
purpose**: it is a credential the operator published by turning that flag on, and the sign-in
page is what needs it. Printing it in a startup log while withholding it here would be theatre.
What enabling it costs is in [`../environments/env.md`](../environments/env.md).

## Tokens

| Method | Route | Auth | Notes |
|---|---|---|---|
| `GET` | `/tokens` | session | Lists prefix, name, scopes, last use — never the secret |
| `POST` | `/tokens` | session | **The only response that contains the token.** `ownerAccountId` must be the caller's own account or an org they administer |
| `DELETE` | `/tokens/:id` | session | Revokes immediately |

`POST /tokens` returns `{ "token": "mcpm_a1b2c3d4<secret>", "prefix": "a1b2c3d4", ... }` once.

Every token carries **`created_by`** — `{ id, handle, display_name }` — the person who minted it.
It matters most for a token an organization owns, because the token then acts as the
organization and the row is the only thing that still says which admin made it. An organization's
`token.created` and `token.revoked` events are filed against the **organization**, so
`GET /orgs/:handle/audit` shows them; the token id is in the metadata.

**A token authenticates as its owner**, so `ownerAccountId` decides what it can do. It is
checked against the same rule as every other "may I act for this account" question — your own
account, or an organization where you are `admin` or above — because account ids are public and
an unchecked owner would let anyone mint a credential that acts as somebody else.
There is no route that returns it again, because the service does not have it — only the
digest is stored.

## Products

| Method | Route | Auth | Notes |
|---|---|---|---|
| `GET` | `/products` | optional | Search and filter by kind, platform, org |
| `POST` | `/products` | session or `product:write` | Must name an org the caller may publish for |
| `GET` | `/products/:id` | optional | Accepts the ULID or the slug |
| `PATCH` | `/products/:id` | session, `maintainer`+ | Everything but the slug |
| `PUT` | `/products/:id/slug` | session, `admin`+ | `409 product_slug_cooldown` inside thirty days |
| `DELETE` | `/products/:id` | session, `owner`/`admin` | Soft delete; body must repeat the slug |
| `GET` | `/products/:id/versions` | optional | Newest first by `version_norm` |
| `PUT` | `/products/:id/versions/:version` | session or `artifact:write` | Multipart; publishes at the version's own address. See below |
| `GET` | `/products/:id/versions/:version` | optional | |
| `DELETE` | `/products/:id/versions/:version` | session, `maintainer`+ | |
| `GET` | `/products/:id/versions/:version/download` | `artifact:read`, or none if public | Streams the jar |
| `GET` | `/products/:id/versions/latest` | optional | `?channel=release` |

`GET /products/:id` omits `repo_url` from the response entirely when it is unset, rather than
returning `null` — the panel's rule is "show it only when set", and an absent key is harder
to render by accident than a null.

`DELETE /products/:id` requires the request body to repeat the product's slug. The panel's
confirm dialog is a courtesy; this is the actual guard, and it survives someone scripting
against the API.

## Publishing a version

`PUT /products/:id/versions/:version` — `multipart/form-data`, one `file` part plus fields for
`channel`, `changelog` and `compatibility`. Accepts a session from the panel or a token with
`artifact:write` from CI; the two paths differ only in `product_files.upload_source`.

**A version is addressed by its path, in all four of its routes.** `products.id` is globally
unique, so `(product_id, version)` fully addresses a version — which means the URL a publisher
writes to is the URL that reads it back, downloads it, and deletes it:

```
PUT    /products/:id/versions/:version            publish
GET    /products/:id/versions/:version            read
GET    /products/:id/versions/:version/download   download
DELETE /products/:id/versions/:version            delete
```

**`PUT`, because the client chooses the URI.** It is create-only rather than a replace: a
published version is immutable, since the checksum in its payload is what every Minecraft
server verifies its download against, so re-publishing one is `409 version_exists` — deliberate
policy, not an unimplemented half of the method.

**A `version` field in the body is refused with `400 version_in_body`**, even when it agrees
with the path. Ignoring it would be the worse failure: a CI script whose URL says `1.2.2` while
its body says `1.2.3` — one line updated and not the other — would publish `1.2.2` and report
success. `channel`, `changelog` and `compatibility` stay in the body, because they are
attributes of the version rather than part of its address.

A path segment that is not version-like is `400 validation_failed`, which is also what keeps
`PUT /products/:id/versions/latest` from ever being a publish.

The upload is rejected unless **all** of the following hold. They are listed in the order the
service applies them, cheapest first, because the point of the order is to reject a hostile
upload before it has cost anything.

| # | Check | Failure |
|---|---|---|
| 1 | `Content-Length` within `org_settings.max_file_bytes` | `413` |
| 2 | The version does not already exist for this product | `409` |
| 3 | The stream stays within the declared length while being read | `413` |
| 4 | The first four bytes are `50 4B 03 04` | `422 not_a_jar` |
| 5 | The archive parses as a zip and its central directory is consistent | `422 not_a_jar` |
| 6 | No entry name is absolute, contains `..`, or is a symlink | `422 unsafe_archive` |
| 7 | Total uncompressed size and entry count are within limits | `422 archive_too_large` |
| 8 | It carries the descriptor the product's `kind` requires | `422 wrong_artifact_kind` |
| 9 | `storage_used_bytes + size <= storage_quota_bytes`, read `FOR UPDATE` | `507` |

Checks 6 and 7 are the zip-slip and zip-bomb guards. They matter even though this service
never extracts an uploaded jar, because the panel and future tooling may, and a guard that
depends on nobody downstream ever extracting the archive is not a guard.

Check 8 maps as: `bukkit_plugin` → `plugin.yml` or `paper-plugin.yml`; `mod_client` and
`mod_server` → `fabric.mod.json`, `META-INF/mods.toml`, or `META-INF/neoforge.mods.toml`.

**The filename never reaches a path.** `file_name` is sanitized to a basename and stored as
data; the bytes are written under a generated `storage_key`. Downloads are addressed by
version id and the original name is echoed only in `Content-Disposition`, quoted and with
control characters stripped.

Only after all nine checks does the service compute SHA-256, write the object, and insert
`product_versions`, `product_files`, `product_compatibility` and the `storage_used_bytes`
increment **in one transaction**. A failure at any point leaves no row and no object.

## Downloading

`GET /products/:id/versions/:version/download` streams the jar with `Content-Length`,
`Content-Type: application/java-archive`, and two headers the plugin reads before it writes
anything:

```
X-Artifact-SHA256: <64 hex characters>
X-Artifact-Size: <bytes>
```

The checksum is also in the JSON version payload. It is repeated in a header so a client
streaming straight to disk can verify without a second request — and the plugin verifies
against it before the file is moved anywhere the server will load from.

Private and unlisted products require `artifact:read` and a token whose owner may see them.
Public products may be downloaded unauthenticated; the download is still recorded in
`fleet_events` when a `server_key` is supplied.

## Fleet

| Method | Route | Auth | Notes |
|---|---|---|---|
| `POST` | `/fleet/servers` | `fleet:write` | Registers, returns the `server_key` |
| `GET` | `/fleet/servers` | session | The caller's servers |
| `GET` | `/fleet/servers/:id` | session | Installed plugins and their drift |
| `PATCH` | `/fleet/servers/:id` | session | Rename, set the URL |
| `DELETE` | `/fleet/servers/:id` | session | |
| `POST` | `/fleet/servers/:id/plugins` | `fleet:write` | The plugin reports what is installed |
| `PUT` | `/fleet/servers/:id/plugins/:pluginId` | session | The panel sets `desired_version` |
| `DELETE` | `/fleet/servers/:id/plugins/:pluginId` | session | Sets `state = pending_delete` |
| `GET` | `/fleet/servers/:id/desired` | `fleet:read` | **The one route the plugin polls** |
| `POST` | `/fleet/servers/:id/events` | `fleet:write` | Reports an install, update, delete or failure |

`POST /fleet/servers/:id/plugins` is a full replacement of that server's inventory, not a
patch. A plugin removed by hand on the server disappears from the report, and a patch would
leave it in the table forever.

`GET /fleet/servers/:id/desired` returns everything the plugin needs to act without a second
round trip:

```json
{
  "actions": [
    {
      "action": "update",
      "plugin_id": "Essentials",
      "product_id": "01J8ZK...",
      "from_version": "2.19.0",
      "to_version": "2.20.1",
      "download_url": "/api/v1/products/01J8ZK.../versions/2.20.1/download",
      "sha256": "9f86d0...",
      "size_bytes": 4194304
    },
    { "action": "delete", "plugin_id": "OldPlugin" }
  ],
  "poll_after_seconds": 300
}
```

`poll_after_seconds` is set by the server, not the plugin. Poll interval is a property of how
loaded the service is, and a fleet that decides it independently cannot be slowed down when
it needs to be.

## External sources

| Method | Route | Auth | Notes |
|---|---|---|---|
| `POST` | `/sources/resolve` | `artifact:read` | Turns a source reference into a download and a checksum |
| `GET` | `/sources/:id` | session | A stored mirror |

`POST /sources/resolve` takes `{ "source_type": "modrinth", "source_ref": "..." }` and returns
the same shape as a catalogue download entry, so everything downstream — the plugin included
— treats a mirrored artifact and a catalogue artifact identically.

The service fetches and checksums the file itself rather than handing the plugin a
third-party URL. That is what keeps one rule true everywhere: **the plugin only ever
downloads from a server it is configured to trust, and always against a checksum that server
declared.**

## Rate limits

| Surface | Limit |
|---|---|
| `POST /auth/login`, `/auth/register`, password reset | 10 per 15 minutes per IP, and per account |
| `POST /tokens` | 20 per hour per account |
| `PUT /products/:id/versions/:version` | 30 per hour per org |
| Downloads | 600 per hour per token |
| `GET /fleet/servers/:id/desired` | 60 per hour per server |
| Everything else | 1000 per hour per credential |

Login is limited per account as well as per IP, because a per-IP limit alone does not slow a
distributed attempt against one account.

## Health

| Method | Route | Auth |
|---|---|---|
| `GET` | `/health` | none — liveness only, no dependency checks |
| `GET` | `/health/ready` | none — readiness: database reachable, storage writable |

Kept separate so a database blip takes the service out of the load balancer's rotation
without a restart loop killing it.
