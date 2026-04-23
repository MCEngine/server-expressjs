# Membership API

## Endpoint

`POST /api/membership`

## Authentication

All requests require a valid token in the JSON body.

```json
{
  "token": "YOUR_API_TOKEN"
}
```

## Actions

<details>
<summary><strong>membership_check</strong> — check current membership tier</summary>

```json
{
  "token": "YOUR_API_TOKEN",
  "action": "membership_check",
  "account_type": "player",
  "account_uuid": "player-123"
}
```

Response example:

```json
{
  "account_type": "player",
  "account_uuid": "player-123",
  "tier": "standard"
}
```

</details>

<details>
<summary><strong>membership_set</strong> — update or create membership tier</summary>

```json
{
  "token": "YOUR_API_TOKEN",
  "action": "membership_set",
  "account_type": "player",
  "account_uuid": "player-123",
  "tier": "gold",
  "days": 30
}
```

Response example:

```json
{
  "message": "Membership updated",
  "account_type": "player",
  "account_uuid": "player-123",
  "tier": "gold",
  "expires": "2026-05-23T12:34:56.789Z"
}
```

</details>

## Notes

- `account_type` defaults to `player` when omitted.
- `days` is optional; omitting it creates a membership without expiration.
