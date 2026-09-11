---
name: memory-index
description: Index of .agents/memory/ — task records, durable decisions, and current repository state.
---

# Memory Index

**Scope:** `.agents/memory/`
**Parent:** [root-index](root-index.md)

Any file added to or removed from `.agents/memory/` is reflected here in the same commit.
This index lists memory files only — never rules, never documentation.

Memory is written freely and automatically; it is the one tree exempt from the discovery
protocol's approval gate. See `{shared}/rules/memory-policy.md`.

## State

| File | Purpose |
|---|---|
| [`state/repository-state.md`](../memory/state/repository-state.md) | What exists in this repository right now, what does not yet, and the next obvious step. |

## Tasks

| File | Purpose |
|---|---|
| [`tasks/mcpluginmanager-platform.md`](../memory/tasks/mcpluginmanager-platform.md) | This repository's entries in the MCPluginManager platform plan. The plan table itself lives in `MCEngine/plugin-manager`. |
| [`tasks/version-route.md`](../memory/tasks/version-route.md) | Addressing a product version by its path: the confirmed four-task plan across two repositories, and one entry per task. |
| [`tasks/container-image.md`](../memory/tasks/container-image.md) | Containerizing the server and the panel: the confirmed four-task plan across two repositories, and one entry per task. |
| [`tasks/native-module-build.md`](../memory/tasks/native-module-build.md) | Fixing the image build that npm’s implicit node-gyp broke: the three-task plan, and one entry per task. |
| [`tasks/untracked-source.md`](../memory/tasks/untracked-source.md) | A source file that was never committed because an ignore pattern over-matched: the three-task plan, and one entry per task. |
| [`tasks/writable-data.md`](../memory/tasks/writable-data.md) | The image defaulting its database onto a read-only path: the three-task plan, and one entry per task. |
| [`tasks/demo-and-landing.md`](../memory/tasks/demo-and-landing.md) | The landing page, the demo account, and the register form’s confirmation field: the five-task plan across two repositories. |
| [`tasks/same-origin-api.md`](../memory/tasks/same-origin-api.md) | This repository's entries in the same-origin API plan. The plan table itself lives in `MCEngine/client-reactjs`. |

## Decisions

| File | Purpose |
|---|---|
| [`decisions/query-builder-over-orm.md`](../memory/decisions/query-builder-over-orm.md) | Why the persistence layer uses Kysely and hand-written migrations instead of Prisma, which the plan named. |
| [`decisions/container-image-shape.md`](../memory/decisions/container-image-shape.md) | The base images, the user, the healthcheck and the same-origin topology the two Dockerfiles assume, and why each was chosen. |
| [`decisions/native-module-install.md`](../memory/decisions/native-module-install.md) | Why `npm ci` runs with `--ignore-scripts`, what it prevents, and the correction to an earlier claim about `better-sqlite3` prebuilds. |
| [`decisions/gitignore-anchoring.md`](../memory/decisions/gitignore-anchoring.md) | Why ignore patterns naming a root artifact are anchored, and the guard that fails the suite if a source file is ever ignored again. |
| [`decisions/writable-paths.md`](../memory/decisions/writable-paths.md) | Why the image defaults every writable path onto its volume, why startup refuses loudly, and the guard that keeps the two in step. |
| [`decisions/demo-account.md`](../memory/decisions/demo-account.md) | Why the demo account is seeded by the server, why the panel asks for its credentials, and what enabling it costs. |
| [`decisions/version-addressed-by-path.md`](../memory/decisions/version-addressed-by-path.md) | Why publishing writes to `PUT /products/:id/versions/:version`, and why a version in the body is refused rather than ignored. |
| [`decisions/no-cors-layer.md`](../memory/decisions/no-cors-layer.md) | Why this service emits no `Access-Control-*` header, why `PANEL_ORIGIN` is not that knob, and what adding CORS would take. |
