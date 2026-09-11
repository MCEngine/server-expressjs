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
