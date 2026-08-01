# ERP

A modular monolith ERP platform for mid-market businesses (20–500 people), built to carry
forty-plus modules across three tiers — Core, Enterprise, and Custom industry add-ons.

The plan lives in [`.scratch/erp-foundation-inventory/`](.scratch/erp-foundation-inventory/):
[the spec](.scratch/erp-foundation-inventory/spec.md) and
[fourteen tickets](.scratch/erp-foundation-inventory/issues/README.md).

**Current state: ticket 01 complete.** The walking skeleton runs and both test harnesses work.
There is no business functionality yet — ticket 02 adds sign-up and sign-in.

## Getting started

You need Node 20+, Docker, and about two minutes.

```bash
npm install
npm run db:up                 # PostgreSQL on port 55432, both databases
cp backend/.env.example backend/.env
npm run db:migrate --workspace backend
npm run dev
```

Then open http://localhost:5173. The database is empty, so the page shows a count of zero and
a button. Press it and the count becomes one.

That is the whole of ticket 01: proof that a read path and a write path work through every
layer — React, NestJS, Prisma, PostgreSQL — without a single seeded row.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Backend on :3000 and frontend on :5173, together (rebuilds the shared package first) |
| `npm test` | Both suites — backend against real PostgreSQL, frontend with the network intercepted. Migrates the test database first, so it works on a fresh clone |
| `npm run typecheck` | All three workspaces |
| `npm run build` | Shared package, backend, frontend |
| `npm run db:up` / `db:down` | Start / stop the PostgreSQL container |
| `npm run db:migrate` | Apply migrations to the development database |

## Layout

```
packages/      @erp/shared — primitives with no business meaning
backend/       @erp/backend — NestJS, Prisma, PostgreSQL
application/   @erp/application — React, Tailwind, TanStack Query
.scratch/      the spec and the tickets
```

## The rules this codebase is built on

**No seed data, ever.** The running application inserts nothing — not at startup, not in
migrations. Migrations create schema only. Every company, user, role, product and stock
movement is something a user typed. Test fixtures create data, but only inside the test
harness.

The consequence is that an empty screen is the normal first experience of every feature, so
**empty states are acceptance criteria, not polish**.

**Two test seams, and only two.**

- *Backend*: tests boot the real Nest application and drive it over HTTP against a real
  PostgreSQL database. Nothing is mocked. See `backend/test/`.
- *Frontend*: page components rendered with the network intercepted, asserting on what a user
  sees and does. Never on hooks or component state. See `application/src/test/`.

No unit tests on services, repositories, or components. While the module contract is still
being designed, tests bound to internal structure would calcify the decisions that most need
to stay movable.

Both suites run in CI (`.github/workflows/ci.yml`) against a real PostgreSQL service, along
with typecheck and build. Module boundary enforcement joins them there in ticket 05 — it is a
static check, not a runtime test.

**Errors name themselves.** Throw `ApiException` with an explicit machine-readable code
wherever a caller might branch on *which* failure occurred. Deriving the code from the HTTP
status alone would make every conflict in the system indistinguishable — a client could not
tell "that SKU already exists" from "that product still has movement history". The fallback
to a status-derived code stays for failures nobody branches on, such as a missing route.

**The shared package holds primitives only.** Money, quantities, identifiers, pagination and
error shapes. Anything with rules, tables or screens is a module — including domain concepts
like parties and products, which are Core modules rather than shared utilities. A shared
package that accumulates domain concepts becomes a second application that everything depends
on and nobody owns.

**Frontend dependencies must render nothing.** Headless behaviour libraries are permitted
(TanStack Query, TanStack Table); anything shipping DOM or CSS is not. Every component is
hand-built with Tailwind.

## What is deliberately temporary

The skeleton probe — its table, its endpoints, its page, and its shared types — exists only to
prove the paths through each layer without seeding. Ticket 02 deletes all of it and replaces it
with the first real module. Each piece is marked `TEMPORARY` in the source.
