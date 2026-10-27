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
