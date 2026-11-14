---
name: memory-tasks-multiverse-realm-central
description: Central storage for MCMultiverse and MCRealm under /api/mcmultiverse and /api/mcrealm, the confirmed plan across three repositories, and one entry per task.
---

# Task: central storage for MCMultiverse and MCRealm

## Why

Asked for: two new standalone plugins, MCMultiverse/mcmultiverse (one universe, the same player
data in every world) and MCRealm/mcrealm (isolated realms, player data bound to the realm). Every
plugin in this project can keep its data on this server with `database.type: central`, so these
two need their tables and routes here first. This server ships before either plugin's central
backend.

## The decisions that were not in the request

The owner was away and asked for the recommended option at every fork.

**Prefixed tables.** This server already has a web `accounts` table, so the tables the two
plugins share keep their plugin column layout under a `universe_` prefix
(`universe_accounts`, `universe_account_property`, `universe_account_session`,
`universe_worlds`, `universe_world_property`, `universe_world_chest`). Plugin specific tables use
the plugin name: `mcmultiverse_account_inventory`, `mcmultiverse_account_equipment`,
`mcmultiverse_account_enderchest`, `mcrealm_realm_types`, `mcrealm_realms`,
`mcrealm_realm_property`, `mcrealm_realm_world`, `mcrealm_account_inventory`,
`mcrealm_account_equipment`, `mcrealm_account_enderchest`.

**Long contents.** Item contents are Base64 strings that can pass the 64 KB of a MySQL `text`, so
`DialectTypes` gains `longText` (`mediumtext` on MySQL and MariaDB, `text` elsewhere).

**Larger bodies on these routes only.** A quit save sends every page at once, so
`/api/mcmultiverse` and `/api/mcrealm` parse JSON up to 8 MB; every other route keeps 1 MB.

**Atomic session lock.** Acquiring a player's session lock is one transaction on the server, so
two game servers can never both load the same player.

## Tasks

| # | Title | Branch |
|---|---|---|
| 1 | This record | `plan/multiverse-realm-central` |
| 2 | Migration `010-central-universe`, shared, MCMultiverse and MCRealm routes, tests | `feat/central-universe` |
| 3 | Central API and data model pages | `docs/central-universe` |
| 4 | Release 0.7.0 | `release/0.7.0` |

The client halves land in MCMultiverse 0.1.0 and MCRealm 0.1.0, after this release.

## Log

### Task 1 — plan/multiverse-realm-central

This record and its row in `.agents/index/memory-index.md`.
