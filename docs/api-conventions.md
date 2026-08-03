# API conventions

One list shape, one error shape, one way to sort, filter, search and page. Every module
follows them, and a module writes almost none of the code that makes it so.

ADR 0004 records why each is the way it is, including the two decisions that were open:
offset paging rather than cursors, and a 403 rather than a 422 for a field the caller may not
read.

## The list envelope

```
GET /api/hrm/employees?page=2&pageSize=25&sort=-name&search=oka&filter.confidential=false
```

```json
{
  "items": [ … ],
  "page": { "number": 2, "size": 25, "total": 287, "pages": 12 }
}
```

`number` is 1-based and is whatever was asked for, even past the end — a request for page nine
of a three-page list gets no items and is told there are three pages, rather than being
quietly renumbered. `pages` is `0` when nothing matched: there is no page 1 of nothing.

## The parameters

| | |
| --- | --- |
| `page` | 1-based. Defaults to 1. |
| `pageSize` | 1–100. Defaults to 25. The ceiling is not a suggestion — without it, `?pageSize=1000000` is a way for any caller to ask any endpoint for everything. |
| `sort` | A field name, `-` prefixed for descending: `sort=-name`. Defaults to the endpoint's own. |
| `search` | Free text, matched across whichever fields the endpoint declares searchable. |
| `filter.<field>` | Equality. `?filter.confidential=false` |
| `filter.<field>.<op>` | `eq` `ne` `lt` `lte` `gt` `gte` `in` `contains` `startsWith`, as the field's type allows. |

Filters are ANDed with each other and with the search, which is what somebody operating a list
screen expects: narrowing by status and then typing in the search box searches *within* the
status.

A dotted flat key rather than `filter[field][op]` brackets, because bracket parsing depends on
which query-string parser the server happens to be configured with, and a convention forty
modules depend on should not.

## Declaring a list endpoint

A module declares which of its fields participate. That is the whole of what it writes.

```ts
export const EMPLOYEE_LIST: ListSpec = {
  defaultSort: 'name',
  fields: {
    name:         { type: 'text', sortable: true, filterable: true, searchable: true },
    annualSalary: { type: 'decimal', sortable: true, filterable: true },
    confidential: { type: 'boolean', filterable: true },
    createdAt:    { type: 'date', sortable: true, filterable: true },
  },
};
```

```ts
async listEmployees(query: Record<string, unknown>): Promise<EmployeeListResponse> {
  const slice = listQuery(query, EMPLOYEE_LIST);

  const [employees, total] = await Promise.all([
    this.prisma.employee.findMany(slice.findMany<Prisma.EmployeeFindManyArgs>()),
    this.prisma.employee.count(slice.count<Prisma.EmployeeCountArgs>()),
  ]);

  return slice.respond(employees.map(describeEmployee), total);
}
```

A field does not have to be a column. `via` puts it on a related table:

```ts
export const PARTY_LIST: ListSpec = {
  defaultSort: 'name',
  fields: {
    name: { type: 'text', sortable: true, filterable: true, searchable: true },
    role: { type: 'text', filterable: true, via: { relation: 'roles', field: 'role' } },
  },
};
```

`?filter.role=customer` becomes `roles: { some: { role: { equals: 'customer' } } }`, and the
module writes no join. Which table a value is stored in is not something the person operating
a list screen should have to know — a party is filtered by role, and whether a role is a
column or a row is the module's business.

Filtering only. A party holds three roles and a list has one order, so sorting is refused
rather than guessed at, and the refusal says what the list *can* be sorted by. Searching is
refused for the same reason in reverse: a search box that also matched anything related would
widen its meaning to something nobody could predict.

Three things are worth noticing about that.

- **`defaultSort` is required.** A list with no default order is a list whose contents shuffle
  between pages, because the database is free to return rows in whatever order it finds them
  and usually does something different once the table grows. The platform also appends the
  identifier as a tiebreak, so sorting by a column full of duplicates cannot show one row on
  two pages and another on none.
- **The declaration is an allow-list.** A field nobody names is not reachable from a query
  string, so `?sort=passwordHash` is not a question the system has to have an answer to.
- **The count is its own query.** The rows are one page of them.

The field names come from the module's wire contract in `packages`, so the backend's
declaration and the frontend's table columns cannot drift.

## The error shape

```json
{ "code": "validation_failed", "message": "…", "fields": { "annualSalary": "…" } }
```

`code` is machine-readable and stable; clients branch on it and never on `message`. `fields`
is present only where the failure belongs to particular inputs — and a bad list parameter
counts, so a `?sort=nonsense` comes back keyed by `sort`, and a bad filter by its full
parameter name. Everything wrong with one request is collected before any of it is refused.

Request bodies are declared the same way, in the same file as the list spec:

```ts
export const CreateEmployeeBody = validator({
  name: text({ missing: "Enter the employee's name." }),
  annualSalary: money(ANNUAL_SALARY),
  confidential: withDefault(flag(CONFIDENTIAL), false),
}).and((values, report) => { … });   // cross-field rules
```

```ts
@Post('employees')
async addEmployee(
  @Body(validated(CreateEmployeeBody)) body: Valid<typeof CreateEmployeeBody>,
) { … }
```

The messages live at the point of use rather than inside the rules, because "Enter your
company name." and "Enter the employee's name." are the same rule and different sentences.
Unknown keys are ignored: refusing them would make every additive API change a breaking one
for a client that sends a record back exactly as it received it.

## A field the caller may not read

Some columns are restricted beyond company scope — see [tenancy](tenancy.md). Naming one in a
sort or a filter is a **403** with the code `field_restricted`, naming the field:

```
GET /api/hrm/employees?sort=-annualSalary

403  { "code": "field_restricted", "message": "You do not have access to 'annualSalary'." }
```

Not a 422, which would report a refusal as a typo — the field is real and the endpoint does
sort by it, for somebody holding the grant. And emphatically not a silently dropped clause: a
list that quietly ignores the sort it was asked for looks broken rather than refused.

**Nothing in the list convention knows which fields are restricted.**
`platform/tenancy/company-owned.ts` knows, the extension refuses the query, and
`ApiExceptionFilter` translates the refusal. A pre-check here would be a second copy of the
restriction table, and two copies eventually disagree.

## Exact numbers

Money and quantities are never a JavaScript `number`, at any layer — not in the database, not
in the service, not on the wire, not in the input box.

```ts
Money.parse('48000.10')
  .times(Decimal.fromInteger(31))
  .dividedBy(Decimal.fromInteger(365), { scale: 2, rounding: 'half-even' });
```

`plus`, `minus` and `times` are exact and grow the scale as needed. `dividedBy` and `round`
*demand* a scale and a rounding mode — there is no overload without one, which is how
"rounding happens only at explicit, defined points" is enforced by the signature rather than
promised by a comment. Half-even is the mode to reach for: it is the only one that does not
accumulate a bias across a long sequence, which is exactly what a ledger is.

On the wire, money is an amount **and** its currency, and the amount is a string:

```json
{ "amount": "48000.10", "currency": "GBP" }
```

A JSON number is an IEEE 754 double and cannot hold every value a `numeric` column can.
Arithmetic between two currencies throws rather than answering. A quantity is a bare decimal
string and carries no unit of measure — a unit is the Products module's concept, and putting
one in the shared package would be domain meaning in a package that holds none.

At the database boundary, convert through text: `Prisma.Decimal.toFixed()` in, and a canonical
string out. Never `Number(…)`, and never `toString()` on a `Prisma.Decimal` — decimal.js
prints large values in exponential notation and `Decimal.parse` will not accept an exponent.

A restricted field is genuinely absent at runtime while its generated type says it is present,
so every money serialiser goes through `Money.wire`, which handles that in one place.

## On the screen

```tsx
<DataTable
  caption="Employees"        // a visually hidden <caption>, so the table has a name
  columns={columns}          // each column's `id` is the field the server sorts by
  rows={employees.data?.items ?? []}
  rowId={(employee) => employee.id}
  page={employees.data?.page ?? emptyPage()}
  query={query}
  onQueryChange={setQuery}   // the whole of the screen's paging, sorting and filtering code
  status={…}
  searchLabel="Search by name"
  filters={<AddedSince … />}  // the screen supplies its own controls; the convention is shared
  empty={…}
/>
```

`@erp/shared/ui` — a **separate entry point**, so the Nest backend can import `@erp/shared`
without acquiring React.

> **Tailwind cannot see it by default.** It skips `node_modules`, and this package resolves
> through `node_modules` — so a class used *only* by a shared component is silently absent
> from the stylesheet, and the component renders unstyled in exactly that one respect.
> `application/src/index.css` carries `@source "../../packages/src/ui"` to fix it. Adding a
> shared component needs nothing further; **deleting that line breaks every one of them**, and
> no test catches it, because jsdom renders no CSS. The table is TanStack Table's headless logic with hand-written
Tailwind markup; `manualSorting`, `manualFiltering` and `manualPagination` are all on, because
a table that sorted its own page would sort the twenty-five rows it happens to be holding and
call it a sort of a thousand.

Filter *controls* are a slot rather than something the table generates: what a filter should
look like is a question about the field — a date picker for one, a status dropdown for
another, a location tree for a third — and a table answering it for forty modules would answer
it badly for most. What is shared is the convention the value travels under.

Three states, and empty split in two — four renderings:

- **loading** — announced, in a live region rather than as a table row.
- **error** — the failure's own message, and a way to try again.
- **empty** — nothing here yet. Names the first action, because nothing in this system is
  seeded and an empty database is the first thing every user sees.
- **no matches** — filters or a search excluded everything, with a way to clear them. Showing
  "add your first employee" to somebody who has two hundred and a typo in the search box is
  the failure this split exists to prevent.

`MoneyInput` and `QuantityInput` hold canonical decimal text, filter keystrokes to what could
still become a valid amount, and save the complaint for blur. `MoneyText` renders `null` — a
withheld column — as a dash with an accessible name, because an empty cell reads as "this
person earns nothing".
