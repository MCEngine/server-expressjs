# Changelog — 0.2.0

**2026-11-08** — MCStory joins the central server. An MCStory game server set to
`database.type: "central"` now keeps its story archive here, shared by the whole network.

## Added

- `/api/mcstory` — `POST /stories` (archive once under the client's UUID; `409 story_exists`
  on a repeat), `GET /stories` and `GET /players/:playerUuid/stories` (newest first),
  `PUT /players/:playerUuid/achievements/:key` (award once; a repeat answers
  `{awarded: false}` with the first award) and `GET /players/:playerUuid/achievements`.
  Behind `SERVER_API_TOKEN` like every central route.
- Migration `008-central-mcstory`: `mcstory_stories` and `mcstory_achievements`.
- `test/central-mcstory.test.ts`.

## Changed

- `version` in `package.json` from `0.1.0` to `0.2.0`.
- `wiki/information/central-api.md` and `wiki/information/data-model.md` describe the MCStory
  routes and tables.
