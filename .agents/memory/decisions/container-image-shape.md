---
name: memory-decisions-container-image-shape
description: The base images, the user, the healthcheck and the same-origin topology the two Dockerfiles assume, and why each was chosen.
---

# The shape of the two container images

Two images: the central server, and the panel behind nginx. The choices below are the ones a
later change would otherwise re-litigate.

## Debian slim, not Alpine, for the server

`better-sqlite3` is a **native module**. It ships prebuilt binaries for linux-x64 and
linux-arm64 against **glibc**, and none against musl. On Alpine, `npm ci` therefore falls back
to compiling it, which means `python3`, `make` and `g++` in the image — a build toolchain in a
production runtime, for a dependency that has a prebuilt binary two lines away.

`node:22-bookworm-slim` takes the prebuilt binary and needs no toolchain. The image is larger
than Alpine's and that is the trade being made deliberately.

## The runtime stage installs its own dependencies

`node_modules` is **not** copied from the build stage. The build stage installs devDependencies
it must not ship, and a native module's binary is bound to the platform and ABI it was
installed for. The runtime stage runs its own `npm ci --omit=dev` on the same base image, so
what ships is the production set compiled for the image that runs it.

## Non-root, using the user the base image already has

The official Node images carry an unprivileged `node` user at uid 1000. Nothing is installed
into the image at runtime, so root buys nothing after the build. `STORAGE_DIR` is the one
writable path and is chowned to that user at build time.

## The healthcheck is readiness, not liveness

`/health` deliberately checks nothing — an orchestrator restarts what fails liveness, and
restarting does not fix an unreachable database. Docker's `HEALTHCHECK` does not restart a
container; it publishes a status that `depends_on: condition: service_healthy` and load
balancers gate on. That is readiness, so it calls `/health/ready`.

It is called with `node --eval` rather than `curl` or `wget`, neither of which is in
`node:22-bookworm-slim`. Node 22 has a global `fetch`, so the check adds no package.

## The panel and the API are one origin

The panel's requests are **relative** (`/api/v1/...`). That is not incidental: the refresh
token is an `HttpOnly` cookie, and serving the panel from a different origin than the API makes
every request cross-site in production while the dev proxy keeps it same-site — a difference
that shows up only as a cookie the browser silently declines to send.

So the panel's image is nginx serving the bundle **and** proxying `/api` to the server. The
upstream is `API_UPSTREAM`, substituted at container start by the base image's own `envsubst`
pass over `/etc/nginx/templates/`.

## `proxy_pass` goes through a variable, on purpose

```nginx
set $api_upstream "${API_UPSTREAM}";
proxy_pass http://$api_upstream;
```

A literal `proxy_pass http://server:3000;` resolves the hostname **once, at configuration
load**. When the API container is replaced it gets a new address and nginx keeps sending to the
old one until it is itself restarted — an outage that looks like the API being down while the
API is up. A variable forces resolution per request, which needs a `resolver`: `127.0.0.11` is
Docker's embedded DNS, and `DNS_RESOLVER` overrides it for Kubernetes or anywhere else.

## The panel image listens on 8080

`nginxinc/nginx-unprivileged` runs as uid 101 with no root anywhere, which means it cannot bind
a port below 1024. 8080 is the consequence, not a preference. It is the nginx team's own image
and takes the same templates and configuration as the official one.

## No compose file is committed

A compose file would have to name both repositories, and neither owns the other. The two
`wiki/environments/deployment.md` pages each carry the same example instead, written from their
own side.
