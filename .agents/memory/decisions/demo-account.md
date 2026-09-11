---
name: memory-decisions-demo-account
description: Why the demo account is seeded by the server rather than fixtured in the panel, why the panel asks the server for its credentials, and what enabling it actually costs.
---

# The demo account

An account that exists so someone evaluating the platform can sign in without registering first
— while register and sign in both stay real, so they can be tested too.

## It is seeded by the server, not fixtured in the panel

The panel holds no state of its own; every fact it renders comes from the server. A demo
account faked in the panel would be the first exception, and it would not survive contact with
the thing being demonstrated — publishing needs a real account, a real org and a real token.

So the server creates a real account through the same `register` path a person uses. Nothing
about it is special except that it already exists.

## The panel asks the server which credentials to show

`GET /api/v1/meta` is public and returns:

```json
{ "demo_account": { "email": "demo@mcengine.local", "password": "..." } }
```

or `{ "demo_account": null }` when the feature is off.

The alternative was to bake the credentials into the panel at build time. That fails the moment
the panel and the server are configured differently — and they are configured separately by
design, one at build time and one at runtime. The server owns whether a demo account exists, so
the server is asked.

**A password over an endpoint is the point, not an oversight.** It is a credential the operator
deliberately published by turning the flag on; withholding it from the sign-in page while
printing it in a startup log would be security theatre.

## Off unless explicitly enabled, and never silently

`DEMO_ACCOUNT_ENABLED` defaults to `false`. With it off, nothing is seeded and `demo_account` is
`null`.

With it on, the server logs a warning naming the risk at every startup, and the panel says on
the sign-in page that this is a shared evaluation account.

## What enabling it costs, stated plainly

The demo account is a **real user account**. Anyone who can reach the panel can sign in as it,
create organizations, publish artifacts, and mint API tokens. On a deployment reachable from the
internet that is a stranger publishing jars into the catalogue other people's Minecraft servers
download and execute.

It is for evaluation. `wiki/environments/env.md` says so next to the variable, and the startup
warning says so to whoever is reading logs.

A narrower demo — read-only, or scoped to a sandbox org — would remove that cost, and would also
stop it demonstrating the thing worth demonstrating. If the tradeoff stops being worth it, the
answer is to turn the flag off, not to weaken the account.

## Seeding is idempotent and never fails startup

The account is created if its handle is free and left alone otherwise, so a restart is a no-op
and a redeploy onto an existing volume does not error. A failure to seed is logged and does not
stop the service: a demo account is a convenience, and refusing to serve because one could not
be created would turn a convenience into an outage.
