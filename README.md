# ERP

A modular monolith ERP platform for mid-market businesses (20–500 people), built to carry
forty-plus modules across three tiers — Core, Enterprise, and Custom industry add-ons.

The plan lives in [`.scratch/erp-foundation-inventory/`](.scratch/erp-foundation-inventory/):
[the spec](.scratch/erp-foundation-inventory/spec.md) and
[fourteen tickets](.scratch/erp-foundation-inventory/issues/README.md).

**Current state: ticket 02 complete.** The module contract exists and identity and access is
the first module built against it. You can create a company, sign in, and sign out. Ticket 03
adds automatic tenant scoping.

## Getting started

You need Node 20+, Docker, and about two minutes.

```bash
npm install
npm run db:up                 # PostgreSQL on port 55432, both databases
cp backend/.env.example backend/.env
npm run db:migrate --workspace backend
npm run dev
```

Then open http://localhost:5173. The database is empty, so there is nothing to sign in to —
create a company, and you become its owner by having created it.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Backend on :3000 and frontend on :5173, together (rebuilds the shared package first) |
| `npm test` | Both suites — backend against real PostgreSQL, frontend with the network intercepted. Migrates the test database first, so it works on a fresh clone |
| `npm run typecheck` | All three workspaces |
| `npm run check:modules` | Assembles the module graph and refuses a broken one. No database needed |
| `npm run check:tenancy` | Refuses raw SQL, which bypasses tenant scoping. No database needed |
| `npm run build` | Shared package, backend, frontend |
| `npm run db:up` / `db:down` | Start / stop the PostgreSQL container |
| `npm run db:migrate` | Apply migrations to the development database |

## Layout

```
packages/      @erp/shared — primitives, plus each module's wire contract
  src/ui/        @erp/shared/ui — the data table and shared inputs. React lives only here
backend/       @erp/backend — NestJS, Prisma, PostgreSQL
  src/platform/  the module contract, the auth seam, navigation, lists, validation. Not a module
  src/modules/   the modules. Found by looking, never by a list
application/   @erp/application — React, Tailwind, TanStack Query
  src/modules/   screens, mirroring the backend modules
.scratch/      the spec and the tickets
```

## The rules this codebase is built on

**Modules declare manifests; the application assembles itself.** A module states its name,
tier, dependencies, routes, migrations, permissions, navigation and events, and is found
because its directory exists. There is no central registry, and adding the fortieth module
edits no existing file. See [`docs/modules.md`](docs/modules.md) and
[ADR 0001](docs/adr/0001-modules-declare-manifests.md).

The build refuses a graph it cannot assemble — a cycle, a missing dependency, a Core module
reaching up a tier, two modules claiming one route — and names the modules involved.

**Module code never writes a company filter.** Every business row belongs to a company, and
scoping is applied to every query by the platform — so forgetting a `where: { companyId }` is
not a mistake that can be made rather than one that is discouraged. A query with no company
throws; a table that belongs to no company has to say so and say why, or the application
refuses to boot. See [`docs/tenancy.md`](docs/tenancy.md) and
[ADR 0003](docs/adr/0003-tenant-scoping-by-prisma-client-extension.md).

**No seed data, ever.** The running application inserts nothing — not at startup, not in
migrations. Migrations create schema only. The first company in the database is the one
somebody typed into the sign-up form, and they are its owner because they created it, not
because a role row says so. Test fixtures create data, but only inside the test harness.

The consequence is that an empty screen is the normal first experience of every feature, so
**empty states are acceptance criteria, not polish**.

**Endpoints are guarded by default.** A global guard requires a valid session everywhere;
`@Public()` on a handler is the only way out, and sign-up and sign-in are its whole
legitimate use. The platform declares a `SessionAuthority` seam and identity implements it,
so the guard protects every module without the platform knowing any module exists.

**Two test seams, and only two.**

- *Backend*: tests boot the real Nest application and drive it over HTTP against a real
  PostgreSQL database. Nothing is mocked. See `backend/test/`.
- *Frontend*: page components rendered with the network intercepted, asserting on what a user
  sees and does. Never on hooks or component state. See `application/src/test/`.

No unit tests on services, repositories, or components. There are three exceptions, and each
earns it the same way — its subject is not observable from a request:

- `module-contract.spec.ts` — the assembler's deliverable is its refusals, and an application
  that refuses to assemble never starts to be driven over HTTP.
- The parts of `tenancy.spec.ts` that drive the scoped Prisma client directly. "A query with
  no company throws" and "an immutable row cannot be updated" describe queries no endpoint
  offers, because the endpoint that offered them would be the bug. Everything about tenancy
  that *is* reachable over HTTP — and that is most of it, including the whole of the
  two-company isolation suite — is asserted over HTTP.
- `numeric.spec.ts`, on the exact-number primitives. There is no route that divides by zero,
  none that adds pounds to dollars, and none that rounds a tie — and a rounding mode wrong in
  one direction is the bug that costs a company money quietly over a year rather than loudly
  on a Tuesday. What *is* observable at the seam is asserted there instead:
  `api-conventions.spec.ts` covers the wire shape, the round trip through Postgres, and drift
  across a year of pay runs.

Both suites run in CI (`.github/workflows/ci.yml`) against a real PostgreSQL service, along
with typecheck, the module contract check, the tenancy check, and build. Module boundary
enforcement joins them in ticket 05 — it is a static check, not a runtime test.

**Errors name themselves.** Throw `ApiException` with an explicit machine-readable code
wherever a caller might branch on *which* failure occurred. Deriving the code from the HTTP
status alone would make every conflict in the system indistinguishable — a client could not
tell "that SKU already exists" from "that product still has movement history". Validation
failures additionally name the fields at fault, because a form can only put a message beside
the right box if the response says which box.

**One list shape, one way to ask for a slice of it.** Every list endpoint returns items plus
a page, and accepts the same `page`, `pageSize`, `sort`, `search` and `filter.*` parameters. A
module declares which of its fields participate and writes no paging, sorting or filtering
code — which is what lets one shared table serve every screen. A field the caller may not read
is a 403 naming it, never a silently dropped clause. See
[`docs/api-conventions.md`](docs/api-conventions.md) and
[ADR 0004](docs/adr/0004-list-envelope-sort-filter-and-exact-numbers.md).

**Money and quantities are never a `number`.** Exact decimals over `bigint`, from the
`numeric` column to the input box, with the currency carried alongside the amount and
cross-currency arithmetic refused. Addition and multiplication are exact; division and
rounding *demand* a scale and a rounding mode, so rounding only ever happens where somebody
asked for it. Retrofitting this after a ledger has accumulated means rewriting history, which
is why it lands before there is one.

**The shared package holds primitives only.** Money, quantities, identifiers, pagination and
error shapes, the data table — plus each module's wire contract under
`modules/<name>/contract.ts`, which is request and response shapes and nothing else. Anything
with rules, tables or screens is a module, including domain concepts like parties and
products. A shared package that accumulates domain concepts becomes a second application that
everything depends on and nobody owns.

Its React components live behind a second entry point, `@erp/shared/ui`, so the backend can
import the contracts without acquiring React.

**Frontend dependencies must render nothing.** Headless behaviour libraries are permitted
(TanStack Query, TanStack Table); anything shipping DOM or CSS is not. Every component is
hand-built with Tailwind. Routing is a short hand-written file (`src/app/location.ts`)
rather than a dependency, and stays that way only until nested routes or parameters make a
library the smaller answer.
