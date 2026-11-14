---
name: memory-tasks-mcidentity-profession-wearing
description: MCIdentity 5.0.0 replaces identities with wearable professions keyed by the player UUID; the central routes and tables follow, with no data migration.
---

# Task: MCIdentity profession wearing

## Why

MCIdentity 5.0.0 drops identity UUIDs, aliases, sessions, base slots and the isolated
inventory and enderchest. A player has one character, keyed by the player UUID, and wears one
profession at a time. Its central client now calls player keyed routes, so the
`/v1/identities/...` core routes and their tables go.

## The decisions that were not in the request

The owner was away and asked for the recommended option at every fork.

**No data migration.** Nothing is in production (owner, 2026-11-14), so migration `003` is
rewritten in place: the identity, stats, session, log and base slot tables are replaced, and no
legacy table or copy is kept.

**Routes follow the 5.0.0 client exactly.** `POST /v1/players` creates only when absent;
`GET`/`PUT /v1/players/:uuid/stats` (with `statPoints`), `GET .../stats/:key`,
`POST .../stats/:key/add`; `GET`/`PUT .../profession`; `GET`/`PUT
.../professions/:code/progress`; `POST /v1/profession-logs`. Reads answer `404` when nothing is
stored.

**Add-on routes stay at their paths.** `/v1/identities/:uuid/{skills,runes,cosmetics}` and the
skill and rune catalogues keep their paths, so the add-ons need no route change; the UUID they
carry is now the player UUID.

## Tasks

| # | Title | Branch |
|---|---|---|
| 1 | This record | `plan/profession-wearing` |
| 2 | Player keyed tables and routes, tests and docs | `refactor/profession-wearing` |
| 3 | Release 0.6.0 | `release/0.6.0` |

## Log

### Task 1 — plan/profession-wearing

This record and its row in `.agents/index/memory-index.md`.

### Task 2 — refactor/profession-wearing

Migration `003` rewritten in place: `mcidentity_player_stats`, `mcidentity_player_professions`,
`mcidentity_player_profession_progress` and `mcidentity_profession_logs` replace the identity,
stats, session, log and base slot tables; the add-on slot and cosmetic tables key by
`player_uuid`. The repository and routes serve the 5.0.0 client's player routes; the old
identity, alias, session, base slot and `/v1/logs` routes are gone. Tests rewritten (358 pass);
`central-api.md` and `data-model.md` updated.
