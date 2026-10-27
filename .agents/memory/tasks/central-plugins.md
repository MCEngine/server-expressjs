---
name: memory-tasks-central-plugins
description: The central server for every MCEngine-family Minecraft plugin — routes each plugin's central client calls, the shared-secret guard, and the ask_global brain; the confirmed plan across six repositories.
---

# Task: one central server for every plugin, and a brain behind `ask_global`

## Why

Asked for: every plugin sends its data to this server when its config says

```yaml
database:
  type: "central"
central_server:
  url: "https://api.server.com"
  token: ""
  timeout_seconds: 120
```

and MCAgents gains an `ask_global` tool that hands a question, with the caller's OpenRouter key,
to an agent running here — one that can search a RAG store and the web — so the game server's
agent and the central one are two brains rather than one.

## The decisions that were not in the request

**The server matches the clients already released.** Seven plugins shipped central clients before
this server served any of them: MCIdentity and its skill, cosmetic and rune add-ons call `/v1/...`;
MCEconomy calls `POST /api/economy`; Market and SlayerRewards call `POST /api/economy/market` and
`POST /api/economy/slayerrewards` with an `action` field. MCAgents calls `/api/mcagents/...`. Those
paths and payloads are implemented as they are, so released plugins work against this server
unchanged. New clients use `/api/{plugin}/...`.

**A shared secret, not an account token.** Every plugin's config already says its token matches
"the central server SERVER_API_TOKEN value". The central routes are mounted only when
`SERVER_API_TOKEN` is set, compared in constant time; the MCPluginManager accounts and scoped
tokens are untouched. One deployment serves one network.

**Integer ids where the clients parse integers.** Currencies, AI platforms and log rows are
numbered by the plugins' own schemas, so their tables here use an auto-increment key instead of
a ULID.

**The brain spends the caller's key and stores none.** `ask_global` carries the player's own
OpenRouter key; it is used for that request and never written down.

## The plan

| # | Title | Repository | Branch | PR |
|---|---|---|---|---|
| 1 | Task record | `server-expressjs` | `chore/central-plugins-plan` | |
| 2 | Shared-secret guard, MCIdentity family routes | `server-expressjs` | `feat/central-identity` | |
| 3 | Economy, Market and SlayerRewards routes | `server-expressjs` | `feat/central-economy` | |
| 4 | MCAgents data routes | `server-expressjs` | `feat/central-mcagents` | |
| 5 | Membership, chat sessions, package state, MCLog store | `server-expressjs` | `feat/central-network-data` | |
| 6 | The brain: `ask_global` and the knowledge store | `server-expressjs` | `feat/central-brain` | |
| 7 | Release 0.1.0 | `server-expressjs` | `release/0.1.0` | |
| 8 | `common.central`, `ask_global`, release 6.6.0 | `MCPaimon/mcagents` | `feat/central-package`, `feat/ask-global`, `release/6.6.0` | |
| 9 | Central chat sessions, release 0.5.0 | `MCPaimon/mcagents-chat` | `feat/central-sessions`, `release/0.5.0` | |
| 10 | Central membership backend, release 1.5.0 | `MCNaberius/mcmembership` | `feat/central-backend`, `release/1.5.0` | |
| 11 | Central package state, release 0.5.0 | `MCSeere/mcpackage` | `feat/central-state`, `release/0.5.0` | |
| 12 | Central log store, release 0.3.0 | `MCVassago/mclog` | `feat/central-store`, `release/0.3.0` | |

Tasks 1–7 merge first: every plugin task calls routes that land in 2–6.

## Entries

### Task 1 — chore/central-plugins-plan

This record and its row in `.agents/index/memory-index.md`. Nothing else.

### Task 2 — feat/central-identity

`SERVER_API_TOKEN` (optional, ≥ 16, empty = unset) and `requireServerToken`, mounted per prefix
by `mountCentral` so it never sees an `/api/v1` request. Migration `003-central-identity` with
eleven `mcidentity_*` tables, and `DialectTypes.serial` for auto-numbered keys. Every `/v1`
route the MCIdentity, skill, rune and cosmetic clients call. `wiki/information/central-api.md`
is new and later tasks append their families to it.

### Task 3 — feat/central-economy

Migration `004-central-economy` (`mceconomy_*`, `market_items`, `slayerrewards_*`) and
`serialPrimaryKey(t)` in `src/db/types.ts`, which 003 now uses too. The three action-dispatch
endpoints under `/api/economy`. Upserts are select-then-write inside a transaction, never
`onConflict`, because MySQL spells it differently. Money travels as a string and anything a JS
number would round is refused.

### Task 4 — feat/central-mcagents

Migration `005-central-mcagents` (`mcagents_*`) and the `/api/mcagents` routes the released
`MCAgentsAPI` client calls. Creating a platform is find-or-create by name, because every server
asks for `openrouter` on start. `src/db/serial.ts` adds `insertSerial`, which asks the adapter
whether it supports `RETURNING` so a new row's numeric id is portable to MySQL.

### Task 5 — feat/central-network-data

Migration `006-central-network-data` and four new route families, each designed here because
their plugins had no central client yet: `/api/mcmembership`, `/api/mcagents-chat`,
`/api/mcpackage` (per server id, project id in the body) and `/api/mclog` (logs, embeddings,
cosine search). `src/lib/vectors.ts` holds the cosine and top-k the brain reuses.

### Task 6 — feat/central-brain

`POST /api/mcagents/ask_global` and the knowledge pages, in `src/modules/central/brain/`: an
OpenAI-compatible client over `fetch` (redirects refused), a service looping over two tools
(`search_knowledge` across knowledge pages and MCLog's log; `web_search` through OpenRouter's web
plugin) for at most `CENTRAL_AGENT_MAX_STEPS`, the last round without tools. Migration
`007-central-knowledge`, four `CENTRAL_*` env keys, and `errors.badGateway` for an upstream
failure. A caller-chosen `api_url` goes through `assertFetchable`. The caller's key is never
stored.
