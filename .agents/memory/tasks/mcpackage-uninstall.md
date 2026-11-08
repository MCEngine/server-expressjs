---
name: memory-tasks-mcpackage-uninstall
description: A DELETE route for MCPackage's central package records, so /package uninstall can remove one — the confirmed plan across MCSeere/mcpackage and this repository.
---

# Task: remove MCPackage's central package records

## Why

Asked for: MCPackage gains `/package uninstall`. With `database.type: central` its records live
here, under `/api/mcpackage/servers/:serverId/packages`, which can only list (`GET`) and write
(`PUT`) a record — nothing can remove one.

## The decisions that were not in the request

The owner was away and asked for the recommended option at every fork.

**Query, not path.** `DELETE /api/mcpackage/servers/:serverId/packages?platform=&project_id=`.
A GitHub project id is `owner/repo`, which a path segment cannot carry; the `PUT` takes it in
the body for the same reason, and a `DELETE` body is not reliably sent by every client.

**Idempotent.** Removing a record that is not there still answers `204`, so a retried uninstall
never fails on its own first attempt.

## Tasks

| # | Title | Branch |
|---|---|---|
| 1 | This record | `plan/mcpackage-uninstall` |
| 2 | `DELETE` route, repository `remove`, tests and docs | `feat/package-delete` |
| 3 | Release 0.4.0 | `release/0.4.0` |

The client half lands in MCSeere/mcpackage 0.9.0, after this release.

## Log

### Task 1 — plan/mcpackage-uninstall

This record and its row in `.agents/index/memory-index.md`.
