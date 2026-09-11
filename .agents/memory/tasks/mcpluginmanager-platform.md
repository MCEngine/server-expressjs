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
