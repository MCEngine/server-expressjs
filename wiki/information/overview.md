# Project Overview

`@mcengine/server-expressjs` is the central server behind **MCPluginManager**. It is an
Express service, and it is the only one of the three repositories that holds state.

## The three repositories

| Repository | Package | Role |
|---|---|---|
| [`MCEngine/plugin-manager`](https://github.com/MCEngine/plugin-manager) | — | The Minecraft plugin. Runs on a SpigotMC, PaperMC or Folia server and applies changes to that server's `plugins/` directory. |
| [`MCEngine/server-expressjs`](https://github.com/MCEngine/server-expressjs) | `@mcengine/server-expressjs` | This service. Accounts, the artifact catalogue, tokens, and the fleet control plane. |
| [`MCEngine/client-reactjs`](https://github.com/MCEngine/client-reactjs) | `@mcengine/client-reactjs` | The web panel a person publishes and administers through. |

Both of the others are HTTP clients of this one. Nothing talks to the database except this
service.

## What it is for

A Minecraft server operator running twenty plugins across four servers has no good way to
answer "which of these is out of date, and where". A plugin author publishing a new jar has
no good way to get it onto those servers other than telling people to download it.

This service is the middle of that: organizations publish versioned jars to it, servers
register with it and report what they currently have installed, and an operator uses the
panel to say what each server *should* have. The plugin on each server reconciles the two.

## The four surfaces

**Namespaces.** An account is either a `user` or an `org`, and both are namespaces with a
unique lowercase handle. A user signs in — by password or through an OAuth identity — and
each device holds its own session, so signing in on a second machine or a second browser
profile does not evict the first. Only an `org` publishes; a user who wants to publish
creates one and becomes its single owner.

**The catalogue.** An org publishes a **product**, and a product carries exactly one jar per
version. Two jars means two products, which is why the constraint is in the schema rather
than in a handler. Product ids are unique across every org, because the API addresses
products by id and a globally unique id needs no org qualifier. Each version records its
own checksum, its compatibility with a platform and a Minecraft version, and an optional
source repository URL that the product page shows only when it is set.

**Tokens.** A Minecraft server does not log in as a person. It carries a scoped API token,
created in the panel and stored only as a digest, which authorizes downloads and fleet
reports and can be revoked without touching anyone's password.

**The fleet.** A registered server reports its installed plugins and their versions; the
panel writes back a desired version. The difference between the two is the work the plugin
has to do, and every check, download, install and removal is recorded as an event.

## What this service does not do

It does not host Minecraft servers, it does not execute anything it stores, and it does not
modify a jar it is given. It validates uploads, stores them under generated keys, and serves
them back byte-for-byte to a caller holding a valid token.

## Status

Pre-release at `0.0.0`. At the time of writing the repository carries the agent instruction
system and this documentation; the runtime, the schema and the routes are being added task
by task. `.agents/wiki/context/repository-map.md` is the page that says what exists right
now, and it is updated by each task as that task makes something true.
