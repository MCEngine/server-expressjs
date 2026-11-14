# Changelog — 0.6.0

**2026-11-14** — The MCIdentity family's central data is keyed by the player UUID, for
MCIdentity 5.0.0, where a player has one character and wears one profession at a time.

## Added

- `POST /v1/players`: creates a player's stats only when absent (`201`, or `200` when present).
- `GET`/`PUT /v1/players/:uuid/stats`, `GET /v1/players/:uuid/stats/:key` and
  `POST /v1/players/:uuid/stats/:key/add`, with `statPoints` beside the nine stats.
- `GET`/`PUT /v1/players/:uuid/profession`: the one profession a player wears.
- `GET`/`PUT /v1/players/:uuid/professions/:code/progress`: level and EXP per profession.
- `POST /v1/profession-logs`.

## Changed

- Migration `003` creates `mcidentity_player_stats`, `mcidentity_player_professions`,
  `mcidentity_player_profession_progress` and `mcidentity_profession_logs`; the skill, rune and
  cosmetic tables key by `player_uuid`. The add-on routes keep their `/v1/identities/:uuid/...`
  paths and now carry the player UUID.
- `version` in `package.json` from `0.5.0` to `0.6.0`.

## Removed

- `/v1/identities` (create, read, properties, alias, stats), `/v1/players/:uuid/session`,
  `/v1/players/:uuid/base-slots` and `/v1/logs`, with their tables.

## Upgrading

No data migration: nothing is in production. Start from a fresh database.
