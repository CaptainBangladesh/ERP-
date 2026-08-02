/**
 * What a list endpoint lets a caller do to it.
 *
 * A module declares its fields and nothing else — no paging code, no sort parsing, no filter
 * translation. Everything a caller can ask for is derived from this table, which means the
 * answer to "can somebody sort by this column?" is in one readable place per endpoint rather
 * than distributed through a service.
 *
 * The declaration is an allow-list on purpose. A field nobody names here is not reachable
 * from a query string at all, so `?sort=passwordHash` is not a question the system has to
 * have an answer to — it is refused for naming a field this endpoint does not offer, before
 * anything touches the database.
 *
 * Restriction beyond company scope is *not* declared here. `platform/tenancy/company-owned.ts`
 * owns that, and a second copy would eventually disagree with the first: a field declared
 * sortable that the caller may not read is refused by the tenancy extension and translated to
 * a 403 at the boundary. See ADR 0004.
 */

/** How a filter value is read, and which operators apply to it. */
export type ListFieldType = 'text' | 'integer' | 'decimal' | 'boolean' | 'date';

export interface ListField {
  readonly type: ListFieldType;
  readonly sortable?: boolean;
  readonly filterable?: boolean;
  /**
   * Matched by free-text `?search=`. Text fields only — a search box that quietly matched a
   * date column would return rows nobody can explain.
   */
  readonly searchable?: boolean;
}

export interface ListSpec {
  readonly fields: Readonly<Record<string, ListField>>;
  /**
   * Applied when the caller does not ask. `'name'` or `'-name'`.
   *
   * Required rather than optional: a list with no default order is a list whose contents
   * shuffle between pages, because the database is free to return rows in whatever order it
   * finds them and usually does something different once the table grows.
   */
  readonly defaultSort: string;
  /** Overrides the platform default. Rarely worth setting. */
  readonly pageSize?: number;
}

/** The operators each type accepts. Everything else is refused, naming the field. */
export const OPERATORS_BY_TYPE = {
  text: ['eq', 'ne', 'in', 'contains', 'startsWith'],
  integer: ['eq', 'ne', 'lt', 'lte', 'gt', 'gte', 'in'],
  decimal: ['eq', 'ne', 'lt', 'lte', 'gt', 'gte', 'in'],
  boolean: ['eq', 'ne'],
  date: ['eq', 'ne', 'lt', 'lte', 'gt', 'gte'],
} as const satisfies Readonly<Record<ListFieldType, readonly string[]>>;

export function sortableFields(spec: ListSpec): string[] {
  return Object.entries(spec.fields)
    .filter(([, field]) => field.sortable)
    .map(([name]) => name);
}

export function filterableFields(spec: ListSpec): string[] {
  return Object.entries(spec.fields)
    .filter(([, field]) => field.filterable)
    .map(([name]) => name);
}

export function searchableFields(spec: ListSpec): string[] {
  return Object.entries(spec.fields)
    .filter(([, field]) => field.searchable && field.type === 'text')
    .map(([name]) => name);
}
