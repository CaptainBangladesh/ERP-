import type { PrismaClient } from '@prisma/client';
import {
  COMPANY_COLUMN,
  relationTargets,
  tenancyOf,
  type ModelTenancy,
} from './company-owned';
import { holdsGrant, Tenancy, type TenantContext } from './tenancy';
import {
  CrossCompanyError,
  ImmutableRecordError,
  MissingCompanyContextError,
  RestrictedFieldError,
  RestrictedRecordError,
  TenantRootWriteError,
} from './tenancy-error';

/**
 * The one place a company filter is written.
 *
 * Module code never writes `where: { companyId }` — not once, not in forty modules — so
 * forgetting it is not a mistake that can be made. This extension rewrites every query
 * before it reaches the database:
 *
 * - reads, updates and deletes get the acting company ANDed into `where`, so a lookup by
 *   direct identifier cannot cross companies;
 * - writes get the acting company forced into `data`, and a write naming a different one is
 *   refused;
 * - a query against a company-owned table with no company established throws, rather than
 *   running unscoped;
 * - a table declared immutable refuses update, upsert and delete outright;
 * - a field declared restricted is omitted from results unless the caller holds its grant,
 *   and naming one explicitly without the grant is refused;
 * - rows a table flags as restricted are filtered out entirely for a caller without the
 *   grant, so they are unreachable rather than merely unlisted.
 *
 * Its one bypass is `$queryRaw` and its siblings, which client extensions do not see.
 * `npm run check:tenancy` fails the build on those outside the test harness, which is what
 * turns the hole into something the build refuses rather than something reviewers police.
 * ADR 0003 records why this and not row-level security, and what would bring RLS forward.
 *
 * Nested reads are the mechanism's other edge. An `include` is executed as part of its
 * parent's query and is not intercepted, so it is scoped by foreign key rather than by this
 * extension — safe, because the parent row was scoped and the key cannot point outside its
 * company, but not scoped *here*. Restricted fields are the case where that would actually
 * lose something, so an `include` reaching a restricted field the caller may not read is
 * refused explicitly below.
 */
export function createScopedPrisma(client: PrismaClient, tenancy: Tenancy) {
  return client.$extends({
    name: 'tenant-scope',
    query: {
      $allModels: {
        $allOperations({ model, operation, args, query }) {
          const scoped = scopeArguments(tenancy, model, operation, args as Args);
          // The rewrite is model-agnostic by construction — it adds a scalar filter and a
          // scalar field, and refuses everything it does not understand — so it cannot be
          // expressed in the per-model, per-operation argument type Prisma infers here.
          return query(scoped as unknown as typeof args);
        },
      },
    },
  });
}

/**
 * The Prisma client every module injects. Its model delegates are the ordinary ones — that
 * is the point, since a scoped client that read differently would be a second API to learn.
 */
export type ScopedPrisma = ReturnType<typeof createScopedPrisma>;

type Args = Record<string, unknown> | undefined;

const REFUSED_WHEN_IMMUTABLE = new Set([
  'update',
  'updateMany',
  'updateManyAndReturn',
  'upsert',
  'delete',
  'deleteMany',
]);

const TAKES_WHERE = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
  'update',
  'updateMany',
  'updateManyAndReturn',
  'delete',
  'deleteMany',
  'upsert',
]);

/** Operations that put rows into the database, and so must record the acting company. */
const CREATES = new Set(['create', 'createMany', 'createManyAndReturn']);

/** Operations that change rows, where a company in `data` is checked but not injected. */
const UPDATES = new Set(['update', 'updateMany', 'updateManyAndReturn']);

/** Operations whose result is rows, and so can carry restricted fields out. */
const RETURNS_ROWS = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'create',
  'createManyAndReturn',
  'update',
  'updateManyAndReturn',
  'upsert',
  'delete',
]);

/** Operations that compute over columns, where naming a restricted one leaks its values. */
const AGGREGATES = new Set(['aggregate', 'groupBy']);

/**
 * What scoping this query means: the model, the column carrying its company, and the company
 * doing the asking. Passed as one thing because the three never travel apart, and because a
 * rewrite that took them as three arguments would eventually take them in the wrong order.
 */
interface Scope {
  readonly model: string;
  /** `companyId` on an ordinary table; `id` on the tenant root, which *is* the company. */
  readonly column: string;
  readonly companyId: string;
}

/**
 * Rewrites one query. Pure, and separated from the extension so it can be reasoned about —
 * and tested — without a database.
 */
function scopeArguments(
  tenancy: Tenancy,
  model: string,
  operation: string,
  args: Args,
): Record<string, unknown> {
  const classification = tenancyOf(model);

  // Immutability is a fact about the table, not about who is asking, so it is checked before
  // company context and holds even where scoping is suspended.
  if (isImmutable(classification) && REFUSED_WHEN_IMMUTABLE.has(operation)) {
    throw new ImmutableRecordError(model, operation);
  }

  if (classification.kind === 'unscoped') return args ?? {};
  if (tenancy.isSuspended()) return args ?? {};

  const context = tenancy.current();
  if (!context) throw new MissingCompanyContextError(model, operation);

  if (classification.kind === 'tenant-root' && CREATES.has(operation)) {
    // Unreachable from the only path that creates a company today — sign-up runs outside
    // company scope — and kept as the guardrail for the next path, which will not have that
    // comment in front of it.
    throw new TenantRootWriteError(model);
  }

  const scope: Scope = {
    model,
    column: classification.kind === 'tenant-root' ? 'id' : COMPANY_COLUMN,
    companyId: context.companyId,
  };

  let scoped: Record<string, unknown> = { ...(args ?? {}) };

  if (TAKES_WHERE.has(operation)) scoped.where = withCompany(scoped.where, scope, 'filter');

  if (CREATES.has(operation)) scoped.data = stamped(scoped.data, scope);

  if (UPDATES.has(operation)) scoped.data = refuseOtherCompany(scoped.data, scope);

  if (operation === 'upsert') {
    scoped.create = stamped(scoped.create, scope);
    scoped.update = refuseOtherCompany(scoped.update, scope);
  }

  scoped = applyRestrictions(scoped, operation, classification, scope, context);

  return scoped;
}

function isImmutable(classification: ModelTenancy): boolean {
  return classification.kind === 'company-owned' && classification.immutable === true;
}

/** Forces the acting company onto rows being written — one row or many. */
function stamped(data: unknown, scope: Scope): unknown {
  if (Array.isArray(data)) return data.map((row) => withCompany(row, scope, 'write'));
  return withCompany(data, scope, 'write');
}

/**
 * The acting company, added to a filter or to a row on its way in.
 *
 * One function for both because it is one rule — this company, and refuse anything naming
 * another — and two copies of it would be two places for that rule to drift.
 */
function withCompany(
  target: unknown,
  scope: Scope,
  kind: 'filter' | 'write',
): Record<string, unknown> {
  const existing = isRecord(target) ? target : {};
  const declared = existing[scope.column];

  if (typeof declared === 'string' && declared !== scope.companyId) {
    throw new CrossCompanyError(scope.model, kind, declared, scope.companyId);
  }

  return { ...existing, [scope.column]: scope.companyId };
}

/**
 * An update may not move a row into another company. It is not given the acting company
 * either: writing the value a row already has would be noise, and the filter has already
 * established that the row is ours.
 */
function refuseOtherCompany(data: unknown, scope: Scope): unknown {
  if (!isRecord(data)) return data;

  const declared = data[scope.column];
  if (typeof declared === 'string' && declared !== scope.companyId) {
    throw new CrossCompanyError(scope.model, 'write', declared, scope.companyId);
  }
  return data;
}

/**
 * Restriction beyond company scope: fields the caller may not read, and whole rows the caller
 * may not see.
 *
 * Withholding rather than refusing is what makes an ordinary list endpoint work for staff who
 * may not see salary — they get the employees, without the number. Refusing an explicit
 * mention is what stops that being a way to read the number by asking sideways: through
 * `select`, through a filter that probes it a value at a time, through a filter on a
 * *related* table that probes it just as effectively, through an aggregate that sums it,
 * through the columns a `groupBy` groups on, or through an `include` that reaches it.
 */
function applyRestrictions(
  args: Record<string, unknown>,
  operation: string,
  classification: ModelTenancy,
  scope: Scope,
  context: TenantContext,
): Record<string, unknown> {
  refuseRestrictedReach(args.include, scope.model, context);
  refuseRestrictedReach(args.select, scope.model, context);
  refuseRestrictedFilter(args.where, scope.model, context);
  refuseRestrictedFilter(args.orderBy, scope.model, context);

  hideRestrictedRows(args, operation, classification, scope, context);

  const withheld = withheldFields(scope.model, classification, context);
  if (withheld.length === 0) return args;

  for (const [field, grant] of withheld) {
    const refuse = (): never => {
      throw new RestrictedFieldError(scope.model, field, grant);
    };

    if (isRecord(args.select) && args.select[field]) refuse();
    // `distinct`, and `groupBy`'s `by`, are lists of bare column names rather than filters —
    // the one shape the filter walk above cannot see, because there is nothing to walk.
    if (names(args.distinct, field)) refuse();
    if (names(args.by, field)) refuse();
    if (AGGREGATES.has(operation) && aggregatesOver(args, field)) refuse();
  }

  // `omit` and `select` are mutually exclusive in Prisma, and a `select` that survived the
  // checks above already excludes every withheld field, so there is nothing left to omit.
  if (RETURNS_ROWS.has(operation) && !isRecord(args.select)) {
    args.omit = {
      ...(isRecord(args.omit) ? args.omit : {}),
      ...Object.fromEntries(withheld.map(([field]) => [field, true])),
    };
  }

  return args;
}

/**
 * Rows a table flags as restricted, kept out of the caller's way entirely.
 *
 * The company filter's smaller sibling, and applied the same way: ANDed into `where`, so a
 * restricted row is not merely absent from a list but unreachable by its own identifier,
 * un-updatable and un-deletable, without anything in a module asking. That is the difference
 * between a record being restricted and a screen choosing not to show it.
 *
 * A caller who names the flag is refused rather than quietly overruled. Silently answering a
 * different question from the one asked is the failure this whole mechanism exists to
 * prevent, and it would be a strange place to make an exception.
 */
function hideRestrictedRows(
  args: Record<string, unknown>,
  operation: string,
  classification: ModelTenancy,
  scope: Scope,
  context: TenantContext,
): void {
  if (classification.kind !== 'company-owned' || !classification.restrictedRows) return;

  const { flag, grant } = classification.restrictedRows;
  if (holdsGrant(context, grant)) return;

  for (const key of ['data', 'create', 'update']) {
    const written = args[key];
    // Writing the flag without the grant would put a row into the database that the writer
    // cannot then read back, which is a worse outcome than being told no.
    if (isRecord(written) && written[flag] !== undefined) {
      throw new RestrictedRecordError(scope.model, flag, grant);
    }
  }

  if (!TAKES_WHERE.has(operation)) return;

  const where = isRecord(args.where) ? args.where : {};
  if (where[flag] !== undefined) throw new RestrictedRecordError(scope.model, flag, grant);

  args.where = { ...where, [flag]: false };
}

/** The restricted fields on this model that this caller does not hold the grant for. */
function withheldFields(
  model: string,
  classification: ModelTenancy,
  context: TenantContext,
): Array<[string, string]> {
  if (classification.kind !== 'company-owned' || !classification.restricted) return [];

  return Object.entries(classification.restricted).filter(
    ([, grant]) => !holdsGrant(context, grant),
  );
}

/**
 * A filter is a walk across models, not a flat list of columns.
 *
 * `where: { payRunLines: { some: { grossPay: { gt: 5000 } } } }` reads a restricted column on
 * another table just as surely as selecting it — one bit per request, but one bit per request
 * is a binary search. So the walk follows relation keys onto the model they point at, and
 * treats everything else — `AND`, `OR`, `NOT`, and the operator objects inside a condition —
 * as staying on the model it is already on.
 */
function refuseRestrictedFilter(
  filter: unknown,
  model: string,
  context: TenantContext,
): void {
  if (Array.isArray(filter)) {
    for (const entry of filter) refuseRestrictedFilter(entry, model, context);
    return;
  }
  if (!isRecord(filter)) return;

  const withheld = withheldFields(model, tenancyOf(model), context);
  const relations = relationTargets(model);

  for (const [key, value] of Object.entries(filter)) {
    const restricted = withheld.find(([field]) => field === key);
    if (restricted) throw new RestrictedFieldError(model, restricted[0], restricted[1]);

    refuseRestrictedFilter(value, relations[key] ?? model, context);
  }
}

/**
 * An `include` or a nested `select` reaches another model, and that model's restrictions
 * travel with it. The extension does not see the nested query — it is executed as part of its
 * parent's — so the refusal has to be decided from the shape of the request before it is sent.
 *
 * The one safe form is a nested `select` naming the columns it wants and not naming a
 * restricted one. Anything else comes back whole, with no opportunity to omit anything.
 */
function refuseRestrictedReach(
  branch: unknown,
  model: string,
  context: TenantContext,
): void {
  if (!isRecord(branch)) return;

  const relations = relationTargets(model);

  for (const [key, value] of Object.entries(branch)) {
    const target = relations[key];
    if (!target || value === false || value === undefined) continue;

    const asked = isRecord(value) ? value.select : undefined;

    for (const [field, grant] of withheldFields(target, tenancyOf(target), context)) {
      if (!isRecord(asked) || asked[field]) {
        throw new RestrictedFieldError(target, field, grant);
      }
    }

    if (isRecord(value)) {
      refuseRestrictedReach(value.include, target, context);
      refuseRestrictedReach(value.select, target, context);
      refuseRestrictedFilter(value.where, target, context);
    }
  }
}

/** The aggregate selectors, where a restricted column is read by being computed over. */
const AGGREGATE_SELECTORS = ['_sum', '_avg', '_min', '_max', '_count'];

function aggregatesOver(args: Record<string, unknown>, field: string): boolean {
  return AGGREGATE_SELECTORS.some((selector) => {
    const over = args[selector];
    return isRecord(over) && over[field] !== undefined;
  });
}

/** Whether a bare column name, or a list of them, names this field. */
function names(value: unknown, field: string): boolean {
  return value === field || (Array.isArray(value) && value.includes(field));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
