---
name: memory-tasks-demo-and-landing
description: Task record for the landing page, the demo account, and the register form's confirmation field — the five-task plan across two repositories.
---

# Task: A front door, and a way in without registering

## Goal

Three things a person evaluating the platform hits immediately:

1. `/` is the product catalogue, with no explanation of what any of this is.
2. Trying it means registering an account first.
3. The register form takes a password once, so a typo becomes an account nobody can sign in to.

## Objective

* `/` is a landing page explaining what MCEngine is and how the three pieces fit; the catalogue
  moves to `/products`.
* A demo account can be seeded by the server and is advertised to the panel, so evaluation needs
  no registration — **and register and sign in remain real pages that work**, because testing
  them is the point.
* The register form confirms the password.
* The demo account is off by default and, when on, says what it costs.

## Detail

Two repositories, in order: the server owns whether a demo account exists, so the panel's
sign-in page cannot be written until the endpoint that tells it exists.

`MCEngine/plugin-manager` is untouched.

The version does not move.

## Decisions

| Decision | Value |
|---|---|
| The catalogue | Moves to `/products`; `/` becomes the landing page |
| Demo account | Seeded by the server through the real `register` path, not fixtured in the panel |
| How the panel learns it | `GET /api/v1/meta`, public, returning the credentials or `null` |
| Default | `DEMO_ACCOUNT_ENABLED=false`. When on, a startup warning and a note on the sign-in page |
| Register and sign in | Unchanged as features. The demo account is an addition, never a replacement |
| Confirm password | Checked in the panel. The server has no opinion about a second copy of a field |

Recorded in [`../decisions/demo-account.md`](../decisions/demo-account.md).

## Tasks

| # | Title | Scope | Repository | Branch | Files / areas | PR |
|---|---|---|---|---|---|---|
| 1 | Task record | This file, its decision, and the index rows | `server-expressjs` | `chore/demo-and-landing-plan` | `.agents/memory/`, `.agents/index/` | |
| 2 | Demo account and a public meta endpoint | Config, seeding, the route, the contract | `server-expressjs` | `feat/demo-account` | `src/config.ts`, `src/routes/`, `src/index.ts`, `wiki/`, `test/` | |
| 3 | A landing page at `/` | The page, and the catalogue moved to `/products` | `client-reactjs` | `feat/landing-page` | `src/routes/`, `src/App.tsx`, `test/` | |
| 4 | Demo hint on sign in, confirm password on register | Both auth forms | `client-reactjs` | `feat/auth-forms` | `src/routes/account/`, `src/api/`, `test/` | |
| 5 | Release | Logs, this table, the record closed | both | `chore/demo-and-landing-release` | `wiki/logs/0/0/0/`, `.agents/` | |

## Entries

### Task 1 — chore/demo-and-landing-plan

**The demo account is the part worth deciding in advance**, because the obvious implementation
is the wrong one. Faking it in the panel would be quicker and would make the panel hold state of
its own for the first time — and it would fall over the moment someone used it for the thing it
exists to demonstrate, since publishing needs a real account, a real org and a real token.

So it is a real account, created through the same `register` path a person uses, and the panel
asks the server whether one exists rather than being told at build time. The panel and the
server are configured separately by design; baking credentials into the bundle would couple them
at exactly the point they are decoupled.

**Register and sign in stay real.** The request was explicit that testing them is the point, so
the demo account is strictly an addition — a note on the sign-in page, not a replacement for it.

**What enabling it costs is written down rather than implied.** The demo account is a real user
account: anyone who can reach the panel can publish jars that Minecraft servers will download
and run. Off by default, a startup warning when on, and `wiki/environments/env.md` saying so
next to the variable.

Next task depends on: nothing beyond this record.

### Task 2 — feat/demo-account

Four config keys, a public `GET /api/v1/meta`, and a seeder that goes through `register`.

**`DEMO_ACCOUNT_ENABLED` is `z.enum(['true','false'])`, not `z.coerce.boolean()`**, because
`Boolean("false")` is `true` — a flag that turns itself on when you explicitly disable it is
worse than no flag. There is a test for the literal string `"false"`.

**The seeder calls `auth.register`, the same path the panel calls.** What it produces is
indistinguishable from an account someone made, which is the point: an evaluation that signs in
as something the real path could not have produced demonstrates nothing. A test signs in with
the seeded credentials and reads `/me` back.

**It never fails startup and is idempotent.** The second call — what a redeploy onto an existing
volume does — is a no-op, and a handle that cannot be registered at all (`new` is reserved) is
logged rather than thrown. A convenience that cannot be provided must not become an outage.

**`GET /meta` returns the password.** That is deliberate and is written down in three places:
the route, the contract, and `env.md`. It is a credential the operator published by turning the
flag on.

**A test holds the line the request drew**: registering a new account and signing in with it
still work with the demo account enabled. The demo account is an addition, never a replacement.

Verified: `npm run check` green — **270** tests across twenty suites, 10 of them new.

Next task depends on: `GET /meta`. The panel's sign-in page cannot show a demo account before
something tells it one exists.

