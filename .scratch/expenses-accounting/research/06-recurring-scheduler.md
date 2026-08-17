# 06 — Recurring-expense scheduling: mechanism, and a rule conflict to check first

Type: research findings

## Summary

`check:conformance` does not, in fact, reach scheduled or background writes — read as code
rather than as prose, it is a fixed pack of twenty-one static text/import rules, and "insert a
row outside a user's action" is not one of them. The rule in `docs/modules.md` is real as a
design principle (no bootstrap/seed inserts, ever), but it is not a lint that could tell a
cron-triggered `create()` from a request-triggered one — that distinction is not visible in
source text at all. Separately, this platform has already thought about exactly this shape:
ADR 0009 names "a payroll run on a schedule" as the trigger for building a scheduler, states
background jobs are "explicitly deferred by the spec," and confirms the only piece already
built is `Tenancy.runInCompany`, a seam for company-scoped work with no request behind it. No
job queue, `@nestjs/schedule`, `node-cron`, or any other scheduling mechanism exists anywhere in
the codebase today — recurring expenses would be the first module to need one.

---

## 1. Does `check:conformance` actually reach scheduled/background writes?

**No. It is scoped to a fixed, enumerable list of static-analysis rules, none of which concerns
who or what triggered an insert.**

### How it's wired

- `package.json:19` (root): `"check:conformance": "npm run check:conformance --workspace backend"`
- `backend/package.json:12`: `"check:conformance": "ts-node --project tsconfig.json src/platform/conformance/check.ts"`

### What `check.ts` actually runs

`backend/src/platform/conformance/check.ts:18-28` — `checkModuleConformance()` calls
`conformanceInput()` (reads the repo's manifests and source files, no database) and
`checkConformance(input)`, then throws `ConformanceError` if any violation is returned. It is a
pure function over source text — never inspects runtime call sites, never runs the application,
never sees an HTTP request or the absence of one.

### The exhaustive rule list

`backend/src/platform/conformance/pack.ts:40-65` — `checkConformance` is the sum of exactly:

```
checkImports(...)          // boundaries.ts
checkTableAccess(...)      // boundaries.ts
checkSharedPackage(...)    // boundaries.ts
checkFrontendModules(...)  // boundaries.ts
checkPermissionsDeclared(...) // module-rules.ts
...perModule (checkModule per manifest)   // module-rules.ts
```

`backend/src/platform/conformance/module-rules.ts:33-42` — `checkModule` is the sum of:
`publicSurface`, `companyScoping`, `permissionGrants`, `listShape`, `errorShape`,
`validatedBodies`.

Grepping every `rule: '…'` violation literal in `boundaries.ts` and `module-rules.ts` gives the
**complete** set of twenty-one rule names the pack can ever emit:

```
public-surface, model-classified, unscoped-prisma, hand-written-company-filter,
grant-declared, list-parameters, hand-rolled-paging, list-envelope (x2), error-shape (x2),
body-validated, permission-declared, backend-imports-ui, platform-imports-module,
cross-module-internals, undeclared-dependency, platform-internals, cross-module-tables,
shared-primitive-imports-contract, shared-package-area, shared-package-contract,
frontend-cross-module
```

None of these is about seeding, bootstrap inserts, or who/what initiates a write. They check:
public-surface existence, tenancy classification and hand-written `companyId`/`PrismaService`
use, permission-grant/manifest agreement, list-parameter and paging shape, error-throwing shape,
body validation, cross-module import/table/tier boundaries, and per-handler access decorators.
`backend/test/conformance.spec.ts:18-31` confirms this is the complete surface: the suite is
built explicitly to prove each of these named rules fires against a deliberately-violating
fixture, "so the pack cannot pass by doing nothing" — there is no rule under test, named or
implied, for "a row inserted with nobody acting."

### The other two static checks, for completeness

- `npm run check:modules` (`backend/src/platform/modules/check.ts` via `assembleModules`)
  checks only manifest-graph facts: dependency existence, cycles, tier direction, route/
  migration/model/name collisions, permission namespace shape, navigation-permission agreement,
  migration ordering. Nothing about inserts.
- `npm run check:tenancy` (`backend/scripts/check-tenancy.mjs:33`) greps only for
  `$queryRaw`/`$executeRaw` calls outside `test/harness`. Nothing about inserts either.

### Why the doc's rule can't be a text check anyway

`docs/modules.md:302-304` prefaces "What a module may not do" with "All of these are refused by
`npm run check:conformance`," and lists "Insert a row outside a user's action. The running
application seeds nothing, ever." (`docs/modules.md:313`) among them. Read against the code,
that line is not accurate as literally written: no rule in `module-rules.ts` or `boundaries.ts`
implements it, and none plausibly could as a *text* check — "was this `.create()` call reached
by an HTTP request or by something else" is not a fact regex/AST-over-source-text can see (ADR
0005, cited in `docs/modules.md:179-181`, is explicit that the whole pack is a text check rather
than a runtime one, for exactly the reason that it needs no database or running application).
The rule is real as an architectural/operating discipline — the codebase genuinely has no
seed scripts, no fixture data outside the test harness, and migrations create schema only — but
it is enforced by convention and the absence of any code path that does it, not by
`check:conformance` catching an attempt.

This is corroborated independently: ADR 0009's own audit of the pack
(`docs/adr/0009-foundation-audit-against-the-module-roadmap.md:283-313`, "What the conformance
pack fails to catch") lists seven concrete blind spots — untied event declarations, no
default-sort-vs-index check, text-defeatable rules, `permission-declared` proving *a* decorator
rather than the *right* one, runtime-only restriction enforcement, frontend API-path calls, and
migrations being outside every check — and does not mention "insert outside a user's action" at
all, in either direction. It was never in scope as a pack rule to begin with, so it does not
appear as a gap in the pack's own self-audit.

**Conclusion for the rule-conflict question: nothing in `check:conformance` would fail a build
that added a cron job writing expense rows.** The conflict the ticket asks about is real at the
level of *stated design principle* but not real at the level of *enforced code* — the build
would not catch it, and could not be made to by the same technique (a text scan) without also
being able to distinguish "seed data at boot" from "a company's own recurring business process,"
which is a runtime distinction the current pack architecture does not model.

---

## 2. If disallowed, what's the compliant shape? (Addressed as: what does the codebase itself anticipate?)

The codebase does not merely fail to forbid a scheduler — it has already reasoned about this
exact scenario and left a half-built seam for it, on the record.

`docs/adr/0009-foundation-audit-against-the-module-roadmap.md:186-194`:

> **A periodic, calculation-driven module.** Confirmed. `HrmService.calculatePayRun` computes
> over a date range... What it does not have is a **scheduler**: a pay run is an HTTP request
> somebody makes. Background jobs are explicitly deferred by the spec, and the expensive half
> of that seam is already built — `Tenancy.runInCompany` exists precisely so work outside a
> request can act as a company, and `DomainEvents.emit` names it in its refusal. The trigger to
> build the rest is the first module that must do something *nobody asked for at that moment*:
> a payroll run on a schedule, an e-commerce stock reconciliation, **a dunning notice**.

This is nearly the recurring-expense case verbatim (dunning notices are periodic, unattended,
finance-adjacent writes). Two structural facts follow from it:

- **`Tenancy.runInCompany`** (`backend/src/platform/tenancy/tenancy.ts:91`, doc comment at
  lines 78-90) is built explicitly "for work that is not a request — a test arranging state, a
  script, and eventually a scheduled job," and lets code establish a company context and act
  inside it without an HTTP request driving it. It is already used by the test harness and by
  scripts; nothing today calls it from an actual timer.
- **`DomainEvents`** refuses to be used outside a tenant scope with a message that names
  `runInCompany` as the alternative (`backend/src/platform/events/domain-events.ts:80`),
  confirming the same seam is meant to carry through to events, not just writes.

Given that, two shapes are both consistent with what the codebase has actually built, and the
choice is a design decision for the module ticket rather than something this rule forecloses:

1. **True unattended cron/timer**, using `Tenancy.runInCompany` to give the job a company
   context per tenant, then writing expense rows the normal service way. This is not blocked by
   `check:conformance` (section 1) and uses machinery the platform already has half-built for
   this purpose — but it requires adding the *other* half: something that actually triggers
   the job on a schedule, which does not exist anywhere in this codebase yet (section 3). ADR
   0009 frames that missing half as a deliberate, priced-later platform decision, not a
   per-module choice to make quietly — "the trigger to build the rest" implies it is expected
   to be built once, well, for whichever module needs it first.
2. **Lazy/pending-draft materialization**, matching the ticket's own suggested shape: a due
   recurrence sits as a row created by a genuine user action (defining the recurrence itself is
   a user's request), and the concrete expense instance materializes on the next authenticated
   request into that company — e.g., resolved at the point a user opens the expenses list or
   dashboard for that company, or via a lightweight check folded into an existing
   request-scoped path rather than a new unattended process. This keeps every row's insert
   traceable to an HTTP request the same way every other module's writes are today, requires
   no new dependency, and needs nothing beyond what already exists (`runInCompany` isn't even
   required, since the work happens inside a real request's tenant scope already established by
   the existing middleware/guard). It also matches the codebase's existing empty-state
   philosophy (`README.md:79-80`, "an empty screen is the normal first experience of every
   feature") — a not-yet-materialized recurrence is just another empty/pending state a screen
   already has to render.

Because option 1 requires the platform to acquire its first scheduling mechanism — a bigger,
cross-cutting decision ADR 0009 explicitly frames as a "trigger to build," not a per-ticket
implementation detail — option 2 is the shape that stays inside what a single module ticket can
decide on its own, without also deciding platform-wide scheduling infrastructure by accident.

---

## 3. Fact-check: does anything already run scheduled or background work?

**No. Nothing in this codebase runs on a timer today. This would be the first such mechanism.**

- No scheduling package anywhere: grepped `@nestjs/schedule`, `node-cron`, `node-schedule`,
  `agenda`, `bull`/`bullmq`, and bare `cron` across every `package.json` in the repo (root,
  `backend/`, `application/`, `packages/`) — zero matches.
  - `backend/package.json:22-47` (full dependency list): only `@nestjs/common`,
    `@nestjs/core`, `@nestjs/jwt`, `@nestjs/platform-express`, `@prisma/client`, `dotenv`,
    `reflect-metadata`, `rxjs`, plus dev tooling (`@nestjs/cli`, `@nestjs/testing`, `jest`,
    `prisma`, `supertest`, `ts-jest`, `ts-node`, `typescript`). No `@nestjs/schedule`.
  - `package.json` (root, workspaces config): only `concurrently` and `typescript` as dev
    dependencies.
  - `application/package.json`: no matches for cron/schedule/queue/bull/agenda/worker.
- No hand-rolled timer either: grepped `setInterval`, `setTimeout`, `OnModuleInit`,
  `onApplicationBootstrap` across `backend/src` — the only hit is
  `backend/src/prisma/prisma.service.ts:16-24`, which is `PrismaService`'s
  `onModuleInit`/`onModuleDestroy` connecting/disconnecting the Prisma client at process
  start/stop — ordinary connection lifecycle, not a recurring job.
- The one piece of related plumbing that *does* exist, `Tenancy.runInCompany`
  (`backend/src/platform/tenancy/tenancy.ts:91`), is not itself a scheduler — it is the
  "act as a company outside a request" primitive a scheduler would need to call into, and its
  own doc comment (lines 78-90) says a scheduled job is something it exists for "eventually,"
  not something wired to it today.
- `.scratch/erp-foundation-inventory/issues/14-foundation-audit-against-module-roadmap.md:112-117`
  independently states the same conclusion as an accepted, ticketed-later gap: "no scheduler
  (the expensive half, `Tenancy.runInCompany`, already exists)."

## Files read / cited

- `.scratch/expenses-accounting/issues/06-recurring-scheduler.md` — the ticket
- `README.md`, `docs/modules.md` — platform rules and the conformance-pack description
- `backend/package.json`, root `package.json`, `application/package.json` — dependency fact-check
- `backend/src/platform/conformance/check.ts`, `pack.ts`, `module-rules.ts`, `boundaries.ts` —
  the enforcing code itself
- `backend/test/conformance.spec.ts` — proof the rule list above is exhaustive
- `backend/scripts/check-tenancy.mjs` — the raw-SQL check, for completeness
- `backend/src/platform/tenancy/tenancy.ts` — `Tenancy.runInCompany`
- `backend/src/platform/events/domain-events.ts` — the event-emission refusal naming
  `runInCompany`
- `backend/src/prisma/prisma.service.ts` — ruled out as a background-job mechanism
- `docs/adr/0009-foundation-audit-against-the-module-roadmap.md` — the platform's own prior
  reasoning about a scheduler, background jobs, and the conformance pack's real blind spots
- `.scratch/erp-foundation-inventory/issues/14-foundation-audit-against-module-roadmap.md` —
  corroborates "no scheduler yet" as an accepted, deferred gap
