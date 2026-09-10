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

### Task 7 — build/express-skeleton

The runtime, with no domain in it: configuration, the error envelope, the request id, a
logger, health routes, and the test harness the rest of the service is built against.

**Two runtime dependencies, Express and Zod.** The logger is fifty lines over `console`
rather than pino: this service needs neither transports nor redaction yet, every call site
already passes structured fields rather than interpolating, and it is one file to replace
when that changes. Adding a dependency is easy later; removing one is not.

**`createApp()` takes its dependencies as arguments and never binds a port.** Listening is
`src/index.ts` alone. That is what lets `test/health.test.ts` assert the case that actually
matters — readiness returning 503 and naming the failing dependency — which a real database
makes hard to arrange and a module-level singleton makes impossible.

**The environment is parsed once, in `src/config.ts`, and nothing else reads `process.env`.**
`loadConfig` takes the environment as an argument so a test can build a config without
mutating the global, which is shared state that leaks between suite files. The result is
frozen. `JWT_SECRET` has no default and a 32-character minimum: a service that boots with a
well-known signing key is worse than one that refuses to boot.

**`DATABASE_PROVIDER` is a separate key from `DATABASE_URL`.** A MySQL URL and a MariaDB URL
are indistinguishable, and the two differ in ways the schema has to know about, so the
dialect is declared rather than guessed.

**Three things the error handler does that a default one does not.** A thrown `ApiError` is
deliberate and its message is shown; anything else is a defect, logged in full with the
request id and rendered as a bare `internal_error`, because an unexpected exception's message
is exactly the sort of thing that carries a query fragment. Express's own malformed-JSON
`SyntaxError` is translated to `400 malformed_json` rather than counted as a defect. And an
error raised after the response has started destroys the connection instead of leaving a
client waiting on a body that will never arrive.

**The inbound `X-Request-Id` is honoured but sanitized** — 128 characters, `[A-Za-z0-9._-]`
only. The value lands in a response header and in every log line for that request, so
accepting it unfiltered is header injection and log injection in one.

Verified: `npm run check` green — `tsc --noEmit` clean under `strict`,
`noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`, and 18 tests passing across four
suites. `npm run build` compiles, and the compiled entry point was run and probed by hand:
`/health` returns `{"status":"ok"}` with a dead probe registered, `/health/ready` returns
`ready`, an unmatched route returns the documented envelope, `X-Request-Id` is set,
`X-Powered-By` is absent, and SIGTERM exits cleanly.

Also added `wiki/environments/setup.md` and `wiki/environments/env.md`, which the agents
setup task deliberately left out because there was no `package.json` to describe. Both are
registered in `project-wiki-index.md`, and `.agents/rules/repository.md` now carries real
build commands in place of the "none yet" note.

Next task depends on: `createApp`'s options shape, which the persistence layer extends with a
readiness probe rather than a module-level connection.

### Task 8 — feat/database

The schema, the migration that creates it, the connection factory, and a test harness that
builds a real database per suite.

**Kysely instead of Prisma, which the plan named.** The full reasoning is in
`../decisions/query-builder-over-orm.md`; the short version is that the data model approved
one task earlier puts nine rules in the database, three of them partial unique indexes and
three of them `CHECK` constraints, and Prisma's schema language can express neither. The
choice was between weakening the data model and carrying a code generator that the raw SQL
migrations would make redundant anyway. **This reverses a decision the user made, so it is
reported in the work summary rather than left in a diff.**

**Sixteen constraint tests, one per row of the data model's *What the schema enforces on its
own* table.** They are the point of the task: each one performs a direct insert that violates
a rule and asserts the database refuses it. If any passed, the documentation's claim that the
schema carries the rule would be false and the rule would live only in handler code. Two of
them assert the *permitted* case as well — the same plugin id on two different servers, and a
second `is_latest` in a different channel — because a constraint that is too strict fails
silently in the opposite direction.

**One test asserts the bug that `version_norm` exists to prevent**, by first asserting that
`'1.9.0' > '1.10.0'` is true as raw text. Without that line the padding looks like decoration.

**Three dialect differences could not be papered over** and are collected in `src/db/types.ts`
rather than scattered: a timestamp's storage type, whether the engine has a native boolean,
and whether it supports a partial unique index. MySQL and MariaDB have no partial index, so
the three conditional-unique rules are given a stored generated column that is NULL unless the
condition holds — their unique indexes ignore NULLs, which is the same guarantee by another
mechanism.

**Two things about SQLite that would each have made the suite lie.** `PRAGMA foreign_keys` is
off by default, so without turning it on every foreign key in the schema is decorative and the
constraint suite would pass against a database enforcing nothing. And its driver refuses to
bind a JavaScript boolean, which surfaced as a driver-level throw on the first run — hence
`SqliteBooleanPlugin`, applied to SQLite alone because `pg` and `mysql2` take a boolean
directly and converting for them would write `1` into a real boolean column.

The test database is a real file in a temporary directory rather than `:memory:`, because WAL
and foreign-key enforcement are what production uses and an in-memory database differs on both.

Migrations run at startup, from a literal list rather than a directory scan: the set that
ships is the set that was compiled, and `dist/` has no directory to read.

Verified: `npm run check` green — 67 tests across eight suites. Built and run for real: the
first boot logged `migrations applied: 001-initial`, the second applied none, `/health/ready`
reported the database reachable, and 23 tables existed on disk.

Next task depends on: `src/db/schema.ts` and the ULID helper. Every module from here reads
and writes through them.

### Task 9 — feat/account

The identity domain: accounts, profiles and the handle cooldown, emails, organizations,
membership and roles, and org settings. Repository, service, validation, and the one route
that needs no caller.

**The task was scoped to the domain rather than the HTTP surface, because of an ordering
problem in the plan.** Task 9 is accounts and task 10 is authentication, but almost every
account route needs a signed-in caller — and authentication needs accounts to sign in to.
Rather than reorder the approved list or stub an auth check (which is a security hole wearing
a placeholder's clothes), this task delivers the whole identity domain plus
`GET /accounts/:handle`, which is public. Task 10 brings the caller and mounts the rest of
the routes on top of a service that already works and is already tested.

**Five rules the database cannot carry, so the service does:**

* An org's owner must be a `user` and a product's owner must be an `org` — no portable
  `CHECK` can follow a foreign key to test the referenced row's type.
* Ownership moves only by transfer. Inviting or promoting to `owner` is refused with its own
  message rather than being left to collide with the partial unique index, which would report
  a constraint name.
* The owner cannot be removed or demoted. An org with no owner has nobody who can delete it
  or transfer it — a state with no exit.
* An unverified email cannot be made primary. Otherwise anyone who can add an address can
  redirect the account's password resets to it.
* A reserved handle is rejected before the database is asked, so the reason is `handle_reserved`
  rather than a unique-constraint conflict that says nothing.

**Two places where the status code is the security decision.** `requireRole` answers a
non-member with `404`, not `403`, so an organization cannot be discovered by probing for a
permission error. Touching another account's email address answers `404` for the same reason.

**The clock is injected.** `src/lib/clock.ts` exists so the cooldown boundary can be asserted
at twenty-nine days and thirty-one without sleeping or mocking a global — which is the only
way that test is worth writing.

Verified: `npm run check` green, 97 tests across nine suites, 30 of them new. Among them:
ownership transfer never leaves two owners or none; a released handle is recorded in the same
transaction that replaces it; the public account route omits an unset field rather than
sending `null`, never exposes an email or a status, and answers a malformed handle exactly as
it answers an unused one.

Next task depends on: `IdentityService`, which authentication calls to create an account on
registration and to resolve an actor's org roles.

### Task 10 — feat/authentication

Credentials, OAuth identities, per-device sessions, scoped API tokens, the guards, and the
identity routes that task 9 left unmounted because they had no caller.

**scrypt rather than Argon2id.** Argon2id would be the first choice, but every Node binding
is a native module that has to compile on the deployment machine. scrypt is memory-hard, is
RFC 7914, and ships in `node:crypto` — a better trade than a build step for a service whose
whole dependency list is six packages. The stored form carries its own parameters
(`scrypt$N$r$p$salt$hash`) so raising the cost later still verifies old hashes, and
`needsRehash` upgrades one on the next successful sign-in.

**`jose` rather than a hand-rolled HS256.** Verifying a JWT is not primitive design, it is
format handling — and format handling is exactly where alg-confusion bugs live. The algorithm
is pinned on both sides, and there are tests for a tampered payload, a foreign signing key,
a wrong audience, and `alg: none`.

**Six decisions where the security is the design, not a check bolted on:**

* **The refresh token is an HttpOnly cookie; the access token is in the body.** Script on the
  panel's origin can read a JSON response and cannot read the cookie. The access token is
  short-lived and the panel needs it in memory to set a header.
* **Refresh tokens rotate, and reuse revokes everything.** A replayed token means it was
  captured, so refusing only that request is not enough — every session on the account goes.
* **An access token being validly signed is not enough.** Every request re-checks the session
  it names is still live, because a JWT stays valid for its whole TTL and signing out has to
  mean something sooner than that. The test asserts exactly this: log out, then present the
  still-unexpired token.
* **A failed sign-in verifies against a decoy hash** when the account does not exist, so the
  failing path costs what the succeeding one costs and the response cannot be used to
  enumerate registered addresses. The test asserts the two responses are byte-identical.
* **`requireSession` and `requireScope` are different guards.** A person's session satisfies
  any scope; an API token satisfies only what it holds, and is refused outright where a person
  is required — otherwise a leaked CI credential could mint itself a wider one, which is a
  test.
* **An account always keeps one way in.** Unlinking the last identity from an account with no
  password is refused.

**A route parameter helper was needed.** Express 5 types `req.params.x` as
`string | string[]`, because a pattern can repeat. None of these routes do, so an array means
the request did something the route was not written for — `pathParam` makes that a 400 rather
than a place to guess by taking the first element.

**Zod rejections are translated once, in the error handler**, into the documented
`validation_failed` envelope with the failing field paths. Otherwise every route would wrap
each `parse` in a try/catch to get the shape the contract promises.

Verified: `npm run check` green, 129 tests across ten suites, 32 of them new. The auth suite
takes about nine seconds, which is scrypt working as intended. Built and run for real:
registered an account, called `/me` with the returned token, got 401 anonymously, read the
public profile, and minted an API token whose secret appears exactly once.

Next task depends on: `requireScope('artifact:write')` and the `Actor` type, which the
catalogue uses for CI uploads.

### Task 11 — feat/product

The catalogue: products, versions, the storage layer, and the upload path with all nine
ordered checks.

**A hand-written zip reader, and it never decompresses.** `src/lib/zip.ts` parses the central
directory and reads five fields per entry. That is every fact the upload path needs — names,
count, declared uncompressed size, symlink bit — and decompressing to learn how big something
decompresses to is exactly how a zip bomb wins. A general-purpose zip library's default
behaviour is to extract, which is the one thing this must not do; the format is a frozen
published specification, so it is read rather than depended on.

**Path traversal is structurally absent, not defended against.** `generateStorageKey()`
returns a sharded ULID and nothing derived from the caller touches it. The uploaded filename
goes through `safeFileName` into `product_files.file_name` as *data*, whose only use is a
quoted `Content-Disposition` value. There is no code path joining a caller string onto a
path — a test asserts the stored key does not contain the uploaded name, and the disk
driver still re-checks the key's shape and that it resolves under the root, because a defence
that holds only while the layer above is correct is not a defence.

**The quota check is the write.** A conditional
`UPDATE ... WHERE storage_used_bytes + ? <= storage_quota_bytes`, with zero updated rows read
as a refusal. That is atomic on all four engines and needs no row lock, where the obvious
read-then-write lets two uploads racing on a nearly-full quota both pass the read. It also
avoids `FOR UPDATE`, which SQLite does not have.

**The object is written before the transaction, deliberately.** A failed transaction leaves an
unreferenced object, which a sweep can find; a committed row pointing at nothing cannot be
repaired. A refused publish deletes the object it wrote, and a test asserts that a rejected
upload leaves neither a row nor an object.

**A zip builder was written for the tests**, because no zip library will produce an archive
that is deliberately wrong in one specific way — an entry whose path escapes, a symlink, a
declared size that does not match its data. Two bugs in it were real and worth noting: `<<`
in JavaScript is signed, so both the CRC and the shifted Unix mode came back negative and
`writeUInt32LE` refused them.

**The threat model is written now, not in task 6.** `{shared}/creators/security-creator.md`
requires every row of a Surfaces table to name a guard a reader can open, and puts anything
unimplemented in `Open` instead. Written before the code, the whole page would have been
`Open` — a document that reads like protection and provides none. `wiki/security/artifact-upload.md`
names real files, gives a command per check, and is honest about the two gaps: nothing rate
limits yet, and artifacts are not signed.

**`wiki/security/artifact-upload.md` carries no frontmatter**, unlike the shape the security
creator shows. `wiki/` is plain markdown in this repository and its index says so. The two
shared documents disagree on this point; raised as a discovery finding rather than resolved
by inventing a local rule.

Verified: `npm run check` green, 187 tests across twelve suites, 58 of them new. Among them:
an escaping path, a backslash path, a symlink, a declared 4 GB expansion and a mod jar sent as
a plugin are each refused; `1.10.0` lists above `1.9.0`; a private product answers a stranger
exactly as a missing one does; deleting a version gives the storage back; and deleting a
product requires its id to be repeated in the body.

Next task depends on: `ProductService.resolve` and `fileOf`, which the fleet uses to turn a
desired version into a download and a checksum.

### Task 12 — feat/fleet

Registered servers, the inventory they report, the version the panel wants installed, and the
single payload the plugin polls for.

**A server's identity is a generated `server_key`, not its URL.** The original sketch made
`server_url` both the identity and globally unique. Two operators can legitimately run behind
one hostname, a server behind NAT has no public URL at all, and a URL changes when a host
does — none of which should orphan a server's history. The URL is now optional metadata,
unique per owner, and the key is returned exactly once at registration, the way an API token
is. Two tests hold that line: the key never appears in a later read, and two operators may
use the same URL while one operator may not use it twice.

**Reporting an inventory is a replacement, not a patch.** A plugin removed by hand on the
server simply stops appearing in the report; a patch would leave the row in the table forever.
The desired version survives the replacement deliberately — it is the panel's intent, and the
server does not get to overwrite it by reporting.

**`desired_version` plus `state` is what makes this a control plane** rather than an
inventory. The difference between the two columns *is* the work, and `desiredState` turns it
into actions. It refuses to emit three things: an action for a version already installed, an
action that would downgrade (a stale desired row after someone upgraded by hand), and an
action whose version has since been deleted from the catalogue — each silently skipped rather
than handing the plugin a download that would 404.

**`poll_after_seconds` comes from the server.** Poll interval is a property of how loaded this
service is, and a fleet that decides it independently cannot be slowed down when it needs to
be.

**A desired version is validated when it is set, not when it is polled.** The panel gets
`404 version_not_found` while the person is still looking at the form, rather than the plugin
discovering it hours later.

Verified: `npm run check` green, 205 tests across thirteen suites, 18 of them new — including
the full loop: report `2.19.0`, ask for `2.20.1`, receive an `update` action carrying the
checksum and the download URL, report `2.20.1`, and watch the drift close.

Next task depends on: nothing. The audit log wires into the modules that already exist.
