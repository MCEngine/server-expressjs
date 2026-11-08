---
name: memory-tasks-mcstory-central
description: MCStory's central routes — the stories and achievements an MCStory game server syncs to this server; the confirmed plan across MCIpos/mcstory and this repository.
---

# Task: serve MCStory's archive centrally

## Why

Asked for: MCStory (MCIpos/mcstory), the server-historian plugin, keeps its generated lore and
achievements on this server when its config says `database.type: "central"` with a
`central_server` block, like every other plugin of the family.

## The decisions that were not in the request

The owner was away and asked for the recommended option at every fork.

**A new contract under `/api/mcstory`.** MCStory has no released client, so it follows the
`/api/{plugin}/...` rule for new clients. Same shared-secret guard as every central route.

**The client names a story's id.** MCStory writes a story with a UUID it generated, so a story
keeps one id whether it was first written locally or centrally; an id already stored answers
`409 story_exists`. The server stamps `created_at` and `awarded_at` from its own clock, like
MCLog's log.

**An achievement is awarded once.** Keyed by `(player_uuid, achievement_key)`; awarding it again
answers `{awarded: false}` with the row already held, so the plugin can tell a new award from a
repeat without a second call.

## Tasks

| # | Title | Branch |
|---|---|---|
| 1 | This record | `plan/mcstory-central` |
| 2 | `/api/mcstory` routes, migration `008-central-mcstory`, tests and docs | `feat/central-mcstory` |
| 3 | Release 0.2.0 | `release/0.2.0` |

The client half — `io.github.mcipos.mcstory.common.central` — lands in MCIpos/mcstory.

## Log

### Task 1 — plan/mcstory-central

This record and its row in `.agents/index/memory-index.md`.

### Task 2 — feat/central-mcstory

Migration `008-central-mcstory` (`mcstory_stories`, `mcstory_achievements`), their types in
`src/db/schema.ts`, and `src/modules/central/mcstory/` (repository, router, index) mounted at
`/api/mcstory` behind the guard. `test/central-mcstory.test.ts` covers archive-once with `409`,
newest-first and per-player reads, award-once with `201`/`200`, malformed keys and players, and
the secret. Checked end to end against MCStory's Java `CentralStoryStore`. `central-api.md` and
`data-model.md` describe the routes and tables.
