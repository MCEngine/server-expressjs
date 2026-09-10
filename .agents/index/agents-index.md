---
name: agents-index
description: Index of this repository's own instruction files under .agents/ — the local rules that the shared set does not carry.
---

# Agents Index

**Scope:** `.agents/`, excluding `index/`, `wiki/` and `memory/`
**Parent:** [root-index](root-index.md)

Local instruction files only. The shared conventions — branching, commits, pull requests,
the task workflow, the creators — are served by the `lxagents-agents-base` connector and are
never copied here.

Any file added to or removed from this scope is reflected here in the same commit, and gets
a row in the `AGENTS.md` declaration block in that same commit so it actually activates.

## Rules

| File | Purpose |
|---|---|
| [`../rules/repository.md`](../rules/repository.md) | This repository's own rules: mode, module boundaries, the version carrier, and what must not be introduced. |
