# Changelog — 0.4.0

**2026-11-08** — MCPackage can remove one of its central package records, so `/package uninstall`
(MCPackage 0.9.0) works with `database.type: central`.

## Added

- `DELETE /api/mcpackage/servers/:serverId/packages?platform=&project_id=`: removes the record of
  that platform and project, answering `204` also when there was none.

## Changed

- `version` in `package.json` from `0.3.0` to `0.4.0`.
- `wiki/information/central-api.md` lists the route.
