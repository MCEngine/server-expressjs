# Changelog — 0.7.0

**2026-11-14** — Central storage for MCMultiverse under `/api/mcmultiverse` and MCRealm under
`/api/mcrealm`, for their `database.type: central`.

## Added

- Shared routes on both prefixes: accounts and their inventory and ender chest page limits,
  the cross-server session lock, worlds, and chest blocks.
- Inventory page, ender chest page, equipment and snapshot routes, unscoped on
  `/api/mcmultiverse` and per realm under `/api/mcrealm/realms/:realmId`.
- MCRealm realm types, realms with an optional owner, and the realm each world belongs to.
- Migration `010-central-universe` with the `universe_`, `mcmultiverse_` and `mcrealm_` tables,
  and `DialectTypes.longText` (`mediumtext` on MySQL and MariaDB).

## Changed

- `/api/mcmultiverse` and `/api/mcrealm` accept JSON bodies up to 8 MB; every other route keeps 1 MB.
- `version` in `package.json` from `0.6.0` to `0.7.0`.

## Upgrading

Nothing to do: the migration runs on start and touches no existing table.
