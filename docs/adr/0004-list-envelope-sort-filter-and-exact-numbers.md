# ADR 0004 — One list envelope, offset paging, and exact numbers on bigint

Status: accepted (ticket 04)

## Context

Ticket 04 settles the conventions every one of forty-plus modules copies: the shape a list
endpoint returns, the way a caller asks for a page, a sort, a filter or a search, and the
types money and quantities are carried in. All four are cheap to choose now and expensive to
change once several modules have shipped screens against them.

Four questions were genuinely open. Ticket 03 handed over the first one explicitly.

1. **What answers a caller who names a column they may not read?** Ticket 03 made restricted
   fields real: naming `Employee.annualSalary` in a filter or a sort without the
   `hrm:pay:read` grant throws `RestrictedFieldError`, a plain `Error`, so the API answers
   **500**. That was correct while no endpoint took a field name from a caller. This ticket
   turns field names into query-string input, and `?sort=annualSalary` is now a URL a user
   can type.
2. **Cursor or offset paging?** The spec's proposed default is cursor-based.
3. **Where does a monetary value's currency come from?**
4. **What implements exact decimal arithmetic**, given it has to run in the Nest backend
   (CommonJS) and in the browser (ESM), so `Prisma.Decimal` is not available to it?

## Decision

### 1. A restricted field named by a caller is a 403, not a 422 and never a silent drop

A list endpoint declares which of its fields are sortable, filterable and searchable. A name
outside that set is a **422** — it is a bad value for the `sort` parameter, and it is named in
the error's `fields` map like any other bad input.

A name **inside** that set that the caller may not read is a **403** with the code
`field_restricted`, naming the field in its message.

The distinction is the point. "That is not a sortable field" and "you are not allowed to sort
by that field" are different facts, and answering the second with the first tells a user their
request was malformed when it was refused. A silent drop was rejected outright, as ticket 03
argued: a list that quietly ignores the sort it was asked for looks broken rather than
refused, and the user has no way to tell which.

There is no meaningful disclosure in admitting the field exists. `EmployeeResponse.annualSalary`
is in the shared contract, typed `string | null` precisely so a caller without the grant can
still read the list; the field's existence is public and only its value is not.

**`RestrictedFieldError` and `RestrictedRecordError` are translated at the boundary** into
that 403, in `ApiExceptionFilter`. This is the whole of the mechanism — the list convention
does not carry a second copy of which fields are restricted. `platform/tenancy/company-owned.ts`
knows, the extension refuses, and the filter translates. A pre-check in the query layer would
be a second opinion that could disagree with the first, which is the failure mode this
codebase avoids elsewhere (see `HrmService.removeEmployee`, which lets the database's
`RESTRICT` speak rather than checking first).

The cost, accepted: module code that names a restricted field *by mistake* now answers 403
rather than 500, so a programming error is reported as an access refusal. It is not a wrong
answer — the caller genuinely lacks the grant — and the full developer-facing message is still
logged. The remaining tenancy errors (`MissingCompanyContextError`, `CrossCompanyError`,
`ImmutableRecordError`, `TenantRootWriteError`) stay 500, because for those there is no client
behaviour that would be correct.

### 2. Offset paging with a total — overturning the spec's proposed default

```
GET /api/hrm/employees?page=2&pageSize=25&sort=-name

{ "items": [ … ], "page": { "number": 2, "size": 25, "total": 287, "pages": 12 } }
```

The spec proposes cursor-based pagination and marks it overturnable. It is overturned here for
three reasons:

- This ticket's own deliverable is a table a user drives. "Page 3 of 12" and a total row count
  are what that table shows, and cursor pagination can produce neither.
- The convention has to support sorting by an arbitrary declared column. A keyset cursor then
  has to be composite — `(sortValue, id)` — and has to answer for nulls, ties, and a sort
  column changing between pages. That is a great deal of machinery for every module to inherit.
- `OFFSET` degrades when the offset is large. The product targets businesses of 20–500 people
  and the ticket's own bar is "responsive with several thousand records". Nothing in scope
  reaches the offset depth where that matters — **provided the sort is an index walk**, which
  is a real obligation and not a hope: without an index the database sorts the whole company's
  rows to answer for twenty-five of them, and the offset is then the least of it. So every
  list endpoint's default sort carries an index on `(company_id, <sort column>)`. The
  employee list's is `employees(company_id, name)`, added by this ticket, and the pattern is
  written down beside it in `schema.prisma`.

The trade-off is real and is written down rather than hidden: offset paging can skip or repeat
a row if data changes between requests, and it is the wrong choice for an unbounded feed. The
trigger to revisit is a list endpoint whose table is expected to exceed roughly a hundred
thousand rows per company — the ledger in ticket 09 is the first candidate — at which point a
second envelope for that endpoint is a smaller change than having built composite cursors for
forty modules that never needed them.

### 3. Currency is a platform constant until multi-currency exists

`Money` **carries** its currency: it is on the wire on every monetary value, it is part of the
type, and arithmetic between two different currencies throws rather than producing a number.
That is the part that is expensive to retrofit and it is done.

Where the currency *comes from* is `DEFAULT_CURRENCY` in the shared package. Multi-currency is
explicitly out of scope in the spec, and the alternative — a `currency` column on `companies`,
set at sign-up and carried on the session — buys nothing today that the constant does not,
while adding a migration to identity's schema and a field to the session principal.

This half-meets the ticket's "currency is carried rather than assumed" criterion and is
recorded as such: the value is carried everywhere it travels and assumed at exactly one point,
the point at which it is first created. Moving that point to a stored column is a change to one
constant's callers, not to the type. The gap is written into ticket 14, the foundation audit.

### 4. Exact numbers are hand-rolled fixed point over `bigint`

`Decimal` in the shared package is an immutable value holding a `bigint` of scaled units and an
integer scale. No dependency.

- `plus`, `minus` and `times` are **exact**: the scale grows as the arithmetic requires and
  nothing is ever rounded behind the caller's back.
- `dividedBy` and `round` **demand** a scale and a rounding mode. There is no default, so
  "rounding happens only at explicit, defined points" is enforced by the type rather than
  promised by a comment.
- The canonical string form round-trips: `Decimal.parse(d.toString()).equals(d)` for every `d`.

`Money` is a `Decimal` plus a currency; `Quantity` is a `Decimal` that permits a fractional
scale and carries no unit — a unit of measure is the Products module's concept and would be
business meaning in a package that holds none.

The alternative was `decimal.js`, which passes the frontend dependency rule and is far less
code. It was declined because the shared package is the one thing every module and both
workspaces bind to, so a runtime dependency there is a dependency everywhere, and because its
defaults round implicitly at 20 significant digits — the exact behaviour that has to be
suppressed, leaving a wrapper of comparable size around a library doing more than is wanted.
`bigint` is native, and the operations needed are addition, multiplication and one division
with a stated rounding mode.

At the database boundary the backend converts through decimal **strings**:
`Prisma.Decimal.toFixed()` in, a canonical string out. A JSON number is an IEEE 754 double and
cannot hold every value a `numeric` column can, so money crosses the wire as a string — a rule
ticket 03's hrm contract already adopted and this generalises.

## Consequences

- Every list endpoint in every later module returns `ListResponse<T>` and accepts the same
  query parameters. A module declares *which* of its fields participate; it writes no paging,
  sorting or filtering code.
- The hand-written validation in identity and hrm is replaced by one pipe producing the same
  error shape, so nothing that consumes the API changes.
- `EmployeeListResponse` and `PayRunListResponse` are gone; both endpoints return the envelope.
- `HrmService.money()` is gone; `Money` replaces it, including the edge it documented — a
  restricted field is `undefined` at runtime against a non-optional generated type, so the
  serialiser has to survive an absent value.
- A module that wants a field sortable by a caller has to say so. A field nobody declares is
  not reachable from a query string, which is what keeps `?sort=passwordHash` from being a
  question the system has to have an answer to.

## Alternatives considered

**422 for a restricted sort field.** One status for every bad field name, and the `fields` map
already exists to carry it. Rejected: it reports a refusal as a malformed request, and a user
who *does* hold the grant tomorrow would have been told the field was invalid today.

**Pre-checking grants in the query layer instead of translating the error.** Rejected: it
duplicates the restriction table outside the one file that owns it, and two copies eventually
disagree.

**Both envelopes, chosen per endpoint.** Rejected on the ticket's own terms — "one list
response shape is used by all list endpoints". A shared table that has to handle two paging
models handles neither well.
