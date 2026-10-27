# Changelog — 0.1.0

**2026-10-27** — the central server for every MCEngine-family plugin. A plugin set to
`database.type: "central"` with a `central_server` block now keeps its data here, and MCAgents'
`ask_global` tool reaches a second agent that runs on this server.

## Added

- `SERVER_API_TOKEN` — the shared secret every central route checks, in constant time. With it
  unset, no central route is mounted and the service behaves exactly as 0.0.0.
- The MCIdentity family's `/v1` routes — identities, professions, stats, sessions, logs, base
  slots, skills, runes and their equipped slots, and cosmetics — matching the released clients
  of MCIdentity, MCIdentitySkill, MCIdentityRune and MCIdentityCosmetic.
- `/api/economy`, `/api/economy/market` and `/api/economy/slayerrewards` — the action-dispatch
  endpoints MCEconomy, Market and SlayerRewards already call. Money travels as a string.
- `/api/mcagents` — platforms, models, accounts, sessions, logs and prompts for MCAgents.
- `/api/mcmembership`, `/api/mcagents-chat`, `/api/mcpackage` and `/api/mclog` — new contracts
  for plugins that had no central client yet, including embeddings and cosine search over
  MCLog's log.
- `POST /api/mcagents/ask_global` and `/api/mcagents/knowledge` — the central brain: a tool loop
  over an OpenAI-compatible API with `search_knowledge` (knowledge pages and MCLog's log) and
  `web_search`. It spends the caller's key and stores none.
- `CENTRAL_AGENT_MODEL`, `CENTRAL_EMBEDDING_MODEL`, `CENTRAL_OPENROUTER_URL`,
  `CENTRAL_AGENT_MAX_STEPS`.
- Migrations `003` to `007`, `src/db/serial.ts`, `src/lib/vectors.ts`, and
  `wiki/information/central-api.md`.

## Changed

- `version` in `package.json` from `0.0.0` to `0.1.0`.
- `wiki/information/data-model.md`, `wiki/information/api-contract.md` and
  `wiki/environments/env.md` describe the central tables, routes and keys.
