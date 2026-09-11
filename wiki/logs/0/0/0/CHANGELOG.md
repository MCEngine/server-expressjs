# Changelog — 0.0.0

Pre-release. This version covers the repository from its initial commit up to the first
release, and is appended to as each task lands.

## Added

- `AGENTS.md`, `.claude/CLAUDE.md`, and the `.agents/` tree — six indexes, the repository
  rules hub, the agent repository map, and the memory tree. The repository consumes the
  shared instruction set over the `lxagents-agents-base` connector as a Mode B consumer and
  declares no overrides.
- `wiki/information/overview.md` — what this service is, the three repositories it sits
  between, and the surfaces it will expose.
- This changelog, and the version-directory log structure it sits in.
- `wiki/information/data-model.md` — every table, column and constraint, the rules the schema
  carries itself rather than delegating to a handler, and what stays portable across SQLite,
  PostgreSQL, MySQL and MariaDB.
- `wiki/information/api-contract.md` — every route, the three authentication schemes, the
  error envelope, the nine ordered checks an upload must pass, and the single payload the
  plugin polls for.
- The Express runtime: `package.json` at `0.0.0`, strict TypeScript, Vitest with Supertest,
  and two runtime dependencies — Express and Zod.
- `src/config.ts` — every environment variable, validated once at startup, frozen, and taken
  as an argument so a test never mutates `process.env`.
- `src/errors.ts` and `src/http/errorHandler.ts` — the one error envelope the contract
  promises, with a deliberate `ApiError` rendered in full and anything else reduced to a bare
  `internal_error`.
- `src/http/requestContext.ts` — a request id per request, honouring a sanitized inbound one.
- `src/lib/logger.ts` — a JSON-line logger with no dependency.
- `src/routes/health.ts` — liveness that checks nothing and readiness that checks everything.
- `wiki/environments/setup.md` and `wiki/environments/env.md`.
- `src/db/` — the typed schema for all twenty-one tables, the four dialects' differences in
  one table, the connection factory with per-provider lazy driver imports, the migration
  runner, and the initial migration.
- `src/lib/ids.ts` — ULIDs, so identifiers sort by time and cannot be enumerated.
- `src/lib/version.ts` — `normalizeVersion` and `compareVersions`, so `1.10.0` is newer than
  `1.9.0` rather than older.
- Sixteen constraint tests, one per rule the data model says the schema carries itself.

## Changed

- `README.md` rewritten from a bare title into an overview: what the service is, its place
  in the platform, and links into `wiki/`.
