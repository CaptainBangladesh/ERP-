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

**Status:** ready-for-agent

- [ ] One list response shape is used by all list endpoints, carrying items and paging information
- [ ] One error response shape carries a machine-readable code and a human-readable message
- [ ] Validation failures identify the offending fields
- [ ] Search, filter, sort and pagination follow one convention across all modules
- [ ] Request and response types live in the shared package and are used by both workspaces
- [ ] A shared table component provides sorting, filtering and paging with hand-written markup
- [ ] The table is built on headless logic only; nothing renders markup or CSS on our behalf
- [ ] Server data is managed by a shared query layer providing caching and refresh after changes
- [ ] Screens show distinct empty, loading and error states, with empty guiding the first action
- [ ] The list stays responsive with several thousand records
- [ ] Monetary values and quantities are stored and computed with exact precision, never floating
      point, and quantities support fractional amounts
- [ ] Currency is carried with monetary values rather than assumed
- [ ] Arithmetic across differing currencies is refused rather than silently wrong
- [ ] Rounding happens only at explicit, defined points
- [ ] Values survive database to API to browser and back without alteration
- [ ] Shared input and display components format and validate these types consistently
- [ ] Backend tests cover paging, filtering, sorting, the error shape, and precision across long
      sequences of arithmetic
- [ ] Frontend tests cover rendering, sorting, filtering, paging, and the three states

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
