---
name: memory-tasks-org-management
description: Organizations a person can find and administer — the confirmed eight-task plan across two repositories, and the token-ownership hole found on the way.
---

# Task: Organizations a person can find and administer

## Why

The panel's nav gained a link to the organization create page, and the record for it
(`org-nav.md`) said what was still missing: **no endpoint lists the organizations an account
belongs to**, so an organization is reachable after creation only by knowing its handle. The
request now is the whole thing — a page named *Organization* that lists what you are part of and
creates new ones, and a settings area with a separate page per subject.

Checked before planning, rather than assumed:

* `listOrgsForUser(userId)` **already exists** in `src/modules/identity/repository.ts`. No route
  exposes it. `GET /me/orgs` is a route, not a feature.
* `PATCH /accounts/:handle` and `PUT /accounts/:handle/handle` already call
  `assertMayAdminister`, so an org admin can already edit an org's profile and handle. A
  `setting/general` page needs no server change.
* `GET /orgs/:handle/members` and the member write routes already exist, so does
  `GET /orgs/:handle/settings`. A `setting/member` page needs no server change either.
* Tokens are the exception, and finding out why turned up a security defect.

## The token-ownership hole

`POST /api/v1/tokens` reads `ownerAccountId` from the request body:

```ts
ownerAccountId: body.ownerAccountId ?? actor.accountId,
```

and **nothing checks it**. `createApiToken` validates the scopes and writes the row.

`GET /accounts/:handle` is public and returns the account id, so the id of any user is a
request away. A signed-in person can therefore mint a token whose `owner_account_id` is somebody
else's account — and `authenticate()` returns that owner as the actor, so the token *is* that
person: their org memberships, their private products, their right to publish jars that
Minecraft servers download and execute.

The fix is the rule the identity routes already use for exactly this question,
`assertMayAdminister`: your own account, or an organization you administer. It is lifted out of
`createIdentityRouter` into a module both routers share rather than written twice.

**Org-owned tokens are then made to work, because the settings page needs them to.** Today a
token owned by an org authenticates as the org, and `requireRole(orgId, callerId, role)` looks
for a membership row that an org has never had for itself — so the token can do nothing. An
org-owned token is the right shape for CI (it does not stop working when a person leaves), so
`requireRole` treats the org acting for itself as `owner`. A session actor's account id is a
user id and can never equal an org id, so that branch is reachable only by a token the org
itself owns, minted by an admin.

## The plan

| # | Title | Scope | Repository | Branch | Files / areas | PR |
|---|---|---|---|---|---|---|
| 1 | Task record | This file and its index row | `server-expressjs` | `chore/org-management-plan` | `.agents/memory/` | |
| 2 | Who a token may belong to | Authorize `ownerAccountId`; share one rule between routers | `server-expressjs` | `fix/token-owner` | `src/modules/identity/authorize.ts`, `src/modules/auth/routes.ts`, `src/app.ts`, `test/` | |
| 3 | Tokens an organization owns | `/orgs/:handle/tokens` list, mint, revoke; a self-owned org token carries the org's rights | `server-expressjs` | `feat/org-tokens` | `src/modules/auth/routes.ts`, `src/modules/identity/service.ts`, `wiki/information/api-contract.md`, `test/` | |
| 4 | The organizations you are in | `GET /me/orgs`, handle and role included | `server-expressjs` | `feat/org-listing` | `src/modules/identity/`, `wiki/information/api-contract.md`, `test/` | |
| 5 | Release | Changelog, state, close this record | `server-expressjs` | `chore/org-management-release` | `wiki/logs/0/0/0/CHANGELOG.md`, `.agents/memory/state/` | |
| 6 | The Organization page | Nav says *Organization*; `/org` lists what you are in and creates one | `client-reactjs` | `feat/organization-page` | `src/App.tsx`, `src/routes/org/`, `test/` | |
| 7 | A settings page per subject | `/org/:handle/settings` plus `setting/general`, `setting/member`, `setting/token` | `client-reactjs` | `feat/org-settings` | `src/routes/org/`, `src/App.tsx`, `test/` | |
| 8 | Release | Changelog, state, close the panel's record | `client-reactjs` | `chore/org-management-release` | `wiki/logs/0/0/0/CHANGELOG.md`, `.agents/memory/state/` | |

Tasks 1–5 stack here and merge first: 6 and 7 call routes that do not exist until 3 and 4 land.

The panel's settings routes mirror the shape its product pages already use —
`/product/:id/settings` as the landing and `/product/:id/setting/{subject}` for each page — so
organizations and products are administered the same way rather than two ways.

## Entries

### Task 1 — chore/org-management-plan

This record and its row in `.agents/index/memory-index.md`. Nothing else.

### Task 2 — fix/token-owner

`src/modules/identity/authorize.ts` is new and holds `assertMayAdminister`, lifted out of
`createIdentityRouter` so the token route asks the same question rather than a second version of
it. `POST /tokens` now authorizes `ownerAccountId` through it, and fails closed when no identity
service is wired.

`test/token-owner.test.ts` was run against the previous code before being kept: three of its five
cases failed there, including minting a token owned by an account whose id was read from the
public `GET /accounts/:handle`. The contract now states the rule next to the route.

### Task 3 — feat/org-tokens

`GET|POST|DELETE /orgs/:handle/tokens`, all `admin`+, in the auth router because it owns tokens.
`requireRole` gained one branch: an organization acting for itself is `owner`. That is what makes
an org-owned token work at all — an org has never had a membership row for itself — and it grants
nothing on the governance routes, because `requireSession` refuses an API token outright with
`session_required`.

Five cases, and two of them are the ones that matter: an org token publishes to its own org's
product, and is `404` on another org's. A third asserts the token cannot rename the org or mint
another token.

The first version of that branch was `if (orgId === userId) return 'owner'`, and `product.test.ts`
caught it: `requireRole` is also called with an account that turns out to be a **user** — creating
a product under your own handle — and answering `owner` there let the caller past a check meant to
stop them, turning a `404` into a `400`. The branch now confirms the account is an organization
first. The reasoning that missed it was "a session actor's account id can never equal an org's",
which is true and was not the case that broke.

### Task 4 — feat/org-listing

`GET /me/orgs`, session only, returning `{ role, joined_at, org }` per membership — the same
shape as `GET /orgs/:handle/members` returns for a member, so the panel reads both the same way.
The repository query already existed; the service method and the route are the whole change.

Under `/me` rather than `/orgs` deliberately: it is a fact about the caller, not a listing of
organizations, and there is no route that lists organizations. Four cases, including that an API
token is refused — `session_required` — and that the list is the caller's own rather than
everyone's.

### Task 5 — chore/org-management-release

The changelog entries, the state file, and this record. `0.0.0` did not move. The panel's three
tasks follow and depend on tasks 3 and 4 being merged first.
