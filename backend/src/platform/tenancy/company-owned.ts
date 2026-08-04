import { Prisma } from '@prisma/client';

/**
 * Which tables belong to a company, which do not, and why.
 *
 * This is the whole of the tenancy declaration. Nothing else in the system decides whether a
 * table is scoped: the extension reads this table and nowhere else, so "is this scoped?" has
 * exactly one answer and it is in one file a reviewer can read end to end.
 *
 * A model that is *not* company-owned has to say so, with a reason. That is criterion six of
 * ticket 03 and it is not decoration — an unscoped table is the one place a leak can start,
 * so it should cost somebody a sentence of justification in a file a reviewer reads. The
 * application refuses to boot if the datamodel contains a model this table does not mention
 * (`assertEveryModelIsClassified`), which is what stops "unscoped" from being something a
 * new module arrives at by forgetting.
 *
 * Ticket 06 splits `schema.prisma` per module. This table stays central regardless: it is
 * read as a whole by the reviewer asking "what is not scoped, and why", and a per-module
 * version would answer that question forty times.
 */

/** A table whose every row belongs to one company. The ordinary case. */
interface CompanyOwned {
  readonly kind: 'company-owned';

  /**
   * Rows are never updated or deleted once written; a correction is a new row. Refused by
   * the extension rather than left to each module, because "append-only" enforced by
   * convention is append-only until somebody is in a hurry.
   */
  readonly immutable?: boolean;

  /**
   * Fields restricted beyond company scope, each naming the grant that reads it. Being in
   * the company is not enough: salary is visible to a company's own staff only if they are
   * allowed to see salary.
   *
   * Without the grant the field is omitted from results, and naming it explicitly throws.
   */
  readonly restricted?: Readonly<Record<string, string>>;

  /**
   * A boolean column marking individual *rows* as restricted, and the grant that sees them.
   *
   * The other half of "a field or record can be marked as restricted". A restricted field
   * hides one column of every row; this hides every column of one row — the director whose
   * package is not the payroll clerk's business, rather than the salary column that is
   * nobody's below a certain level.
   *
   * Enforced like the company filter and for the same reason: ANDed into `where`, so a
   * restricted row is unreachable by its own identifier as well as absent from a list. A
   * screen that merely did not display it would still be one query away from displaying it.
   */
  readonly restrictedRows?: { readonly flag: string; readonly grant: string };
}

/**
 * The company itself. Scoped by its own `id` rather than a `companyId` column, and never
 * created from inside a company.
 */
interface TenantRoot {
  readonly kind: 'tenant-root';
}

/** A table that belongs to no company, and the reason it does not. */
interface Unscoped {
  readonly kind: 'unscoped';
  readonly why: string;
}

export type ModelTenancy = CompanyOwned | TenantRoot | Unscoped;

/** The column every company-owned table carries. */
export const COMPANY_COLUMN = 'companyId';

const CLASSIFICATION: Readonly<Record<string, ModelTenancy>> = {
  // ─── identity ───────────────────────────────────────────────────────────────────────
  Company: { kind: 'tenant-root' },

  User: { kind: 'company-owned' },

  Session: {
    kind: 'unscoped',
    why:
      'A session is what establishes company context, so it cannot depend on one — ' +
      'authenticating a request happens before the request has a company. It is reached ' +
      'only by an unguessable token naming one row, and identity is the only module that ' +
      'touches it.',
  },

  Role: { kind: 'company-owned' },

  RolePermission: { kind: 'company-owned' },

  UserRole: { kind: 'company-owned' },

  // Company-owned, not unscoped: unlike Session, an invitation or a reset genuinely belongs
  // to one company (it names the company inviting, or the user resetting) and an ordinary
  // list of pending invitations is scoped exactly like any other list. The one operation that
  // runs before a session exists — resolving the raw token a caller arrived with — uses
  // `withoutCompanyScope('…')` explicitly, the same way sign-in looks a `User` up by email
  // across every company. See `backend/src/modules/identity/recovery.service.ts`.
  Invitation: { kind: 'company-owned' },

  PasswordReset: { kind: 'company-owned' },

  // ─── parties ────────────────────────────────────────────────────────────────────────
  // Ordinary company-owned tables, all three of them, and worth noting for that reason: the
  // address book is the first module with real business data in it and it needed nothing
  // from tenancy that was not already there. Nothing is restricted — a colleague who may see
  // the customer list may see all of it — and nothing is immutable, because a party's
  // details change and correcting a misspelled name is not an event worth preserving.
  Party: { kind: 'company-owned' },

  PartyRole: { kind: 'company-owned' },

  PartyAddress: { kind: 'company-owned' },

  // ─── hrm ────────────────────────────────────────────────────────────────────────────
  Employee: {
    kind: 'company-owned',
    // The shape stub's sensitive personal field. It is the reason tenant scoping had to
    // support "company-scoped and further restricted" before forty modules depended on it.
    restricted: { annualSalary: 'hrm:pay:read' },
    // And its restricted *record*: an employee whose whole file is confidential, not merely
    // whose salary is. Payroll produces both cases; inventory produces neither.
    restrictedRows: { flag: 'confidential', grant: 'hrm:employees:read-confidential' },
  },

  PayRun: { kind: 'company-owned', immutable: true },

  PayRunLine: {
    kind: 'company-owned',
    immutable: true,
    restricted: { grossPay: 'hrm:pay:read' },
  },

  // ─── products ───────────────────────────────────────────────────────────────────────
  // Four ordinary company-owned tables. Nothing is restricted — a colleague who may see the
  // catalogue may see the cost, because a cost is what the business pays rather than what a
  // person is paid — and nothing is immutable, because correcting a mistyped SKU is not an
  // event worth preserving. The interesting property is elsewhere: a product code is unique
  // *within* a company, which is a constraint the schema states and this file is what makes
  // safe to state.
  UnitGroup: { kind: 'company-owned' },

  UnitOfMeasure: { kind: 'company-owned' },

  Product: { kind: 'company-owned' },

  ProductSupplier: { kind: 'company-owned' },

  // ─── warranties ──
  Warranty: { kind: 'company-owned' },

  // ─── inventory ──
  Location: { kind: 'company-owned' },

  // The second immutable table in this schema, and the first that is immutable for a reason
  // other than payroll's. A pay run cannot be edited because a payroll record that can be
  // edited after the fact is not a payroll record; a stock movement cannot be edited because
  // the accounting entries eventually derived from it would have nothing to reconcile against.
  // Both arrive at the same declaration from different directions, which is the shape stub
  // earning its keep — the mechanism was built for hrm and inventory needed it unchanged.
  //
  // Note what is *not* here: no restricted field and no restricted rows. A colleague who may
  // read the ledger may read all of it, because what a movement records is what the business
  // did rather than what a person is paid.
  StockMovement: { kind: 'company-owned', immutable: true },

  // Emphatically *not* immutable: it is the running total of the table above, and a running
  // total is meant to change. The ledger is the record; this is the cache of it.
  StockLevel: { kind: 'company-owned' },

  InventorySetting: { kind: 'company-owned' },
};

/**
 * How a model is scoped.
 *
 * Throws rather than defaulting. Defaulting to scoped would break the boot the moment a
 * genuinely unscoped table appeared; defaulting to unscoped would leak. The only safe
 * default is "somebody has to say", and `assertEveryModelIsClassified` makes them say it at
 * startup rather than at the first query.
 */
export function tenancyOf(model: string): ModelTenancy {
  const classification = CLASSIFICATION[model];
  if (!classification) throw new Error(unclassifiedMessage([model]));
  return classification;
}

/**
 * Every model in the datamodel is classified, and nothing is classified that does not exist.
 *
 * Run at boot. A new module's table arriving unclassified is the exact moment the mistake is
 * cheap to fix — before it has rows in it, and before the query that would have leaked them
 * has been written.
 */
export function assertEveryModelIsClassified(): void {
  const declared = new Set(Object.keys(CLASSIFICATION));
  const actual = new Set(Prisma.dmmf.datamodel.models.map((model) => model.name));

  const missing = [...actual].filter((model) => !declared.has(model)).sort();
  if (missing.length > 0) throw new Error(unclassifiedMessage(missing));

  const stale = [...declared].filter((model) => !actual.has(model)).sort();
  if (stale.length > 0) {
    throw new Error(
      `platform/tenancy/company-owned.ts classifies ${stale.map(quote).join(', ')}, which ` +
        `no longer exist in schema.prisma. Delete the entries — a classification for a ` +
        `table that is gone is one more thing that has to be read and discounted.`,
    );
  }
}

function unclassifiedMessage(models: readonly string[]): string {
  return (
    `${models.map(quote).join(', ')} ${models.length === 1 ? 'is' : 'are'} not classified ` +
    `in platform/tenancy/company-owned.ts. Every table is either company-owned or ` +
    `explicitly not, because an unclassified table is the one a query leaks through. Add ` +
    `an entry: '{ kind: "company-owned" }' for a table carrying a ${quote(COMPANY_COLUMN)}, ` +
    `or '{ kind: "unscoped", why: "…" }' with the reason it belongs to no company. See ` +
    `docs/tenancy.md.`
  );
}

/**
 * Every grant this table restricts a field by.
 *
 * The platform holds these as opaque strings; the modules declare them as permissions. The
 * module contract test checks the two lists against each other, so a renamed permission
 * cannot quietly leave a column restricted by a grant that nobody can ever hold — which
 * would make the field unreadable to everybody, including the people whose job it is.
 */
export function restrictedGrants(): string[] {
  const grants = Object.values(CLASSIFICATION).flatMap((classification) => {
    if (classification.kind !== 'company-owned') return [];

    return [
      ...Object.values(classification.restricted ?? {}),
      ...(classification.restrictedRows ? [classification.restrictedRows.grant] : []),
    ];
  });

  return [...new Set(grants)].sort();
}

/** Every model this file has an opinion about, in the order it states them. */
export function classifiedModels(): string[] {
  return Object.keys(CLASSIFICATION);
}

/**
 * The grants restricting each model, by model.
 *
 * `restrictedGrants()` answers the same question flattened, for the check that every grant is
 * a permission *somebody* declares. This one keeps the model, because the conformance pack
 * asks the sharper question: whether the grant is declared by the module that owns the table.
 * A grant declared by a different module would pass the flat check and still leave the column
 * restricted by something outside its owner's control.
 */
export function grantsByModel(): Record<string, string[]> {
  return Object.fromEntries(
    Object.entries(CLASSIFICATION).flatMap(([model, classification]) => {
      if (classification.kind !== 'company-owned') return [];

      const grants = [
        ...Object.values(classification.restricted ?? {}),
        ...(classification.restrictedRows ? [classification.restrictedRows.grant] : []),
      ];

      return grants.length === 0 ? [] : [[model, [...new Set(grants)].sort()] as const];
    }),
  );
}

/**
 * What each relation field on a model points at, so a nested read can be checked against the
 * classification of the model it actually reaches rather than the one it was asked of.
 *
 * Derived from the datamodel rather than written down, because a hand-kept copy of the
 * relation graph is a second schema that drifts from the first.
 */
export function relationTargets(model: string): Readonly<Record<string, string>> {
  const cached = RELATIONS.get(model);
  if (cached) return cached;

  const definition = Prisma.dmmf.datamodel.models.find((candidate) => candidate.name === model);
  const targets = Object.fromEntries(
    (definition?.fields ?? [])
      .filter((field) => field.kind === 'object')
      .map((field) => [field.name, field.type]),
  );

  RELATIONS.set(model, targets);
  return targets;
}

const RELATIONS = new Map<string, Readonly<Record<string, string>>>();

function quote(value: string): string {
  return `'${value}'`;
}
