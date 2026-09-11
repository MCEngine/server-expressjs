---
name: memory-tasks-mcpluginmanager-platform
description: This repository's entries in the MCPluginManager platform plan — the plan table itself lives in MCEngine/plugin-manager.
---

# Task: MCPluginManager platform — server-expressjs entries

**The plan table is not here.** It lives in `MCEngine/plugin-manager` at
`.agents/memory/tasks/mcpluginmanager-platform.md`: one twenty-task list covering all three
repositories, so the cross-repository ordering can be read in one place instead of three
that drift. Why it is arranged that way is recorded in that repository at
`.agents/memory/decisions/cross-repository-record.md`.

This file holds the entries for the tasks that land **in this repository**, in the shape
every task record takes: one `### Task k — {branch}` heading per task, appended in the same
commit as the work it describes.

Tasks 2, 6, 7, 8, 9, 10, 11, 12, 13, 14 and 20 of that plan are this repository's.

## Entries

### Task 2 — docs/agents-setup

Adopted the shared instruction set as a **Mode B consumer**, declaring no overrides. This is
the repository's first task record and its first commit beyond the initial one.

Created `AGENTS.md` (connector bootstrap verbatim, the auto-activation contract with its
three gates inline, a **declaration** block naming five shared tools and stamping set
version `1.0.0`, reading order, routing protocol, iron rule, placement, the discovery
protocol block, the version rule and the session-link rule); `.claude/CLAUDE.md` as an
import of `../AGENTS.md` and nothing else; the six indexes under `.agents/index/`;
`.agents/rules/repository.md`; `.agents/wiki/context/repository-map.md`; this file and
`state/repository-state.md`; `wiki/information/overview.md`; and
`wiki/logs/0/0/0/CHANGELOG.md`. Rewrote `README.md` from a bare title into an overview.

**`agents_model_naming_convention` was deliberately dropped from the declaration block.**
This service stores no model identifier, so the row would fire on a trigger that can never
occur. `AGENTS.md` says so where the row would be, rather than leaving its absence to look
like an oversight.

**Only the mandatory core set was created.** No `wiki/environments/setup.md`: there is no
`package.json`, so a setup page could only say "nothing to install", and the setup procedure
is explicit that a placeholder page full of TODOs is worse than no page. It arrives with the
Express skeleton, which is what makes it true.

`LICENSE` already carried MIT with the correct holder and year and was left untouched.

Next task depends on: nothing in this repository. The next task here documents the data
model and the API contract before any code exists.

### Task 6 — docs/api-contract

Wrote the data model and the API contract before any code, so the schema is reviewable as a
design rather than as a migration diff.

`wiki/information/data-model.md` — every table, column and constraint, with the reasoning
kept next to the thing it explains rather than in a separate rationale section.
`wiki/information/api-contract.md` — every route, the three authentication schemes, the
error envelope, the nine ordered upload checks, and the payload the plugin polls for.

**Nine corrections to the schema as originally sketched**, each stated in the document at the
point it applies:

* `org_members` needed **two** foreign keys. With a single `account_id` there is no way to
  say which user belongs to which organization. This one is a bug, not a naming preference.
* `server_plugins` was asked to have `plugin_id` unique *and* duplicated, with `server_id` as
  the primary key — which cannot hold. `PK (server_id, plugin_id)` is what was meant: unique
  within a server, repeated across servers.
* `name_id_cooldown` became `handle_changed_at`. Storing when a change happened keeps the
  thirty-day policy in code; storing when the cooldown expires freezes the policy into every
  existing row.
* `account_emails.is_active` became `is_primary`, with `verified_at` as a separate column,
  because "active" was conflating two independent facts.
* `plugin_hosting.server_url` was the identity and globally unique. It is now optional
  metadata, unique per owner, and the identity is a generated `server_key` — a URL is not
  stable, is not always public, and is not exclusive to one operator.
* A single `authentication` table became `credentials`, `identities` and `sessions`. Those
  are three different things, and multi-device login and multi-provider login are different
  axes that one table cannot express.
* `product_versions` gained `version_norm`. Compared as text, `1.9.0` sorts above `1.10.0`
  and the plugin updates backwards.
* `product_files` took `version_id` as its **primary key**, which is what makes "one product
  page, one jar" a thing the database cannot represent otherwise.
* Autoincrementing integer ids became ULIDs, so a caller cannot enumerate another
  operator's servers by counting.

**Globally unique product slugs were kept as asked, with the cost written down** rather than
quietly redesigned: whoever registers `essentials` holds it against every other org. The
document says so, and says that `products.id` is already global and opaque so the API keeps
its addressing advantage either way.

**No security page was written, deliberately.** `{shared}/creators/security-creator.md` is
explicit that every row in a threat model's Surfaces table must name a guard a reader can
open, and that a control nobody can point at belongs in `Open` instead. With no code in the
repository, every guard would be unimplemented and the whole page would be `Open` — a
document that reads like protection and provides none. The upload and path-traversal rules
live in the API contract as endpoint behaviour, which is where an implementer looks; the
threat model is written in the task that makes the guards real.

Next task depends on: both documents. The Express skeleton, the persistence layer and every
module after them are checked against these rather than inventing their own shapes.
