# Server ExpressJS API

This repository exposes two API groups for player membership and economy operations.

## Overview

- `POST /api/membership` — membership tier lookup and updates
- `POST /api/economy` — coin balance, add/remove currency, and account creation
- `POST /api/backpack` — backpack item storage with multi-thread locking support

## Documentation

- [Membership API](docs/MEMBERSHIP.md)
- [Economy API](docs/ECONOMY.md)
- [Backpack API](docs/BACKPACK.md)

## Authentication

All API requests require a valid token in the JSON body.

```json
{
  "token": "YOUR_API_TOKEN"
}
```

## Notes

- `account_type` defaults to `player` when omitted.
- The API is protected by `API_TOKEN` from `.env`.
