---
name: memory-tasks-version-route
description: Task record for addressing a product version by its path — the confirmed four-task plan across two repositories, with one entry appended per task as it lands.
---

# Task: Address a version by its path

## Goal

Publishing a version should write to the same URL that reads it back. The product id is
globally unique, so `(product_id, version)` already addresses a version — the publish route
was the only one of four not using that.

## Objective

* `PUT /api/v1/products/:id/versions/:version` publishes, and
  `POST /api/v1/products/:id/versions` no longer exists.
* The version comes from the path and nowhere else; a `version` field in the body is refused.
* The panel publishes through the new route, and the API contract describes it.
* Every existing guarantee still holds: the nine ordered upload checks, `409` on a republish,
  `artifact:write` plus maintainer, and `upload_source: 'ci'` for a token.

## Detail

* Two repositories. `MCEngine/plugin-manager` is **not** one of them — it only downloads, and
  `GET /products/:id/versions/:version/download` is unchanged.
* This is a breaking contract change, made now because nothing has shipped.
* The version carrier does not move. All repositories stay at `0.0.0`.

## Decisions

| Decision | Value |
|---|---|
| Method | `PUT` — the client chooses the URI |
| Immutability | A republish is `409 version_exists`, as before; `PUT` here is create-only |
| A `version` field in the body | Refused with `400 version_in_body`, never ignored |
| `channel`, `changelog`, `compatibility` | Stay in the body — they are attributes of the version, not its address |
| Old route | Removed, not deprecated. Nothing has shipped |

Recorded in [`../decisions/version-addressed-by-path.md`](../decisions/version-addressed-by-path.md).

## Tasks

Task 1 branches from `master`; task `k` branches from task `k-1` **within the same
repository**. The two repositories cannot stack, so they are ordered instead.

**PR numbers restart per repository**, so each cell names the repository as well as the
number. Filled by task 4, which is last in every stack and therefore rebases nothing.

| # | Title | Scope | Repository | Branch | Files / areas | PR |
|---|---|---|---|---|---|---|
| 1 | Task record | This file, its decision, and the index row | `server-expressjs` | `chore/version-route-plan` | `.agents/memory/`, `.agents/index/` | |
| 2 | Address a version by its path | The route, the refusal, the contract, the tests | `server-expressjs` | `refactor/version-route` | `src/modules/product/`, `wiki/information/api-contract.md`, `test/` | |
| 3 | Panel publishes to the version's URL | The publish form follows the contract | `client-reactjs` | `refactor/version-route` | `src/routes/product/ProductUpdate.tsx`, `test/` | |
| 4 | Release | Logs, this table, the record closed | both | `chore/release` | `wiki/logs/0/0/0/`, `.agents/` | |

## Entries

### Task 1 — chore/version-route-plan

Wrote this record and the decision behind it before the change, so the reasoning is reviewable
on its own rather than inferred from a route diff.

**The record lives here rather than in `MCEngine/plugin-manager`.** The platform plan lives
there because, when it was written, it was the only repository with a `.agents/memory/` tree.
All three have one now, and this change does not touch that repository at all — so the record
sits in the repository that owns the contract being changed, and `MCEngine/client-reactjs`
points at it from its own memory tree.

**The previous platform record stays closed.** It was marked done at its release, and its own
closing entry says follow-up work opens a new record rather than appending. This is that new
record.

Next task depends on: nothing beyond this record.

### Task 2 — refactor/version-route

`POST /products/:id/versions` became `PUT /products/:id/versions/:version`. The old route is
gone rather than deprecated: nothing has shipped, and a removed route fails loudly where a
deprecated one fails quietly six months later.

**The version now comes from `pathParam(req, 'version')` and is validated by the same
`versionSchema` as before**, so a path segment that is not version-like is
`400 validation_failed` — which is also what stops `PUT /products/:id/versions/latest` from
ever being a publish, without a special case for the word.

**A `version` field in the body is `400 version_in_body`, even when it agrees with the path.**
Refusing rather than ignoring is the whole point: a script whose URL says `1.2.2` while its
body says `1.2.3` would otherwise publish `1.2.2` and report success. A test asserts both the
code and that nothing was written under either version.

**Nothing else moved.** `channel`, `changelog` and `compatibility` stay in the body because
they are attributes of a version rather than part of its address; `requireScope('artifact:write')`
plus the maintainer check, the nine ordered upload checks, `409 version_exists`, and
`upload_source: 'ci'` for a token are all unchanged, and the existing tests for each still pass
untouched apart from the URL they call.

Propagated to the two documents that described the old route:
`wiki/information/api-contract.md` (the route table, the publishing section, the rate-limit
table) and `wiki/security/artifact-upload.md`, whose opening line names the upload path.

Verified: `npm run check` green — 253 tests across fifteen suites, 4 of them new. The new ones
hold the property the change exists for: publishing and reading return the same version id and
the same checksum from the same URL; a body version is refused and writes nothing; a
non-version path segment is refused; and a `POST` to the collection is now a 404.

Next task depends on: the route. The panel is the only caller that publishes.
