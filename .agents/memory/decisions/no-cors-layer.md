---
name: memory-decisions-no-cors-layer
description: This service has no CORS layer and hardcodes SameSite=Lax — what that rules out, why PANEL_ORIGIN is not that knob, and what adding one would take.
---

# No CORS layer, and `PANEL_ORIGIN` is not one

## The state of things

This service **emits no `Access-Control-*` header**. There is no `cors` dependency, no
middleware that sets one, and no route that does. `OPTIONS` is answered by Express's own
default:

```
OPTIONS /api/v1/auth/login   Origin: https://mcpm-panel.onrender.com
HTTP/1.1 200 OK
Allow: POST
```

A browser reads that as permission denied and never sends the real request — so a panel on
another origin fails with nothing in this service's log, because nothing reached it.

The refresh cookie compounds it. `src/modules/auth/routes.ts` issues it `SameSite=Lax`, a
literal in the code with no configuration behind it:

```
Set-Cookie: mcpm_refresh=...; Path=/api/v1/auth; HttpOnly; SameSite=Lax
```

`Lax` is not attached to cross-site requests, so even with CORS granted a cross-origin panel
would sign in successfully and lose the session at the first refresh.

## `PANEL_ORIGIN` is not the knob it looks like

`src/config.ts` validates it and **nothing reads it afterwards**. It is reserved for an OAuth
redirect this service does not yet issue. Until this record, `wiki/environments/deployment.md`
claimed it "is what the service allows cross-origin requests from", which is false, and a
deployment followed that sentence into an outage: the panel was built with
`VITE_API_BASE_URL` pointing here, every request went cross-origin, and nothing worked.

A variable that configures nothing is not harmless when the documentation says it does. Both
pages now say what it is, and so does the comment on the field.

## Why not simply add CORS

Because the supported topology does not need it. The panel's container image serves its bundle
and proxies `/api` to this service, so the browser sees one origin; its own requests are
relative for the same reason. Adding CORS would mean adding a second supported topology, and
with it a cookie that must be `SameSite=None; Secure` — a cross-site cookie is a larger change
than a header, and it exists to be sent to a third party, which is the property that makes CSRF
worth thinking about.

## What adding it would take

Both halves, together, or neither:

* a CORS layer reading `PANEL_ORIGIN` — reflecting that one origin, never `*`, since the
  responses are credentialed;
* `SameSite` configurable, defaulting to `Lax`, set to `None; Secure` only where the panel is
  genuinely on another origin;
* `PANEL_ORIGIN` becoming required rather than defaulted, since a wrong value would then be a
  security question rather than an unused string.

Until someone needs that, the honest documentation is cheaper than the feature.
