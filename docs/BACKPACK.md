# Backpack API Documentation

The Backpack API manages player backpack storage and access logging.

## Endpoint

`POST /api/backpack`

## Authentication

All requests require a valid Bearer token in the `Authorization` header.

```http
Authorization: Bearer YOUR_API_TOKEN
```

## Actions

<details>
<summary><strong>get</strong> — retrieve or initialize a backpack</summary>

Automatically creates a record with `null` contents if the UUID doesn't exist.

```json
{
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
  "is_locked": false,
  "message": "Existing backpack record found"
}
```

*Note: Returns 423 Locked if `is_locked` is true.*

</details>

<details>
<summary><strong>lock</strong> — lock a backpack for access</summary>

Prevents other players/processes from opening or saving to the backpack. Used to prevent item duplication.

```json
{
  "action": "lock",
  "uuid": "backpack-uuid-123",
  "player_uuid": "player-uuid-456"
}
```

Response example (Success):

```json
{
  "message": "Backpack locked",
  "uuid": "backpack-uuid-123"
}
```

Response example (Already Locked - 423):

```json
{
  "error": "Backpack already locked"
}
```

</details>

<details>
<summary><strong>unlock</strong> — release a backpack lock</summary>

```json
{
  "action": "unlock",
  "uuid": "backpack-uuid-123",
  "player_uuid": "player-uuid-456"
}
```

Response example:

```json
{
  "message": "Backpack unlocked",
  "uuid": "backpack-uuid-123"
}
```

</details>

<details>
<summary><strong>save</strong> — update backpack contents</summary>

```json
{
  "action": "save",
  "uuid": "backpack-uuid-123",
  "player_uuid": "player-uuid-456",
  "contents": "SGVsbG8gV29ybGQh"
}
```

Response example:

```json
{
  "message": "Backpack updated and unlocked",
  "uuid": "backpack-uuid-123"
}
```

*Note: Successfully saving a backpack will automatically unlock it.*

</details>

<details>
<summary><strong>bulk_logs</strong> — log multiple actions at once</summary>

**Endpoint:** `POST /api/backpack/logs`

```json
{
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
- `is_locked`: Boolean indicating if the backpack is currently in use.
- Every request is logged for audit purposes.
- The `get` action will return `contents: null` and `message: "New backpack record created"` if it's the first time the UUID is accessed.
- Use `lock` and `unlock` (or `save`) to ensure multi-threaded safety and prevent item duplication.
