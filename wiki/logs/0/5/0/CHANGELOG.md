# Changelog — 0.5.0

**2026-11-12** — MCStory can read and update one story in the central archive, so
`/story create <prompt>` (MCStory 0.3.0) can update an existing story with `database.type: central`.

## Added

- `GET /api/mcstory/stories/:id`: one story, `404 story_not_found` when none holds the id.
- `PUT /api/mcstory/stories/:id`: replaces the story's title, content, account and source, keeping
  its id and `created_at`; `404 story_not_found` when none holds the id, so it never creates one.

## Changed

- `version` in `package.json` from `0.4.0` to `0.5.0`.
- `wiki/information/central-api.md` lists both routes.
