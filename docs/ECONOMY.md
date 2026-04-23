# Economy API

## Endpoint

`POST /api/economy`

## Authentication

All requests require a valid token in the JSON body.

```json
{
  "token": "YOUR_API_TOKEN"
}
```

## Actions

<details>
<summary><strong>get_coin</strong> — retrieve current balances</summary>

```json
{
  "token": "YOUR_API_TOKEN",
  "action": "get_coin",
  "account_type": "player",
  "account_uuid": "player-123"
}
```

Response example:

```json
{
  "account_type": "player",
  "account_uuid": "player-123",
  "balances": {
    "coin": 0,
    "copper": 0,
    "silver": 0,
    "gold": 0
  }
}
```

</details>

<details>
<summary><strong>add_coin</strong> — add currency to an account</summary>

```json
{
  "token": "YOUR_API_TOKEN",
  "action": "add_coin",
  "account_type": "player",
  "account_uuid": "player-123",
  "coin_type": "gold",
  "amount": 5
}
```

Response example:

```json
{
  "message": "Coin added",
  "balance": "5"
}
```

</details>

<details>
<summary><strong>minus_coin</strong> — deduct currency from an account</summary>

```json
{
  "token": "YOUR_API_TOKEN",
  "action": "minus_coin",
  "account_type": "player",
  "account_uuid": "player-123",
  "coin_type": "gold",
  "amount": 2
}
```

Response example:

```json
{
  "message": "Coin deducted",
  "balance": "3"
}
```

</details>

<details>
<summary><strong>create_account</strong> — verify or create an economy account</summary>

```json
{
  "token": "YOUR_API_TOKEN",
  "action": "create_account",
  "account_type": "player",
  "account_uuid": "player-123"
}
```

Response example:

```json
{
  "message": "Account verified/created",
  "account_uuid": "player-123"
}
```

</details>

## Notes

- `account_type` defaults to `player`.
- `coin_type` values include `coin`, `copper`, `silver`, and `gold`.
- `amount` should be a numeric value.
