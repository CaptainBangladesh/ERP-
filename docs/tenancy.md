# Tenancy

Every business row belongs to one company, and one company can never see another's data.
That is enforced by the system rather than remembered by developers: **module code never
writes a company filter**, so forgetting one is not a mistake that can be made.

The mechanism is a Prisma client extension over async local storage. ADR 0003 records why
this and not Postgres row-level security, and what would bring RLS forward.

## What a module sees

```ts
@Injectable()
export class ProductsService {
  constructor(@InjectPrisma() private readonly prisma: ScopedPrisma) {}

  async list() {
    return this.prisma.product.findMany();          // this company's products
  }

  async create(input: NewProduct) {
    return this.prisma.product.create({
      data: companyApplied<Prisma.ProductUncheckedCreateInput>({ sku: input.sku }),
    });                                              // written into this company
  }

  async rename(id: string, name: string) {
    return this.prisma.product.update({ where: { id }, data: { name } });
  }                                                  // another company's id matches nothing
}
```

There is no company anywhere in that. There is also no way to put one in: the container has
no token that yields an unscoped client, so `PrismaService` cannot be injected.

`companyApplied` is a type-level statement, not a runtime one — the extension has already
recorded the company by the time the query runs. It exists because Prisma's generated input
type insists on `companyId`, and naming the input type keeps every *other* field checked in
a way a bare cast would not.

## What the platform does on every query

| | |
| --- | --- |
| Read, update, delete | The acting company is ANDed into `where`, so a lookup by direct identifier cannot cross companies. |
| Create | The acting company is forced into `data`. A write naming a different one is refused. |
| No company established | `MissingCompanyContextError`, naming the model and the operation. The query does not run. |
| Immutable table | `update`, `updateMany`, `upsert`, `delete` and `deleteMany` are refused outright. |
| Restricted field | Omitted from results unless the caller holds its grant; naming it explicitly is refused. |
| Restricted record | Filtered out entirely without the grant, so it is unreachable rather than unlisted. |

Company context is established once per request: `TenancyMiddleware` opens a scope around the
whole request, and `TenancyGuard` fills the company in the moment `SessionGuard` has resolved
who is asking. Nothing in a module touches either.

## Adding a company-owned table

1. Give the model a `companyId String @map("company_id") @db.Uuid` and an index on it. No
   foreign key to `companies` — keys stay inside a module.
2. Classify it in [`backend/src/platform/tenancy/company-owned.ts`](../backend/src/platform/tenancy/company-owned.ts):

   ```ts
   Product: { kind: 'company-owned' },
   ```

That is all. Every query against it is scoped from that point on.

The application **refuses to boot** if a model in `schema.prisma` is not in that table, so
step 2 is not something you can forget — you find out at startup, before the table has rows
in it, rather than at the first query that leaked.

## Adding a table that is not company-owned

Say so, and say why:

```ts
Session: {
  kind: 'unscoped',
  why:
    'A session is what establishes company context, so it cannot depend on one — ' +
    'authenticating a request happens before the request has a company.',
},
```

The reason is required because an unscoped table is the one place a leak can start, and it
should cost somebody a sentence in a file a reviewer reads end to end. There are two
non-company-owned classifications:

- `unscoped` — belongs to no company at all.
- `tenant-root` — the `Company` model itself, scoped by its own `id`, never created from
  inside a company.

## Restricting a field beyond company scope

Being in the company is not always enough. Salary is visible to a company's own staff only
if they are allowed to see salary.

```ts
Employee: {
  kind: 'company-owned',
  restricted: { annualSalary: 'hrm:pay:read' },
},
```

The grant is a permission string, declared in the owning module's manifest. The platform
holds it as an opaque string and does not import the module; a test checks that every
restricted grant is a permission some module declares, so a rename cannot leave a column
restricted by a grant nobody can hold.

For a caller **without** the grant:

- the field is **omitted** from results — an ordinary list endpoint still works, minus the
  number;
- naming it is **refused** — in `select`, in a `where` (including inside `AND` / `OR` / `NOT`,
  **and in a filter on a related table that reaches it**), in `orderBy`, in `distinct`, in
  `groupBy`'s `by`, in an aggregate, or through an `include`.

Omitting is what makes the list useful to staff who may know who their colleagues are and
not what they earn. Refusing an explicit mention is what stops that being a way to read the
number sideways — a `where` that probes it one value at a time reads it just as surely as a
`select`, and one bit per request is a binary search.

The one nested read that *is* allowed is a `select` naming the columns it wants and not
naming a restricted one:

```ts
// refused — the whole employee comes back, salary included
await prisma.payRunLine.findMany({ include: { employee: true } });

// fine — nothing restricted is reached
await prisma.payRunLine.findMany({ include: { employee: { select: { name: true } } } });
```

Where the value is the *point* of the request — calculating a pay run reads salaries — the
module refuses up front with a 403 rather than computing over omitted values. Use
`Tenancy.holds(grant)` for that; ticket 07 turns it into a permission on the handler.

**Restriction governs reading.** Who may *write* a restricted field is authorization, and
that is ticket 07's.

## Restricting a whole record

The other half. A restricted field hides one column of every row; a restricted *record* hides
every column of one row — the director whose file is not the payroll clerk's business, rather
than the salary column that is nobody's below a certain level.

```ts
Employee: {
  kind: 'company-owned',
  restrictedRows: { flag: 'confidential', grant: 'hrm:employees:read-confidential' },
},
```

The flag is a boolean column on the table. Without the grant it is ANDed into `where` exactly
as the company is, so a restricted row is **unreachable by its own identifier** and cannot be
updated or deleted — not merely absent from a list. A screen that chose not to render it would
still be one query away from rendering it.

Naming the flag without the grant is refused, in a filter and in a write: filtering on it
would have to answer a question the caller may not ask, and writing it would put a row into
the database the writer could not read back.

## Making a table immutable

```ts
PayRun: { kind: 'company-owned', immutable: true },
```

Update, upsert and delete are refused by the platform. Not having a route that would do it
is not immutability — the next person to add a route is. This is.

Immutability is checked *before* company context, so it holds even inside
`withoutCompanyScope` below. It is a fact about the table rather than about who is asking, and
the escape from scoping is not an escape from that.

## The sharp edges

Three, all of them written down here rather than discovered.

**Raw SQL bypasses everything.** `$queryRaw` and its siblings do not go through a model
delegate, so the extension never sees them. `npm run check:tenancy` fails the build on any
use outside `backend/test/harness/`, and runs in CI. If you have a legitimate need for one
against a company-owned table, that is the trigger recorded in ADR 0003 for bringing
row-level security forward — reopen the ADR rather than widening the exception list.

**Nested reads are scoped by foreign key, not by the extension.** An `include` is executed
as part of its parent's query and is not intercepted. It is safe for tenancy — the parent row
was scoped and a key cannot point outside its company — but a restricted field cannot be
omitted from it, so an `include` that reaches one is refused outright. Read the related rows
as their own query.

**A withheld field's type lies.** Prisma's generated row type has the column, because as far
as the schema is concerned it is always there; when the caller lacks the grant it is
genuinely absent from the object. A module putting one on the wire must handle the absence
even though the type says it cannot happen:

```ts
function money(value: Prisma.Decimal | null | undefined): string | null {
  return value === null || value === undefined ? null : value.toFixed(2);
}
```

## Outside a request

A script, a test, or eventually a scheduled job has no session to take a company from:

```ts
await tenancy.runInCompany({ companyId, grants: 'all' }, async () => {
  await prisma.product.findMany();
});
```

The `await` inside `runInCompany` is load-bearing, and the same trap is worth knowing about
in your own code: a Prisma call returns a **lazy** promise that does not touch the database
until something awaits it. A promise created inside a scope and awaited outside it runs
after the scope has closed, and throws for want of a company it was given.

## The one escape

`withoutCompanyScope(reason, work)` suspends scoping. It requires a written reason, in the
same spirit as `@Public()`, and it is greppable.

Identity is the only legitimate user, and not by exemption: it *establishes* the tenant, so
it runs before there is one. Sign-up creates the company; sign-in has to find a user by
email across every company, because until it has found them there is nothing to scope to.

If you are reaching for it anywhere else, you are almost certainly working around a bug.

## Grants today

Until ticket 07 introduces roles, `TenancyGuard` derives grants the only way the system
honestly can: a company's owner created it and holds everything, nobody else holds anything.
Blunt, but not a lie — and it is one line to replace, in one file, with nothing outside the
tenancy platform changing.
