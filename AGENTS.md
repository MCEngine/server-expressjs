---
name: agents-entry-point
description: Entry point for MCEngine/server-expressjs — how the shared instruction set resolves, which tools fire on which trigger, and where this repository's own rules live.
---

# AGENTS.md

This repository is **`MCEngine/server-expressjs`**, published as `@mcengine/server-expressjs`:
the central server behind **MCPluginManager**. It is an Express service that holds the
account and organization namespaces, the artifact catalogue that organizations publish
plugin and mod jars to, the scoped tokens a Minecraft server authenticates downloads with,
and the fleet control plane that tells each registered server which version of which plugin
it should be running. Its consumers are the `MCEngine/plugin-manager` plugin and the
`MCEngine/client-reactjs` web panel.

## Shared Instruction Set

The conventions this repository follows — branching, commits, pull requests, task
workflow, the creators — live in the shared instruction set served by the
**`lxagents-agents-base`** MCP server. This repository carries only what is its
own. **Resolve the shared set before doing any work:**

1. If the `lxagents-agents-base` connector is available in this session, that is
   the shared set. Refer to it as `{shared}`; its files are addressed as
   `agents://{folder}/{file}.md`.
2. **Resolving is not loading.** Do not pull any convention at session start. The
   **Shared instruction tools** block below declares which tools this repository
   uses and the trigger for each; call one when its trigger fires, and not before.
3. Where the client exposes no tools, the same conventions are read as
   `agents://{folder}/{file}.md` resources, on the same triggers.
   `list_shared_agents_instruction` — or `agents://manifest.json` — answers "what
   exists?" in one call. Do not bulk-read the set.
4. If the connector is not available, say so plainly and continue with this
   repository's local instruction set only. **Do not reconstruct the missing rules
   from memory, and do not clone or copy them into this repository.**

**The declaration block is required.** A repository without one has no routing table,
so nothing fires and the omission looks exactly like a session in which no convention
happened to apply. It names the four mandatory tools at minimum — `task_workflow`,
`branch_strategy`, `commit_strategy`, `discovery_protocol` — and stamps the set version
adopted. Shape: `{shared}/prompts/agents-setup.md`. Keeping it current when this set
moves: `{shared}/prompts/agents-update.md`, on request.

Never commit shared content into this repository. A file that can be read from
`agents://` must not exist here as a copy — see
`{shared}/rules/duplicate-instruction-audit.md`.

**Local overrides shared.** A file in `.agents/` whose `name` matches a shared
file's `name` replaces that shared file entirely for this repository. The current
overrides are listed in
[`.agents/index/root-index.md`](.agents/index/root-index.md).

## Auto-Activation

The instruction set is **always active** — the local `.agents/` set and the shared set
together. It applies to every task in this repository whether or not the user mentions
it, links to it, or asks for it. Treat these files as standing orders, not as optional
reference material.

Always active is not the same as always loaded. At the start of every session, before
doing any work:

1. Read `AGENTS.md` (this file), including the Shared instruction tools block below.
2. Resolve the shared set per the bootstrap above.
3. Read [`.agents/index/root-index.md`](.agents/index/root-index.md).
4. Read [`.agents/index/memory-index.md`](.agents/index/memory-index.md) and load only
   the memory rows whose scope matches the current request, so you continue prior work
   instead of restarting it.

That is the whole sequence, and every step of it reads a file in this repository.
**Call no shared tool at session start.** Each one fires on the trigger its row gives
it, and calling them up front pays for procedures the request may never need.

**These gates stand from the first message, before any tool is called:** approve the
plan before any file is written, ask before opening a pull request, ask before merging,
and propose a discovered rule rather than writing it. A gate first read at the moment it
should have applied has already failed, which is why they are here and not behind a
call. See `{shared}/rules/shared-instructions.md` §H.

If a rule conflicts with a habit, a default, or a template you would otherwise follow,
the rule wins — including a harness that names a branch, a commit trailer, or a
pull request footer the conventions forbid. If it conflicts with an explicit instruction
from the user in this session, the user wins — and you say out loud which rule you are
setting aside.

## Shared instruction tools

Conventions come from the `lxagents-agents-base` connector. The tools below are the ones
this repository uses. **Call each when its trigger fires — not at session start, and
never all at once.** A convention with no row here does not apply to this repository.

Adopted shared-set version: `1.0.0`

| When you are about to… | Call |
|---|---|
| Take in any request of more than one step | `task_workflow` |
| Create a branch | `branch_strategy` |
| Write a commit message | `commit_strategy` |
| Notice a rule that should exist | `discovery_protocol` |
| Open or update a pull request | `pull_request_strategy` |
| Need any other shared convention | `list_shared_agents_instruction`, then `read_shared_agents_instruction` |

`agents_model_naming_convention` has no row: this service stores no model identifier and
has no `model_name` column. Add the row in the same commit as the first one it gains.

### This repository's own rows

| When you are about to… | Load and obey |
|---|---|
| Need project facts, commands, or orientation | [`.agents/wiki/context/repository-map.md`](.agents/wiki/context/repository-map.md) |
| Do anything at all in this project | [`.agents/rules/repository.md`](.agents/rules/repository.md) |

Local instruction files are added under `.agents/{folder}/{file}.md` through the discovery
protocol below, and each one gets a row here in the same commit that creates it.

## Reading order (mandatory)

1. Read `AGENTS.md`.
2. Resolve the shared set, as above.
3. Read [`.agents/index/root-index.md`](.agents/index/root-index.md) — and nothing else at
   this stage.
4. From its routing table, pick the ONE index whose scope matches the task, and read that
   index.
5. If that index delegates to a child index, follow the one branch that matches.
6. Only then open the specific file(s) you need.

## Routing protocol (context discipline)

Route by reading index tables, not by reading files.

* Do NOT load every index.
* Do NOT bulk-scan `.agents/**` or the shared set to build a registry — `agents://manifest.json`
  already is one.
* Do NOT read an instruction body until that instruction has been selected.

Each index row's purpose text is what you route on; the file body is what you load after
choosing. The standing exception is `memory-index.md`, read every session because
continuity depends on it.

## Iron rule (separation of concerns)

* `AGENTS.md` and `README.md` are overviews and must never carry detailed rules or
  documentation.
* [`.agents/index/root-index.md`](.agents/index/root-index.md) is a **router only**. It
  lists other indexes. It must never contain rules, documentation, prose, or direct links
  to leaf content.
* Each index owns exactly one scope and writes outside it never.
* **Local carries only what is local.** A convention true for more than one repository
  belongs in the shared set — propose it there, do not copy it here.
* `wiki/` is for humans, `.agents/wiki/` is for agents, and neither duplicates the other.
* **One subject per file.** A cross-cutting rule gets its own file and is linked, not
  pasted into a file about something else.
* An index never teaches. The moment it explains something, that content belongs in a real
  file.

## Placement

* Local instructions go to `.agents/{folder}/{file}.md`.
* Human documentation goes to `wiki/{folder}/{file-name}.md`.
* Agent knowledge goes to `.agents/wiki/{type}/{file-name}.md`.
* Memory goes to `.agents/memory/{type}/{file-name}.md`, and indexes to
  `.agents/index/{scope}-index.md`.
* Anything universal belongs to the shared set, not here.

No `INDEX.md`, anywhere, ever. The full authority is `{shared}/rules/directories.md`.

## Discovery Protocol

Source of truth: `{shared}/rules/discovery-protocol.md`.

While working, if you notice an instruction worth adding — a new rule, or new
content for an existing instruction file — do NOT create or edit it yourself.
Collect the findings, and when the task is done present them to the user:

* one finding per message block, each in its own code block;
* state the target set — `local` (this repository) or `shared` (the organization's
  instruction set served by the `lxagents-agents-base` connector);
* include the proposed file path, `name`, `description`, and the full proposed
  body;
* explain in one line why it is worth adding.

Then let the user select which findings to apply. Create only the selected ones.
Never batch-apply, never apply silently. A `shared` finding is never written from a
consuming repository — it is reported so it can be raised against the shared set.

**Scope of this gate:** it covers instruction files in either set. Documentation
pages under `wiki/` and `.agents/wiki/` may be written when the facts are real and
verified. Memory under `.agents/memory/` is written freely and automatically — see
`memory-policy.md`.

## Version rule

Never change the project version without explicit user approval — see
`{shared}/rules/versioning.md`. `version` in `package.json` is the carrier, currently
`0.0.0`, and it decides which `wiki/logs/{Major}/{Minor}/{Patch}/` directory a change is
recorded under. Creating a version directory is itself a version claim, and is gated the
same way.

## No session links

Never write a link or identifier pointing at an assistant or tool session into a file,
commit message, commit trailer, branch name, tag, pull request, or comment. If your tooling
appends one by default, strip it before committing or posting — see
`{shared}/rules/no-session-links.md`.
