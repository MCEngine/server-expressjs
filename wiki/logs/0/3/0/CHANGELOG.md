# Changelog — 0.3.0

**2026-11-08** — MCStory's archive is keyed by account. A story or achievement now belongs to an
`account_type` plus an `account_uuid` — a player, an MCIdentity identity, a clan, or any type
another plugin defines — instead of a player UUID. Clients of 0.2.0's `/players` routes must move
to MCStory 0.2.0.

## Added

- Migration `009-mcstory-accounts`: moves `mcstory_stories` and `mcstory_achievements` to
  `account_type` + `account_uuid`, keeping every 0.2.0 row as a `player` account.

## Changed

- `/api/mcstory/players/:playerUuid/...` is now `/api/mcstory/accounts/:accountType/:accountUuid/...`
  for stories and achievements; `POST /stories` takes `account_type` and `account_uuid` in place
  of `player_uuid`.
- `version` in `package.json` from `0.2.0` to `0.3.0`.
- `wiki/information/central-api.md` and `wiki/information/data-model.md` describe the account key.
