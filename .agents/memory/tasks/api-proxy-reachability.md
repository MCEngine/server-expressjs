---
name: memory-tasks-api-proxy-reachability
description: This repository's entries in the API proxy reachability plan — the plan table itself lives in MCEngine/client-reactjs.
---

# Task: An image that can reach its API anywhere — server-expressjs entries

**The plan table is not here.** It lives in `MCEngine/client-reactjs` at
`.agents/memory/tasks/api-proxy-reachability.md`, because the defect was in the panel's image:
its nginx resolved names through Docker's embedded DNS, which does not exist on the platform it
was deployed to, so every `/api` request returned `502` from a server that was healthy.

This service was never at fault. Tasks 5 and 6 of that plan are its share: the deployment page
said nothing about running on a host that builds the image for you, and nothing about the one
question that follows from it — where the demo account is, when a fresh deployment shows none.

## Entries

### Task 5 — docs/render-deployment

`wiki/environments/deployment.md` gained *On a host that builds and runs the image for you*: the
four things that decide whether a hosted deployment works — `JWT_SECRET`, a disk at `/data`,
`PORT`, and `DEMO_ACCOUNT_ENABLED` — and a Render paragraph carrying two facts from its
documentation: private traffic to port `10000` always reaches a web service's primary HTTP
server whatever it binds, and a free web service can send private network traffic but not
receive it, which is why the panel may have to reach this service at its public URL.

**The demo account is off unless asked for.** A live deployment had `GET /api/v1/meta` answering
`{"demo_account":null}` and a sign-in page with no credentials on it, which is the flag not being
set and not a fault. The row says so where someone deploying will read it.

No code changed.
