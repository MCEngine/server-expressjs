---
name: memory-tasks-mcstory-accounts
description: MCStory's archive keyed by account (account_type + account_uuid) instead of player — the confirmed plan across MCIpos/mcstory and this repository.
---

# Task: key MCStory's archive by account

## Why

Asked for: MCStory stores a story's and an achievement's owner as `player_uuid`. The owner
wants `account_type` + `account_uuid`, as MCEconomy keys wallets, so a story or achievement can
belong to a player, a clan, or any custom type another plugin defines.

## The decisions that were not in the request

The owner was away and asked for the recommended option at every fork.

**Replace the player routes.** `/api/mcstory/players/:playerUuid/...` becomes
`/api/mcstory/accounts/:accountType/:accountUuid/...`. The only client is MCStory 0.1.0, released
the same day as 0.2.0 of this server, so no compatibility routes are kept.

**A free-form type.** `account_type` is lower-case `[a-z][a-z0-9_]{0,49}`, the width MCEconomy
uses. `player` and `clan` are the well-known values; anything else is a custom type.

**Migrate, do not drop.** Migration `009` moves existing rows to `account_type = 'player'` with
the old `player_uuid` as `account_uuid`; a story with no player keeps no account.

## Tasks

| # | Title | Branch |
|---|---|---|
| 1 | This record | `plan/mcstory-accounts` |
| 2 | Account-keyed routes, migration `009-mcstory-accounts`, tests and docs | `feat/account-keys` |
| 3 | Release 0.3.0 | `release/0.3.0` |

The client half lands in MCIpos/mcstory 0.2.0, after this release.

## Log

### Task 1 — plan/mcstory-accounts

This record and its row in `.agents/index/memory-index.md`.

### Task 2 — feat/account-keys

Migration `009-mcstory-accounts`: stories gain `account_type` and rename `player_uuid` to
`account_uuid` in place; achievements are rebuilt under the key (`account_type`, `account_uuid`,
`achievement_key`); old rows become `player` accounts. The repository and router take an
`AccountKey`, and the per-owner routes move to `/accounts/:accountType/:accountUuid/...`. Tests
cover the routes, account types sharing a UUID, the type/UUID pairing, and the migration on rows
written by `008`. `central-api.md` and `data-model.md` describe the new key.
