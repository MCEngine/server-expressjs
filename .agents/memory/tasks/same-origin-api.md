---
name: memory-tasks-same-origin-api
description: This repository's entries in the same-origin API plan — the plan table itself lives in MCEngine/client-reactjs.
---

# Task: One origin, documented as such — server-expressjs entries

**The plan table is not here.** It lives in `MCEngine/client-reactjs` at
`.agents/memory/tasks/same-origin-api.md`, because the variables that caused the outage are the
panel's. What this repository contributed is the other half of the false claim: its own
documentation said `PANEL_ORIGIN` governs CORS, and it governs nothing.

Tasks 4 and 5 of that plan are this repository's.

## Entries

### Task 4 — docs/panel-origin

`wiki/environments/env.md` gained a section under the `PANEL_ORIGIN` row: there is no CORS
layer in this service, the preflight is answered by Express's default, and the refresh cookie is
`SameSite=Lax` in code. `wiki/environments/deployment.md` had the sentence that caused this —
"`PANEL_ORIGIN` … is what the service allows cross-origin requests from" — replaced, and the
variable dropped from the `docker run` and compose examples, since showing it there taught the
same thing more quietly. `.env.example` and the field's comment in `src/config.ts` now say it is
validated and read by nothing.

`.agents/memory/decisions/no-cors-layer.md` records the state, why the panel's image makes it a
non-problem, and what adding CORS would actually take.

No behaviour changed: no middleware, no cookie attribute, no variable removed. `PANEL_ORIGIN`
still validates exactly as it did.
