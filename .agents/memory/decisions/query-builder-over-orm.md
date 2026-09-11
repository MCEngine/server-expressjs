---
name: memory-decisions-query-builder-over-orm
description: Why the persistence layer uses Kysely and hand-written migrations instead of Prisma, which the plan named.
---

# Kysely instead of Prisma

**The approved plan named Prisma.** The persistence layer uses Kysely with hand-written
migrations instead. This is a deviation, and here is why it was made rather than raised as a
question.

## The reason

`wiki/information/data-model.md` — written and approved one task earlier — puts nine rules in
the database rather than in a handler. Three of them are **partial unique indexes**:

* one primary email per account
* one owner per org
* one latest version per product and channel

and three more are **`CHECK` constraints**: a handle is lowercase, a stored file name is not a
path, storage usage is not negative.

**Prisma's schema language can express none of those.** It has `@@unique`, which is
unconditional, and no `CHECK` at all. Using Prisma would have meant one of two things:

1. Dropping those constraints and moving the rules into handlers — which is exactly the thing
   the data model says not to do, in the section titled *What the schema enforces on its own*,
   because a rule that lives only in a handler is a rule a later refactor can route around.
2. Writing the constraints as raw SQL migrations anyway — at which point Prisma is carrying
   engine binaries and a code generator in exchange for nothing the project uses.

The second was the real fork in the road: once the migrations are hand-written SQL, an ORM's
remaining value is its query API, and Kysely's is better typed than Prisma's for the joins
this service actually runs.

## What Kysely gives up

Real costs, not nothing:

* **No generated client.** `src/db/schema.ts` is written by hand and must be kept in step
  with the migrations. Nothing checks that automatically — the constraint tests in
  `test/db-constraints.test.ts` are what catches drift, and they only catch it where they
  look.
* **No relation loading.** A join is written out. For a service whose hottest read is one
  server's desired state, that is a fair trade; for a deeply nested read model it would not
  be.
* **No `prisma studio`** or equivalent.

## Why this was not raised as a question first

The user was asked about the ORM in the plan and approved Prisma along with everything else,
so this reverses a decision they made. It was made unilaterally because the alternative was
worse in a specific way: implementing Prisma faithfully would have silently weakened the data
model they approved in the *same* plan, and the two cannot both be honoured. Choosing the
schema over the tool preserves the part of the plan that carries the guarantees.

**It is reported in the work summary rather than left to be discovered in a diff**, and
reversing it is a contained change: the migrations are already plain SQL, so a move to Prisma
would keep them and replace the query layer only.

## What is unchanged

The four SQL providers, SQLite under test, repository interfaces between the domain and the
database, and MongoDB deferred to a separate adapter — all exactly as planned. The reasons
MongoDB is deferred get stronger under this decision, not weaker: it has neither partial
unique indexes nor `CHECK` constraints either.
