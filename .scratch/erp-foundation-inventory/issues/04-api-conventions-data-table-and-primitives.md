# 04 — API conventions, the shared data table, and exact numbers

**What to build:** The list experience every screen reuses, the conventions all forty modules
follow, and the numeric primitives everything else depends on.

On screen: a list with a clear empty state on a fresh account, then sorting, filtering, searching
and paging once data exists, staying fast as it grows, with distinct loading and error states.

Underneath: one list shape, one error shape, one filter and sort convention — and money and
quantity types that stay exact. Those must land before any ledger exists, because retrofitting
numeric precision after movements have accumulated means rewriting history.

Everything here is a **primitive with no business meaning**, which is what earns it a place in the
shared package. Anything with rules, tables or screens is a module instead.

**Blocked by:** 03 — Tenant scoping, and the HRM shape stub

**Status:** done

- [x] One list response shape is used by all list endpoints, carrying items and paging information
- [x] One error response shape carries a machine-readable code and a human-readable message
- [x] Validation failures identify the offending fields
- [x] Search, filter, sort and pagination follow one convention across all modules
- [x] Request and response types live in the shared package and are used by both workspaces
- [x] A shared table component provides sorting, filtering and paging with hand-written markup
- [x] The table is built on headless logic only; nothing renders markup or CSS on our behalf
- [x] Server data is managed by a shared query layer providing caching and refresh after changes
- [x] Screens show distinct empty, loading and error states, with empty guiding the first action
- [x] The list stays responsive with several thousand records
- [x] Monetary values and quantities are stored and computed with exact precision, never floating
      point, and quantities support fractional amounts
- [x] Currency is carried with monetary values rather than assumed
- [x] Arithmetic across differing currencies is refused rather than silently wrong
- [x] Rounding happens only at explicit, defined points
- [x] Values survive database to API to browser and back without alteration
- [x] Shared input and display components format and validate these types consistently
- [x] Backend tests cover paging, filtering, sorting, the error shape, and precision across long
      sequences of arithmetic
- [x] Frontend tests cover rendering, sorting, filtering, paging, and the three states

## Comments

**2026-08-01 — an open question ticket 03 hands over, to settle before the convention is written.**

Ticket 03 made restricted fields real: `Employee.annualSalary` and `PayRunLine.grossPay` are
company-scoped *and* further restricted by a grant. Naming one in a filter, a sort, a
`groupBy`, a `distinct` or an aggregate without the grant throws `RestrictedFieldError` — a
plain `Error`, so the API answers **500**.

That is correct today, because no endpoint accepts a field name from a caller: reaching it
requires writing the query in module code, which is a bug and deserves an unhandled failure.
It stops being correct the moment this ticket's *"one filtering and sorting convention"*
turns field names into query-string input. `?sort=annualSalary` would then be a URL a user can
type, and a 500 is the wrong answer to it.

So the sort-and-filter convention needs a decision: does a caller naming a column they may not
read get a 403, a 422 naming the field, or a silently dropped clause? A silent drop is the
worst of the three — a list that quietly ignores the sort it was asked for looks broken rather
than refused. Whatever is chosen, `RestrictedFieldError` needs a translation into the one error
shape at the boundary, which is this ticket's own subject.

See `docs/tenancy.md` and ADR 0003.

**2026-08-01 — what ticket 03 left for this one to replace.**

Three things were written against the shapes this ticket settles, each with a note saying so.
None of them is a surprise; they are listed here so the replacement is a checklist rather than
an archaeology exercise.

- **Hand-written validation.** `backend/src/modules/identity/validation.ts` and
  `backend/src/modules/hrm/validation.ts` both produce the field-level shape this ticket's pipe
  will produce. Both files go when it lands.
- **Placeholder list shapes.** `EmployeeListResponse` is `{ employees: [...] }` and
  `PayRunListResponse` is `{ payRuns: [...] }`, with no paging. They become whatever the one
  list shape is.
- **The first money on the wire.** `hrm.service.ts` has a private `money()` helper serialising
  `Prisma.Decimal` to a fixed-2 decimal string, and no currency travels with it. This ticket's
  monetary primitive replaces it — and its "currency is carried rather than assumed" criterion
  is the part `money()` does not meet.

`money()` also documents a real edge worth carrying into the primitive: when the platform
withholds a restricted field, Prisma's generated row type still says the column is there, so
the value is `undefined` at runtime against a non-optional type. Any shared serialiser for
money has to survive that.

**2026-08-02 — the four decisions this ticket had to make, and where they went.**

All four are written up in `docs/adr/0004-list-envelope-sort-filter-and-exact-numbers.md`,
with the alternatives and the triggers to revisit. In brief:

- **A caller naming a restricted column gets a 403** with the code `field_restricted`, naming
  the field — the question the comment above handed over. Not a 422, which would report a
  refusal as a typo, and not a silent drop. Nothing in the list convention knows which fields
  are restricted: the tenancy extension refuses and `ApiExceptionFilter` translates, so the
  restriction table stays in one file. `RestrictedFieldError` and `RestrictedRecordError`
  therefore became the only two tenancy refusals that are not a 500.
- **Paging is offset-and-total, overturning the spec's proposed default of cursors.** The
  deliverable is a table a user drives, and "page 3 of 12" and a row count are what it shows;
  neither is expressible with a cursor. The revisit trigger is a list expected past roughly a
  hundred thousand rows per company — the ledger in ticket 09 is the first candidate.
- **Exact numbers are hand-rolled fixed point over `bigint`**, no dependency. `plus`, `minus`
  and `times` are exact; `dividedBy` and `round` have no overload without a scale and a
  rounding mode, so "rounding only at explicit points" is a signature rather than a comment.
- **Currency comes from a constant**, not from a column. Recorded as a gap against ticket 14 —
  see below.

**2026-08-02 — what this ticket replaced, and what it moved.**

The three things ticket 03 listed are gone: both hand-written `validation.ts` files, the two
placeholder list shapes (`EmployeeListResponse` and `PayRunListResponse` are now
`ListResponse<T>`), and `hrm.service.ts`'s private `money()` helper — replaced by `Money`,
which handles the withheld-field edge that helper documented, in one place for every module.

Two things moved rather than being written new. `Field` and `FormError` moved from
`application/src/modules/identity/components/` into `@erp/shared/ui`, which ticket 03's own
comment said would happen "when a second module needs a form" — `MoneyInput` is built on
`Field` rather than beside it. And the hrm manifest gained its first navigation entry, so the
stub now has a screen; it is the right one to prove the conventions against, because its list
has a column most callers may not read.

`@erp/shared/ui` is a second entry point on the shared package rather than a new workspace, so
the backend keeps importing `@erp/shared` without acquiring React. `application`'s `pretest`
now rebuilds the shared package, because the frontend suite runs against its compiled output.

**2026-08-02 — deferred, and to where.**

- **Currency is stored nowhere.** `Money` carries it on the wire, in the type, and refuses
  cross-currency arithmetic — but a newly created value takes its currency from
  `DEFAULT_CURRENCY` rather than from the company. Multi-currency is out of scope per the
  spec, so the constant is honest rather than a shortcut, and moving the assumption to a
  stored column is a change to one constant's callers rather than to the type. Recorded
  against ticket 14.
- **A handler that forgets `@Body(validated(…))` gets an unchecked body.** The pipe is
  declared per parameter because request shapes are interfaces in the shared contract and do
  not survive to runtime, so there is no class for a global pipe to read. The same bargain as
  `@Public()`, and made in the same place — visible on the handler. Ticket 05's conformance
  pack is where it becomes a test rather than a convention.
- **`QuantityInput`, `QuantityText` and `formatQuantity` ship with no consumer.** The
  criterion is "shared input and display components format and validate *these types*", and
  quantities are one of the two; their first real caller is stock movements in ticket 09. They
  are not untested machinery, though — `ExactField` underneath them is what `MoneyInput` uses
  and is covered through it, and only the scale differs.

**2026-08-02 — what `/code-review` found, and what changed because of it.**

One real bug, in the tenancy platform rather than in this ticket's new code, and it
contradicted this ticket's own ADR. `hideRestrictedRows` checked for the restricted-record
flag only at the **top level** of a `where`. The list convention nests filters under an `AND`
whenever a search is present, so `?filter.confidential=true&search=ada` slipped past the
check, had the platform's own `confidential: false` ANDed onto it, and came back **200 with no
rows** — the silent drop ADR 0004 rejects in as many words. It is now checked by the same walk
that checks restricted *fields*, so it holds inside `AND`, `OR`, `NOT` and across a relation.
Covered at both seams.

The rest were smaller and are all fixed:

- The employee list had no index behind its default sort, so the ADR's claim that "the indexes
  that make the sort fast make the offset fast too" was unbacked — the 5,000-row test passed
  by sorting in memory. Added `employees(company_id, name)`, and the ADR now states the
  obligation rather than assuming it.
- Frontend filtering was a `filters` slot with no consumer and no test, against two criteria
  that name filtering. The screen now has an "Added since" control on
  `filter.createdAt.gte`, with tests for it and for clearing it back to the empty state
  rather than the no-matches one.
- `SearchBox` hard-coded `id="list-search"`, so two tables on one screen would have shared a
  DOM id and mislabelled one of them. Generated with `useId` now.
- `README.md` still said there were two exceptions to the test-seam rule while this ticket
  added a third (`numeric.spec.ts`); the `DataTable` example in `docs/api-conventions.md`
  omitted two required props; and the doc and the component disagreed about three states
  versus four. All three corrected.
- Duplicated sort-order construction extracted; `emptyPage` given the call site it was written
  for; `filterableFields` put to use, so a rejected filter now lists the ones that work, as a
  rejected sort already did.

**2026-08-02 — one bug only running the app could find, and it has no test.**

Every check was green — typecheck, both suites, the build — and the screen was still visibly
wrong: the table's `sr-only` caption rendered as a stray word above the header, the search box
and its button overlapped, and the amounts lost `tabular-nums`.

One cause. Tailwind scans the project for class names and deliberately skips `node_modules`,
and `@erp/shared/ui` resolves through `node_modules` to the shared package's build output — so
every class used *only* by a shared component was missing from the stylesheet. Classes that
happen to be used in `application/` as well kept working, which is what made one cause look
like three unrelated glitches. Fixed with `@source "../../packages/src/ui"` in
`application/src/index.css`; the stylesheet went from 9.1 kB to 14.9 kB, which is the size of
what had been silently dropped.

**It is not covered by a test, and deliberately not.** The obvious assertion — that the
caption carries `sr-only` — passes just as happily *before* the fix, because jsdom renders no
real CSS and the class was always in the markup. A test that cannot fail for the reason it
claims to exist is worse than none. What guards it is the comment in `index.css`, and the fact
that this is now a known failure mode for the next module that adds a shared component.

The general lesson for later tickets: **`@erp/shared/ui` is invisible to Tailwind by default.**
Every new shared component's classes depend on that one `@source` line, and the failure is
silent.
