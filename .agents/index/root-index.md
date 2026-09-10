---
name: root-index
description: Router for this repository — lists every index it can reach, local and shared, and the shared overrides it declares.
---

# Root Index

This file lists **indexes only**. Never rules, never documentation, never links to leaf
content. Read exactly one branch per task, plus `memory-index.md`, which is read every
session because continuity depends on it.

Adding, removing, or renaming any index updates this table **in the same commit**. Adding or
dropping an override updates the override table below in the same commit.

## Indexes

| Index | Scope | Load when |
|---|---|---|
| [`agents-index.md`](agents-index.md) | This repository's instruction set | You need a rule specific to this repository. |
| `{shared}/index/root-index.md` | The shared instruction set, served by the `lxagents-agents-base` connector | You need a branching, commit, pull request, planning, placement, versioning, or creator convention. |
| [`agent-wiki-index.md`](agent-wiki-index.md) | `.agents/wiki/` agent knowledge | You need orientation, an SOP, or a domain guideline written for agents. |
| [`project-wiki-index.md`](project-wiki-index.md) | `wiki/` human documentation | You need to read or write documentation a person will read. |
| [`memory-index.md`](memory-index.md) | `.agents/memory/` dynamic state | You need prior task state, a recorded decision, or must record progress. |
| [`logs-index.md`](logs-index.md) | `wiki/logs/` versioned change logs | You need release history or must record a change. |

## Shared overrides

| `name` | Local file | Replaces | Why |
|---|---|---|---|

No overrides — this repository uses the shared set unchanged.
