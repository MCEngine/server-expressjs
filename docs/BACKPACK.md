# Backpack API Documentation

The Backpack API manages player backpack storage and access logging.

## Endpoint
`POST /api/backpack`

## Actions

<details>
<summary><strong>get</strong> — retrieve or initialize a backpack</summary>

Automatically creates a record with `null` contents if the UUID doesn't exist.

```json
{
  "token": "YOUR_API_TOKEN",
  "action": "get",
  "uuid": "backpack-uuid-123",
  "player_uuid": "player-uuid-456"
}
```

Response example:

```json
{
  "uuid": "backpack-uuid-123",
  "contents": "SGVsbG8gV29ybGQh",
  "updated_at": "2026-04-23T10:30:00.000Z",
  "message": "Existing backpack record found"
}
```

</details>

<details>
<summary><strong>save</strong> — update backpack contents</summary>

```json
{
  "token": "YOUR_API_TOKEN",
  "action": "save",
  "uuid": "backpack-uuid-123",
  "player_uuid": "player-uuid-456",
  "contents": "SGVsbG8gV29ybGQh"
}
```

Response example:

```json
{
  "message": "Backpack updated",
  "uuid": "backpack-uuid-123"
}
```

</details>

<details>
<summary><strong>bulk_logs</strong> — log multiple actions at once</summary>

**Endpoint:** `POST /api/backpack/logs`

```json
{
  "token": "YOUR_API_TOKEN",
  "logs": [
    {
      "backpack_uuid": "uuid-1",
      "player_uuid": "player-1",
      "action": "get"
    },
    {
      "backpack_uuid": "uuid-2",
      "player_uuid": "player-1",
      "action": "save"
    }
  ]
}
```

Response example:

```json
{
  "message": "Successfully logged 2 entries",
  "count": 2
}
```

</details>

## Notes

- `uuid`: The unique identifier for the backpack itself.
- `player_uuid`: Required for tracking who accessed the backpack (logged in `backpack_logs`).
- `contents`: Items stored as a base64 string.
- Every request is logged for audit purposes.
- The `get` action will return `contents: null` and `message: "New backpack record created"` if it's the first time the UUID is accessed.
