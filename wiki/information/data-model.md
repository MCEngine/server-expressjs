# Data Model

[← Back to README](../../README.md)

Every table this service owns, what each column is for, and the constraints that carry a
rule rather than describing one. Written before the schema was implemented, so it is the
thing the implementation is checked against rather than a description of it.

Types are given in PostgreSQL terms. The SQLite, MySQL and MariaDB equivalents are whatever
the ORM maps them to; where a type genuinely cannot be portable, it is called out.

## Conventions

**Identifiers are ULIDs**, stored as `char(26)`. They sort by creation time, carry no
sequence a caller can enumerate, and are safe in a URL. `plugin_hosting` in the original
sketch used an autoincrementing integer; that is a caller-guessable identifier on a table
that names customer infrastructure, so it is a ULID here too.

**Timestamps are `timestamptz`,** always UTC, named `*_at`. Every table has `created_at`.
Tables whose rows are edited also have `updated_at`.

**Deletes are soft where a reference can outlive the row** — `deleted_at timestamptz null` —
and hard everywhere else. A product is soft-deleted because a fleet event references it and
a download log entry should not lose its subject.

**A cooldown is stored as the timestamp of the last change**, never as the moment it
expires. `handle_changed_at` plus thirty days is a policy the code applies; a stored
`cooldown_until` freezes the policy into every existing row, so changing thirty days to
fourteen would leave the old rows wrong.

## Identity

An **account** is a namespace. Users and organizations are the same kind of thing with
different capabilities, which is why they share one table and one handle space: a user
cannot take a handle an org holds, and the URL `/@name` does not need to know which it is.

### `accounts`

| Column | Type | Notes |
|---|---|---|
| `id` | `char(26)` PK | ULID |
| `type` | `enum('user','org')` | Immutable after creation |
| `status` | `enum('active','suspended','deleted')` | Default `active` |
| `created_at` | `timestamptz` | |
| `updated_at` | `timestamptz` | |

### `account_profiles`

One row per account. Split from `accounts` because it changes often and `accounts` does not.

| Column | Type | Notes |
|---|---|---|
| `account_id` | `char(26)` PK, FK → `accounts(id)` ON DELETE CASCADE | |
| `handle` | `varchar(39)` UNIQUE | Lowercase `[a-z0-9][a-z0-9-]{0,38}`, no leading or trailing `-` |
| `display_name` | `varchar(64)` | What the page shows |
| `handle_changed_at` | `timestamptz` null | Null means never changed |
| `avatar_url` | `text` null | |
| `bio` | `text` null | |
| `created_at`, `updated_at` | `timestamptz` | |

**Lowercase is enforced by the database, not only by the handler** — a `CHECK (handle =
lower(handle))` constraint, plus a unique index on `handle`. SQLite and MySQL differ on
whether a plain unique index is case-sensitive, so the check is what makes the behaviour the
same everywhere rather than depending on a collation.

The thirty-day cooldown is `handle_changed_at + interval '30 days' > now()` → reject.

### `account_handle_history`

| Column | Type | Notes |
|---|---|---|
| `id` | `char(26)` PK | |
| `account_id` | `char(26)` FK → `accounts(id)` | |
| `handle` | `varchar(39)` | The handle that was released |
| `released_at` | `timestamptz` | |

Why it exists: without it, a released handle is instantly re-registrable by anyone watching,
and every existing link to it silently points at a different namespace. With it, a released
handle can be held for a grace period and old links can be answered rather than 404'd.

### `account_emails`

| Column | Type | Notes |
|---|---|---|
| `id` | `char(26)` PK | |
| `account_id` | `char(26)` FK → `accounts(id)` ON DELETE CASCADE | |
| `email` | `varchar(254)` UNIQUE | Globally unique: one address, one account |
| `is_primary` | `boolean` | Partial unique index: one `true` per account |
| `verified_at` | `timestamptz` null | |
| `created_at`, `updated_at` | `timestamptz` | |

The original sketch called this `is_active`. That collides with verification — an address can
be verified and not primary, or primary and not yet verified — so the two facts are two
columns. Only a verified address may be made primary.

### `org_members`

| Column | Type | Notes |
|---|---|---|
| `org_id` | `char(26)` FK → `accounts(id)` | Must be an account of type `org` |
| `user_id` | `char(26)` FK → `accounts(id)` | Must be an account of type `user` |
| `role` | `enum('owner','admin','maintainer','member')` | |
| `invited_by` | `char(26)` null, FK → `accounts(id)` | |
| `created_at`, `updated_at` | `timestamptz` | |
| | | PK `(org_id, user_id)` |

**Two foreign keys, not one.** The original sketch had a single `account_id`, which cannot
express which user belongs to which organization — it is the one correction in this document
that is a bug fix rather than a naming preference.

**Exactly one owner**, enforced by a partial unique index on `(org_id) WHERE role = 'owner'`.
The owner is whoever created the org. Transferring ownership is one transaction that demotes
the old owner and promotes the new one; there is no moment with two, and no moment with
none.

| Role | May |
|---|---|
| `owner` | Everything, including deleting the org and transferring ownership |
| `admin` | Manage members, settings and tokens; everything a maintainer may |
| `maintainer` | Create products, publish versions, delete versions |
| `member` | Read private products |

### `org_settings`

| Column | Type | Notes |
|---|---|---|
| `org_id` | `char(26)` PK, FK → `accounts(id)` | |
| `membership_tier` | `enum('free','pro','enterprise')` | Default `free` |
| `storage_quota_bytes` | `bigint` | Whole-org limit |
| `storage_used_bytes` | `bigint` | Maintained inside the upload transaction |
| `max_file_bytes` | `bigint` | Per-jar limit |
| `created_at`, `updated_at` | `timestamptz` | |

`storage_used_bytes` is denormalized on purpose. The alternative is summing
`product_files.size_bytes` across every version of every product on each upload, which is a
table scan on the hot path of the one operation that must not be slow.

It is only correct if it is written in the **same transaction** as the file row, with the
quota check reading the row `FOR UPDATE`. Two uploads racing on a nearly-full quota is
exactly the case that a check-then-write outside a transaction gets wrong.

## Authentication

Three tables, because three different things are being modelled and the sketch's single
`authentication` table would have conflated them: *how you prove who you are*, *a device
that is currently signed in*, and *a machine credential that is not a person at all*.

### `credentials`

| Column | Type | Notes |
|---|---|---|
| `account_id` | `char(26)` PK, FK → `accounts(id)` ON DELETE CASCADE | |
| `password_hash` | `text` | Argon2id |
| `password_updated_at` | `timestamptz` | |

Only accounts of type `user` have a row. An org is never signed into directly.

### `identities`

| Column | Type | Notes |
|---|---|---|
| `id` | `char(26)` PK | |
| `account_id` | `char(26)` FK → `accounts(id)` ON DELETE CASCADE | |
| `provider` | `enum('github','google','discord')` | |
| `provider_user_id` | `varchar(255)` | |
| `created_at` | `timestamptz` | |
| | | UNIQUE `(provider, provider_user_id)` |

This is what "log in with multiple Chrome accounts" means at the schema level: several
provider identities resolving to one account. It is a different axis from `sessions` — one is
*which credential you presented*, the other is *which device you are on*.

### `sessions`

| Column | Type | Notes |
|---|---|---|
| `id` | `char(26)` PK | |
| `account_id` | `char(26)` FK → `accounts(id)` ON DELETE CASCADE | |
| `refresh_token_hash` | `char(64)` UNIQUE | SHA-256 of the refresh token |
| `device_label` | `varchar(64)` null | What the user named it |
| `user_agent` | `text` null | |
| `ip_last_seen` | `inet` / `varchar(45)` | `inet` on PostgreSQL, string elsewhere |
| `created_at`, `last_used_at` | `timestamptz` | |
| `expires_at` | `timestamptz` | |
| `revoked_at` | `timestamptz` null | |

One row per signed-in device. Signing in on a second machine or a second browser profile
creates a second row; neither evicts the other, and either can be revoked alone. **Access
tokens are short-lived JWTs and are not stored** — only refresh tokens are, and only as
digests.

### `email_verifications` and `password_resets`

Same shape, separate tables because they expire on different schedules and are consumed by
different flows.

| Column | Type |
|---|---|
| `id` | `char(26)` PK |
| `account_id` | `char(26)` FK → `accounts(id)` |
| `email` | `varchar(254)` |
| `token_hash` | `char(64)` UNIQUE |
| `expires_at` | `timestamptz` |
| `consumed_at` | `timestamptz` null |

### `api_tokens`

| Column | Type | Notes |
|---|---|---|
| `id` | `char(26)` PK | |
| `owner_account_id` | `char(26)` FK → `accounts(id)` | User or org |
| `name` | `varchar(64)` | What it is for, shown in the panel |
| `token_prefix` | `char(8)` | Non-secret, indexed, shown in the panel |
| `token_hash` | `char(64)` UNIQUE | SHA-256 of the full secret |
| `scopes` | `text[]` / JSON | See below |
| `expires_at` | `timestamptz` null | |
| `last_used_at` | `timestamptz` null | |
| `revoked_at` | `timestamptz` null | |
| `created_by` | `char(26)` FK → `accounts(id)` | |
| `created_at` | `timestamptz` | |

**The token itself is never stored.** It is shown once, at creation. `token_prefix` exists so
the panel can list tokens recognisably and so lookup is an indexed hit on eight characters
rather than a scan hashing every row.

SHA-256 rather than Argon2 here, deliberately: an API token is 32 bytes of entropy from a
CSPRNG, not a human-chosen password, so it is not brute-forceable and the hash is on the hot
path of every download.

| Scope | Grants |
|---|---|
| `artifact:read` | Download any version the owner may see |
| `artifact:write` | Publish a version — the CI/CD scope |
| `product:write` | Create and edit products |
| `fleet:read` | Read the desired state for a server |
| `fleet:write` | Register a server and report installed plugins |

## Catalogue

### `products`

| Column | Type | Notes |
|---|---|---|
| `id` | `char(26)` PK | ULID, unique across every org |
| `slug` | `varchar(64)` UNIQUE | Lowercase; the `:product_id` in the URL |
| `owner_org_id` | `char(26)` FK → `accounts(id)` | Must be type `org` |
| `name` | `varchar(128)` | |
| `summary` | `varchar(256)` | |
| `description` | `text` | Markdown, rendered by the panel |
| `kind` | `enum('bukkit_plugin','mod_client','mod_server')` | |
| `repo_url` | `text` null | Shown only when set |
| `homepage_url` | `text` null | |
| `license` | `varchar(64)` null | |
| `visibility` | `enum('public','unlisted','private')` | Default `public` |
| `slug_changed_at` | `timestamptz` null | Thirty-day cooldown, same rule as handles |
| `downloads_count` | `bigint` | Denormalized counter |
| `created_at`, `updated_at` | `timestamptz` | |
| `deleted_at` | `timestamptz` null | Soft delete |

**Only an org owns a product.** A user who wants to publish creates an org and becomes its
owner. This is a domain rule, not a permission that gets relaxed: `owner_org_id` references
an account whose `type` must be `org`, checked in the application layer because no portable
`CHECK` can follow a foreign key.

**Slugs are globally unique, by request.** The API addresses products by `id`, so a globally
unique slug needs no org qualifier in a URL. The cost is real and worth stating: whoever
registers `essentials` holds it against every other org, and orgs will race for names. A
GitHub-style `org/product` pair avoids that; `id` is already global and opaque, so the API
keeps its advantage either way. This is a decision, not an oversight.

### `product_slug_history`

Same shape and same reason as `account_handle_history`.

### `product_versions`

| Column | Type | Notes |
|---|---|---|
| `id` | `char(26)` PK | |
| `product_id` | `char(26)` FK → `products(id)` | |
| `version` | `varchar(64)` | As published, e.g. `1.10.0` |
| `version_norm` | `varchar(64)` | Zero-padded for ordering |
| `channel` | `enum('release','beta','alpha')` | Default `release` |
| `changelog` | `text` null | |
| `is_latest` | `boolean` | Partial unique on `(product_id, channel) WHERE is_latest` |
| `published_at` | `timestamptz` null | Null until published |
| `created_at` | `timestamptz` | |
| | | UNIQUE `(product_id, version)` |

**`version_norm` is the column that makes updates work.** Compared as text, `1.9.0` sorts
above `1.10.0`, and a plugin comparing versions that way updates backwards. Each numeric
component is zero-padded to a fixed width on write — `1.10.0` → `00001.00010.00000` — so a
plain string comparison in any of the four databases orders correctly without a
database-specific semver function.

### `product_files`

| Column | Type | Notes |
|---|---|---|
| `version_id` | `char(26)` **PK**, FK → `product_versions(id)` ON DELETE CASCADE | |
| `file_name` | `varchar(255)` | The name as offered for download; sanitized, no separators |
| `storage_key` | `text` | Generated, opaque; never derived from `file_name` |
| `size_bytes` | `bigint` | |
| `sha256` | `char(64)` | What the plugin verifies against |
| `content_type` | `varchar(64)` | |
| `uploaded_by` | `char(26)` null, FK → `accounts(id)` | Null when a token published it |
| `upload_source` | `enum('web','ci')` | |
| `created_at` | `timestamptz` | |

**The primary key is `version_id`, and that is the whole point.** "One product page carries
one jar" becomes a thing the database cannot represent otherwise, rather than a check in a
handler that a later refactor routes around. Two jars means two products.

**`storage_key` and `file_name` are separate columns for a security reason**, not a
formatting one. `file_name` is attacker-controlled and is only ever echoed in a
`Content-Disposition` header; `storage_key` is generated by the service and is the only thing
that reaches a filesystem or an object store. Nothing joins user input onto a path.

### `product_compatibility`

| Column | Type | Notes |
|---|---|---|
| `version_id` | `char(26)` FK → `product_versions(id)` ON DELETE CASCADE | |
| `platform` | `enum('spigot','paper','folia','fabric','forge','neoforge')` | |
| `minecraft_version` | `varchar(32)` | |
| | | PK `(version_id, platform, minecraft_version)` |

Without this the plugin can download a jar for the wrong platform and only find out when the
server fails to start it.

## Fleet

### `minecraft_servers`

| Column | Type | Notes |
|---|---|---|
| `id` | `char(26)` PK | |
| `owner_account_id` | `char(26)` FK → `accounts(id)` | |
| `server_key` | `char(26)` UNIQUE | The identity the plugin's `config.yml` carries |
| `server_url` | `text` null | UNIQUE per owner, not globally |
| `name` | `varchar(64)` | |
| `platform` | `enum('spigot','paper','folia')` | Reported by the plugin |
| `mc_version` | `varchar(32)` | Reported by the plugin |
| `agent_version` | `varchar(32)` | The MCPluginManager version running there |
| `last_seen_at` | `timestamptz` null | |
| `created_at`, `updated_at` | `timestamptz` | |

**`server_url` is not the identity, and it is not globally unique.** The sketch made it both.
Two operators can legitimately run behind the same hostname, a server behind NAT has no
public URL at all, and a URL changes when a host does — none of which should orphan a
server's history. The identity is `server_key`, generated at registration and written into
`config.yml`; the URL is optional metadata, unique only within one owner's fleet.

### `server_plugins`

| Column | Type | Notes |
|---|---|---|
| `server_id` | `char(26)` FK → `minecraft_servers(id)` ON DELETE CASCADE | |
| `plugin_id` | `varchar(64)` | The `name:` from that jar's `plugin.yml` |
| `product_id` | `char(26)` null, FK → `products(id)` | Set once matched to the catalogue |
| `installed_version` | `varchar(64)` null | What is on disk now |
| `installed_sha256` | `char(64)` null | |
| `desired_version` | `varchar(64)` null | What the panel says should be there |
| `state` | `enum('installed','pending_update','pending_delete','failed')` | |
| `last_error` | `text` null | |
| `created_at`, `updated_at` | `timestamptz` | |
| | | PK `(server_id, plugin_id)` |

**The composite key is the fix for a contradiction in the sketch**, which asked for
`plugin_id` to be unique and to be duplicated, with `server_id` as the primary key. What was
meant is unique *within* a server and repeated *across* servers, and `PK (server_id,
plugin_id)` is exactly that. A primary key on `server_id` alone would allow one plugin per
server.

**`desired_version` and `state` are what make this a control plane** rather than an
inventory. Without them the table records what happened; with them the panel can express an
intent and the difference between the two columns is the work the plugin has to do.

### `external_sources`

| Column | Type | Notes |
|---|---|---|
| `id` | `char(26)` PK | |
| `product_id` | `char(26)` null, FK → `products(id)` | Null for a one-off |
| `server_id` | `char(26)` null, FK → `minecraft_servers(id)` | |
| `source_type` | `enum('spigotmc','modrinth','hangar','github_release','direct_url')` | |
| `source_ref` | `text` | Resource id, or a URL for `direct_url` |
| `created_at` | `timestamptz` | |

How "download from various websites" is modelled: a resolver turns a `(source_type,
source_ref)` pair into a downloadable file and a checksum, and everything downstream treats
the result the same as a catalogue artifact.

## Logs

Two tables, because the two have different readers, different retention and different volume.
An operator debugging a failed update should not be reading past org membership changes, and
an org owner auditing who deleted a product should not be paging through version checks.

### `audit_events`

Things people do.

| Column | Type | Notes |
|---|---|---|
| `id` | `char(26)` PK | |
| `actor_account_id` | `char(26)` null, FK → `accounts(id)` | |
| `actor_token_id` | `char(26)` null, FK → `api_tokens(id)` | Set when a token acted |
| `subject_type` | `varchar(32)` | `account`, `org`, `product`, `product_version`, `server` |
| `subject_id` | `varchar(64)` | |
| `action` | `varchar(64)` | `org.created`, `account.handle_changed`, `product.deleted` |
| `metadata` | `json` | |
| `ip` | `varchar(45)` null | |
| `user_agent` | `text` null | |
| `created_at` | `timestamptz` | |

Both actor columns are nullable and at most one is set: a request is authenticated by a
session or by a token, and knowing which is often the point of the audit entry.

### `fleet_events`

Things servers do.

| Column | Type | Notes |
|---|---|---|
| `id` | `char(26)` PK | |
| `server_id` | `char(26)` FK → `minecraft_servers(id)` ON DELETE CASCADE | |
| `product_id` | `char(26)` null, FK → `products(id)` | |
| `version_id` | `char(26)` null, FK → `product_versions(id)` | |
| `action` | `enum('version_check','download','install','update','delete','failed')` | |
| `detail` | `json` null | |
| `bytes_sent` | `bigint` null | |
| `created_at` | `timestamptz` | |

`version_check` is high-volume by design — every server, every interval — so this table is
partitioned or pruned by `created_at` and is never joined against on a request path.

## What the schema enforces on its own

The rules below are constraints, not handler code, because a rule that lives only in a
handler is a rule a later refactor can route around without failing a test.

| Rule | Enforced by |
|---|---|
| A handle is unique and lowercase | UNIQUE index + `CHECK (handle = lower(handle))` |
| One email address belongs to one account | UNIQUE on `account_emails.email` |
| An account has at most one primary email | Partial unique on `(account_id) WHERE is_primary` |
| An org has exactly one owner | Partial unique on `(org_id) WHERE role = 'owner'` |
| A product version number is used once per product | UNIQUE `(product_id, version)` |
| One channel has one latest version | Partial unique on `(product_id, channel) WHERE is_latest` |
| **A version carries at most one jar** | `product_files.version_id` is the primary key |
| A plugin appears once per server | PK `(server_id, plugin_id)` |
| A server key is unique | UNIQUE on `minecraft_servers.server_key` |

Two rules cannot be constraints and are therefore application-layer, and each is noted where
it applies: a product's owner must be an account of type `org`, and an org member must be an
account of type `user`. No portable `CHECK` can follow a foreign key to test the referenced
row's column.

## Portability

| Concern | How it is kept portable |
|---|---|
| Identifiers | ULIDs generated in the application, not by the database |
| Case-insensitive uniqueness | An explicit `CHECK`, not a collation |
| Semantic version ordering | `version_norm`, not a database function |
| Arrays (`api_tokens.scopes`) | `text[]` on PostgreSQL, JSON elsewhere, one accessor either way |
| `inet` | `inet` on PostgreSQL, `varchar(45)` elsewhere |
| Partial unique indexes | Native on PostgreSQL and SQLite; a generated null-able column on MySQL and MariaDB, which ignore rows with a null in a unique index |

**MongoDB is not covered by any of this.** It has no foreign keys, no partial unique indexes
and no transactions across the shapes used above, so the constraints that carry the rules
here would all become application code. It is deferred to a separate adapter behind the same
repository interfaces rather than pretended to be one more dialect.
