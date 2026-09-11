---
name: project-wiki-index
description: Index of wiki/ — human-facing documentation for this repository, excluding the versioned logs.
---

# Project Wiki Index

**Scope:** `wiki/`, except `wiki/logs/`
**Parent:** [root-index](root-index.md)

Any page added to or removed from `wiki/` is reflected here in the same commit. Pages here
are plain markdown with no frontmatter. This index never writes into `.agents/`.

`wiki/logs/` has its own index — see [`logs-index.md`](logs-index.md).

## Information

| File | Purpose |
|---|---|
| [`information/overview.md`](../../wiki/information/overview.md) | What this service is, the three repositories it sits between, and the surfaces it will expose. |
| [`information/data-model.md`](../../wiki/information/data-model.md) | Every table, column and constraint, which rules the schema carries itself, and what stays portable across the four SQL engines. |
| [`information/api-contract.md`](../../wiki/information/api-contract.md) | Every route, the three authentication schemes, the error envelope, the nine upload checks, and the one route the plugin polls. |

## Security

| File | Purpose |
|---|---|
| [`security/artifact-upload.md`](../../wiki/security/artifact-upload.md) | The threat model for accepting jars and serving them: what each guard is, where it lives, how to verify it, and the two gaps that remain open. |
| [`security/external-fetch.md`](../../wiki/security/external-fetch.md) | The threat model for fetching a URL a caller chose: the private-range check, why each source type validates its reference, and what remains open. |

## Environments

| File | Purpose |
|---|---|
| [`environments/setup.md`](../../wiki/environments/setup.md) | Requirements, the commands, what `npm run check` gates, and why `createApp()` never binds a port. |
| [`environments/env.md`](../../wiki/environments/env.md) | Every environment variable, its type and default, and why the database provider is not derived from the URL. |
| [`environments/deployment.md`](../../wiki/environments/deployment.md) | Running the service as a container: the three build stages, what is on the volume, why the healthcheck is readiness, and how the panel sits in front of it. |
