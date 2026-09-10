# server-expressjs

The central server behind **MCPluginManager**, published as `@mcengine/server-expressjs`.

An Express service holding the account and organization namespaces, the artifact catalogue
that organizations publish plugin and mod jars to, the scoped tokens a Minecraft server
authenticates downloads with, and the fleet control plane that tells each registered server
which version of which plugin it should be running.

## Key features

- Namespaces for users and organizations, with multi-device sessions and OAuth identities.
- A versioned artifact catalogue. One product page, one jar — enforced in the schema.
- Scoped API tokens for unattended downloads, stored only as digests.
- A fleet control plane: servers report what is installed, the panel says what should be.
- SQLite under test, PostgreSQL, MySQL and MariaDB in production, behind one set of
  repository interfaces.

## Quick start

Nothing to run yet. This repository currently carries its agent instruction system and its
documentation; the runtime is being added task by task, and
[`.agents/wiki/context/repository-map.md`](.agents/wiki/context/repository-map.md) says
exactly what exists right now.

## Documentation

The full map is
[`.agents/index/project-wiki-index.md`](.agents/index/project-wiki-index.md).

Start here:

- [Project Overview](wiki/information/overview.md) — what this service is, the three
  repositories it sits between, and the four surfaces it exposes.

## Working with agents

See [`AGENTS.md`](AGENTS.md). This repository consumes a shared agent instruction set served
over the `lxagents-agents-base` MCP connector; it carries no copy of that set.

## License

See [`LICENSE`](LICENSE).
