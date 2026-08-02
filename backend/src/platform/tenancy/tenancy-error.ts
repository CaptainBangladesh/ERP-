/**
 * The refusals the tenancy mechanism raises.
 *
 * Most of these are not things a user can do. A query issued with no company established, a
 * write naming somebody else's company, an update to an immutable table — all are programming
 * errors, so they surface as unhandled failures and are logged in full rather than becoming
 * something a client could branch on. There is no client behaviour that would be correct in
 * response to "the developer forgot".
 *
 * The two restriction errors are the exception, and became one in ticket 04. Once a list
 * endpoint takes a field name from a query string, `?sort=annualSalary` is a URL a user can
 * type, and a 500 is the wrong answer to it — so `RestrictedFieldError` and
 * `RestrictedRecordError` are translated at the API boundary into a 403 naming the field.
 * They carry the model, the field and the grant as properties for that reason: the message
 * below is for a developer, and the one a caller sees is built from the parts. See ADR 0004.
 *
 * The messages are written for the developer who is about to read them at three in the
 * morning: what was attempted, on what, and what would fix it.
 */
export class TenancyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/**
 * A query against a company-owned table with no company established.
 *
 * The whole point of the mechanism: this throws rather than quietly returning every
 * company's rows. See ADR 0003.
 */
export class MissingCompanyContextError extends TenancyError {
  constructor(model: string, operation: string) {
    super(
      `'${operation}' on '${model}' was attempted with no company established. ` +
        `'${model}' is company-owned, so running this query unscoped would read or write ` +
        `every company's rows. Company context comes from the session automatically on ` +
        `every request; outside a request — a script, a job, a test — wrap the work in ` +
        `'runInCompany'. If this table genuinely belongs to no company, say so in ` +
        `platform/tenancy/company-owned.ts and give the reason.`,
    );
  }
}

/**
 * A query or a write naming a company other than the acting one.
 *
 * Overriding it silently would be worse than refusing: the caller asked for one company's
 * rows and would be handed another's, which is a bug that reads as working code.
 */
export class CrossCompanyError extends TenancyError {
  constructor(model: string, where: 'filter' | 'write', attempted: string, acting: string) {
    super(
      `A ${where} on '${model}' named company '${attempted}' while acting as company ` +
        `'${acting}'. The acting company is applied automatically, so naming one is never ` +
        `necessary — and naming a different one is never permitted. Remove it. ` +
        `Cross-company access is not something this system supports.`,
    );
  }
}

/** A create against the tenant root itself. */
export class TenantRootWriteError extends TenancyError {
  constructor(model: string) {
    super(
      `'${model}' is the tenant root and cannot be created from inside a company — the ` +
        `company doing the creating would have to already be the one being created. ` +
        `Creating a company happens during sign-up, outside company scope.`,
    );
  }
}

/** An update or delete against a table declared immutable. */
export class ImmutableRecordError extends TenancyError {
  constructor(model: string, operation: string) {
    super(
      `'${operation}' on '${model}' was refused: '${model}' is declared immutable in ` +
        `platform/tenancy/company-owned.ts, so a row is written once and never changed. ` +
        `Record a correcting row instead.`,
    );
  }
}

/**
 * The flag marking a row restricted, named by a caller who cannot see restricted rows.
 *
 * Filtering on it would ask a question they may not have the answer to; writing it would put
 * a row into the database they could not then read back. Both are refused rather than
 * quietly overruled, because a filter that silently answers a different question is the
 * failure the whole mechanism exists to prevent.
 */
export class RestrictedRecordError extends TenancyError {
  constructor(
    readonly model: string,
    /** The boolean column marking a row restricted. Named `field` so the two errors match. */
    readonly field: string,
    readonly grant: string,
  ) {
    super(
      `'${model}.${field}' marks a record restricted beyond company scope and requires the ` +
        `'${grant}' grant, which the caller does not hold. Restricted rows are filtered out ` +
        `of every query automatically; naming the flag is either an attempt to reach them ` +
        `or an attempt to create one, and neither is available without the grant.`,
    );
  }
}

/** A restricted field named explicitly by a caller that does not hold its grant. */
export class RestrictedFieldError extends TenancyError {
  constructor(
    readonly model: string,
    readonly field: string,
    readonly grant: string,
  ) {
    super(
      `'${model}.${field}' is restricted beyond company scope and requires the '${grant}' ` +
        `grant, which the caller does not hold. Reading it without naming it returns the ` +
        `row with the field omitted; naming it in 'select', 'where' or an 'include' is a ` +
        `request for data the caller may not have, so it is refused rather than silently ` +
        `emptied.`,
    );
  }
}
