# Central Plugin API

[← Back to README](../../README.md)

The routes the Minecraft plugins call when their `config.yml` says

```yaml
database:
  type: "central"
central_server:
  url: "https://api.server.com"   # this service, no trailing slash
  token: ""                       # this service's SERVER_API_TOKEN
  timeout_seconds: 120
```

They are a second API beside the [MCPluginManager contract](api-contract.md), with its own
credential and its own paths. Nothing here touches an account, a product or a fleet server.

## Turning it on

Set `SERVER_API_TOKEN` (at least 16 characters) — see [Environment Variables](../environments/env.md).
**Unset, none of these routes exist**: they answer `404 route_not_found` like any unknown path,
because a network's economy and inventories are not something to serve without a credential.

Every request carries `Authorization: Bearer <SERVER_API_TOKEN>`. A missing or wrong token is
`401 invalid_server_token`. The comparison is constant-time. `GET /health` stays
unauthenticated, and the plugins call it on start to check the server is reachable.

## Paths are the plugins', not this service's

Several plugins shipped their central clients before this server served them, so each family
is mounted at the prefix its released client already calls, rather than under `/api/v1`:

| Plugin | Prefix | Style |
|---|---|---|
| MCIdentity, MCIdentitySkill, MCIdentityRune, MCIdentityCosmetic | `/v1` | REST, camelCase fields |
| MCEconomy, Market, SlayerRewards | `/api/economy` | One `POST` per plugin, the operation named by `action`, snake_case fields |
| MCAgents | `/api/mcagents` | REST, snake_case fields, keys in the query string on reads |
| MCMembership | `/api/mcmembership` | REST, snake_case |
| MCAgentsChat | `/api/mcagents-chat` | REST, snake_case |
| MCPackage | `/api/mcpackage` | REST, snake_case |
| MCLog | `/api/mclog` | REST, snake_case |

Errors use the [same envelope](api-contract.md#errors) as the rest of the service. A schema
rejection is `400 validation_failed` with the failing fields.

## MCIdentity family — `/v1`

Reads answer `404` when there is nothing to read; the client turns that into its neutral value
(empty, zero). Writes answer `204` unless noted.

| Method | Path | Body | Answer |
|---|---|---|---|
| `POST` | `/v1/professions` | `{systemCode, displayName}` | `204`. A code already registered keeps its first name. |
| `GET` | `/v1/professions` | | `[{systemCode, displayName}]` |
| `POST` | `/v1/identities` | `{uuid, professionCode, properties: {level, exp, statPoints, headText}, stats: {…nine}}` | `201`; `409 identity_exists`; `422 unknown_profession` |
| `GET` | `/v1/identities/:uuid` | | `{uuid, professionCode}` |
| `GET` | `/v1/identities/:uuid/properties` | | `{alias, level, exp, statPoints, headText, inventoryContents, enderchestContents}` |
| `PUT` | `/v1/identities/:uuid/properties` | the same, without `alias` | |
| `PUT` | `/v1/identities/:uuid/alias` | `{alias}`, `null` clears | `409 alias_taken` when another identity holds it, ignoring case |
| `GET` | `/v1/identities/alias/:alias` | | `{uuid}`, matched ignoring case |
| `GET` | `/v1/identities/:uuid/stats` | | `{energy, health, food, strength, defense, wisdom, luck, agility, resilience}` |
| `PUT` | `/v1/identities/:uuid/stats` | all nine | |
| `GET` | `/v1/identities/:uuid/stats/:key` | | `{value}`; an unknown key is `400 unknown_stat` |
| `POST` | `/v1/identities/:uuid/stats/:key/add` | `{amount}` | Added in one statement, so concurrent adds all land |
| `GET` | `/v1/players/:uuid/session` | | `{identityUuid, contentKey}` |
| `PUT` | `/v1/players/:uuid/session` | `{identityUuid, contentKey}` | `null` identity ends the session. An identity is worn by one player: it is taken off anyone else. |
| `PATCH` | `/v1/players/:uuid/session/content-key` | `{contentKey}` | |
| `GET` | `/v1/players/:uuid/base-slots` | | `{slots}`, `0` for a player never seen |
| `POST` | `/v1/players/:uuid/base-slots/add` | `{amount}` | `{slots}`, never below zero |
| `POST` | `/v1/logs` | `{playerUuid, identityUuid, actionType}` | |
| `POST` | `/v1/skills`, `/v1/runes` | `{systemCode, displayName, item}` | Registering again replaces the name and item |
| `GET` | `/v1/skills`, `/v1/runes` | | `[{systemCode, displayName, item}]` |
| `GET` | `/v1/identities/:uuid/skills`, `…/runes` | | `{"<slot>": "<code>"}` |
| `PUT` | `/v1/identities/:uuid/skills/:slot` | `{skillItem}`, `null` clears | |
| `PUT` | `/v1/identities/:uuid/runes/:slot` | `{runeCode}`, `null` clears | |
| `GET` | `/v1/identities/:uuid/cosmetics` | | `{skin, aura}`, both `null` when nothing is saved |
| `PUT` | `/v1/identities/:uuid/cosmetics` | `{skin}` and/or `{aura}` | A field left out is kept; a field sent as `null` is cleared |

## MCEconomy, Market and SlayerRewards — `/api/economy`

One endpoint per plugin. The body names the operation in `action`; an action the server does
not know is `400 unknown_action`, with the known ones in `details.known`. Money is a Java `long`
and travels as a **string** both ways. A value a JavaScript number cannot hold exactly (past
2^53) is refused with `400` rather than rounded.

### `POST /api/economy` — MCEconomy

| `action` | Fields | Answer |
|---|---|---|
| `create_account` | `account_type`, `account_uuid` | `{account}`; an existing account is returned as it is |
| `get_account` | `account_type`, `account_uuid` | `{account}`, `null` when there is none |
| `create_currency` | `system_code`, `display_name`, `is_transferable` | `{currency}` with its numeric `id`; a known code has its name and flag updated |
| `get_currencies` | | `{currencies: [...]}` |
| `get_wallet` | `account_type`, `account_uuid`, `currency_id` | `{wallet}`, opened at `"0"` (with its account) the first time; `404 currency_not_found` |
| `set_wallet` | the same and `amount` | `{wallet}` |
| `insert_log` | `account_type`, `account_uuid`, `scope`, `currency_id`, `amount`, `transaction_uuid`, `reference_type`, `reference_id` | `{success: true}` |

### `POST /api/economy/market` — Market

| `action` | Fields | Answer |
|---|---|---|
| `save_item` | `market_name`, `item_index`, `metadata`, `buy_price`, `sell_price`, `currency`, `amount` | `{success: true}`; replaces the item at that index |
| `get_item` | `market_name`, `item_index` | `{item}`, `null` when there is none |
| `get_items` | `market_name` | `{items}`, by index |
| `list_markets` | | `{markets}`, by name |
| `delete_item` | `market_name`, `item_index` | `{success}`: whether there was one to delete |

### `POST /api/economy/slayerrewards` — SlayerRewards

| `action` | Fields | Answer |
|---|---|---|
| `log_kill` | `player_uuid`, `mob_type`, `world`, `x`, `y`, `z` | `{success: true}` |
| `log_reward` | `player_uuid`, `mob_type`, `currency`, `amount` | `{success: true}` |
| `get_kills` | `player_uuid`, `limit` (1–1000) | `{kills}`, newest first |
| `get_rewards` | `player_uuid`, `limit` (1–1000) | `{rewards}`, newest first |

## MCAgents — `/api/mcagents`

Rows come back as the plugin's own backends store them, snake_case. A lookup that finds nothing
is `404`, which the client reads as "none". An account is (`account_type`, `account_uuid`):
`player`, `guild` or `server` and an id of up to 64 characters.

| Method | Path | Body or query | Answer |
|---|---|---|---|
| `POST` | `/platforms` | `{display_name, url}` | The platform. **Find or create**: every server on a network asks for `openrouter` on start, and the second one gets the first one's row |
| `GET` | `/platforms` | | `[platform]` |
| `GET` | `/platforms/:id` | | `{id, display_name, url, created_at, updated_at}` |
| `POST` | `/models` | `{platform_id, model_id}` | The model, registered once |
| `GET` | `/models` | `?platform_id` | `[model]` |
| `GET` | `/models/find` | `?platform_id&model_id` | `{platform_id, model_id, …}` |
| `POST` | `/accounts` | `{account_type, account_uuid, platform_id, token}` | The account; a second save replaces the token |
| `GET` | `/accounts` | `?account_type&account_uuid&platform_id` | The account |
| `DELETE` | `/accounts` | `?account_type&account_uuid` | `204`; every platform's key for that account |
| `POST` | `/sessions` | `{account_type, account_uuid, platform_id, model_id}` | `204`; the account's one active model |
| `GET` | `/sessions` | `?account_type&account_uuid` | The session |
| `POST` | `/logs` | `{account_type, account_uuid, platform_id, model_id, chat_history, token_total_usage}` | `201` and the log with its numeric `id` |
| `GET` | `/logs` | `?account_type&account_uuid&limit` | Newest first; `limit` 1–500, default 20 |
| `POST` | `/prompts` | `{account_type, account_uuid, prompt_id, prompt, tools}` | The stored prompt; an id that exists is left as it is |
| `GET` | `/prompts/find` | `?account_type&account_uuid&prompt_id` | The prompt |
| `GET` | `/prompts` | `?account_type&account_uuid` | By `prompt_id` |
| `PUT` | `/prompts/tools` | `{account_type, account_uuid, prompt_id, tools}` | The prompt |
| `DELETE` | `/prompts` | `?account_type&account_uuid&prompt_id` | `204` |

**The `token` column is never a usable key.** MCAgents encrypts every stored key with its own
`token.secret` before it leaves the game server, so this table holds ciphertext only.

## MCMembership — `/api/mcmembership`

| Method | Path | Body or query | Answer |
|---|---|---|---|
| `PUT` | `/memberships` | `{account_type, account_uuid, type, ended_time}`; `null` never ends | `{membership}`; replaces one of the same type |
| `GET` | `/memberships/find` | `?account_type&account_uuid&type` | `{membership}` |
| `GET` | `/memberships` | `?account_type&account_uuid` | `{memberships}`, by type |
| `POST` | `/memberships/archive` | `{account_type, account_uuid, type}` | `{archived}`: whether there was one to move to the archive |

## MCAgentsChat — `/api/mcagents-chat`

An open chat session — its mode, model and the conversation so far — so it follows a player
from one game server to the next. The id is the player's UUID, or the server's for the console.

| Method | Path | Body | Answer |
|---|---|---|---|
| `GET` | `/sessions/:id` | | `{session_id, mode, model_id, turns: [{role, content}], total_tokens, updated_at}` |
| `PUT` | `/sessions/:id` | `{mode: "CHAT" or "ASK", model_id, turns, total_tokens}` | `204`; replaces the session |
| `DELETE` | `/sessions/:id` | | `204` |

## MCPackage — `/api/mcpackage`

What each game server has installed. A server is the UUID MCPackage generates once in its data
folder. The project id travels in the body, because a GitHub project is `owner/repo`.

| Method | Path | Body or query | Answer |
|---|---|---|---|
| `GET` | `/servers/:serverId/packages` | `?platform` optional | `{packages: [{platform, project_id, version_id, version, file_name, installed_at}]}` |
| `PUT` | `/servers/:serverId/packages` | one record | `204`; replaces the record of that platform and project |

## MCLog — `/api/mclog`

One log for the whole network, embedded for search. Model names are lower-cased before they are
stored. Search ranks every log embedded with the same model by cosine similarity.

| Method | Path | Body or query | Answer |
|---|---|---|---|
| `POST` | `/logs` | `{contents}` | `201 {id, contents, created_at}` |
| `GET` | `/logs` | `?limit` (1–500) | `{logs}`, newest first |
| `GET` | `/logs/count` | | `{count}` |
| `PUT` | `/logs/:id/embeddings` | `{model_name, embedding: [numbers]}` | `204`; `404 log_not_found` |
| `POST` | `/logs/search` | `{model_name, embedding, limit}` | `{matches: [{id, contents, created_at, similarity}]}`, best first |
