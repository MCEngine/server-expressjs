---
name: memory-tasks-mcstory-story-edits
description: Read and update one MCStory story by id, so /story create <prompt> can update an existing story with database.type central — the confirmed plan across MCIpos/mcstory and this repository.
---

# Task: read and update one MCStory story

## Why

Asked for: MCStory gains `/story create <prompt>` and an MCAgents tool for the same, where the
agent either adds a new story or updates an existing one and saves it. With
`database.type: central` the archive lives here, under `/api/mcstory/stories`, which can only
insert and list — nothing reads one story by id or changes one.

## The decisions that were not in the request

The owner was away and asked for the recommended option at every fork.

**By id, under `/stories/:id`.** `GET` reads one story, `PUT` replaces its title, content,
account and source. The id is the UUID MCStory generated, already the primary key.

**`created_at` is kept.** An update is the same story, so it keeps the time it was first
archived; no `updated_at` column is added, so no migration.

**`PUT` never creates.** A missing id answers `404 story_not_found`, so a mistyped id cannot
archive a second story; creating stays `POST /stories`.

## Tasks

| # | Title | Branch |
|---|---|---|
| 1 | This record | `plan/mcstory-story-edits` |
| 2 | `GET`/`PUT /stories/:id`, repository `story` + `updateStory`, tests and docs | `feat/story-edits` |
| 3 | Release 0.5.0 | `release/0.5.0` |

The client half lands in MCIpos/mcstory 0.3.0, after this release.

## Log

### Task 1 — plan/mcstory-story-edits

This record and its row in `.agents/index/memory-index.md`.

### Task 2 — feat/story-edits

`CentralStoryRepository.story(id)` and `updateStory(id, edit)` (one transaction; keeps `id` and
`created_at`), with `GET /stories/:id` and `PUT /stories/:id` (`404 story_not_found` for both;
the update body takes the same fields and account-pair rule as `POST`). Two tests cover reading,
updating, moving a story to the world, the `404`s, a malformed id and a half account.
`central-api.md` lists both routes.
