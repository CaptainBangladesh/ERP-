/**
 * The one list shape, and the one way a caller asks for a slice of it.
 *
 * Every list endpoint in every module returns `ListResponse<T>` and accepts the parameters
 * below. That is what lets one table component serve forty modules: a screen that can page,
 * sort, filter and search one list can do it to any of them, because there is nothing
 * per-module to learn.
 *
 * A module declares *which* of its fields participate — see the backend's list platform — and
 * writes no paging, sorting or filtering code of its own.
 *
 * ADR 0004 records why paging is offset-and-total rather than cursor-based, and what would
 * bring cursors back.
 */

/** Where a page sits in the whole result, and how much of it there is. */
export interface PageInfo {
  /** 1-based, as a person counts pages. */
  number: number;
  /** How many items were asked for. The last page may hold fewer. */
  size: number;
  /** Matching rows in total, after filters and search, before paging. */
  total: number;
  /** How many pages that makes. `0` when nothing matched — there is no page 1 of 0 items. */
  pages: number;
}

/** What every list endpoint returns. */
export interface ListResponse<T> {
  items: T[];
  page: PageInfo;
}

/**
 * The query-string parameters. Named here so the frontend builds URLs from the same
 * constants the backend reads them with, and a rename is a compile error rather than a list
 * that quietly stops sorting.
 */
export const LIST_PARAMS = {
  page: 'page',
  pageSize: 'pageSize',
  /** A field name, optionally prefixed with `-` for descending: `sort=-name`. */
  sort: 'sort',
  /** Free text, matched across whichever fields the endpoint declares searchable. */
  search: 'search',
} as const;

/**
 * Filters are `filter.<field>` for equality, or `filter.<field>.<operator>` for anything else:
 * `?filter.confidential=true&filter.name.contains=oka`.
 *
 * A dotted flat key rather than PHP-style `filter[field][op]` brackets, because bracket
 * parsing depends on which query-string parser the server happens to be configured with, and
 * a convention forty modules depend on should not.
 */
export const FILTER_PREFIX = 'filter.';

/**
 * What a filter can ask. Which of them apply to a given field depends on its type, and the
 * endpoint decides which fields are filterable at all.
 */
export const FILTER_OPERATORS = [
  'eq',
  'ne',
  'lt',
  'lte',
  'gt',
  'gte',
  /** Comma-separated: `?filter.status.in=active,archived`. */
  'in',
  /** Case-insensitive substring. Text only. */
  'contains',
  /** Case-insensitive prefix. Text only. */
  'startsWith',
] as const;

export type FilterOperator = (typeof FILTER_OPERATORS)[number];

export const PAGE_SIZE = {
  default: 25,
  min: 1,
  /**
   * A ceiling rather than a suggestion. Without one, `?pageSize=1000000` is a way for any
   * caller to ask the database for everything, on every endpoint, forever.
   */
  max: 100,
} as const;

/** The default when an endpoint's caller does not say. Ascending. */
export const SORT_DESCENDING_PREFIX = '-';

/** A list request, as a screen thinks of it. */
export interface ListQuery {
  page?: number;
  pageSize?: number;
  /** `'name'` or `'-name'`. */
  sort?: string;
  search?: string;
  /**
   * Keyed by field, or by `field.operator`. `{ 'name.contains': 'oka' }` and
   * `{ confidential: 'false' }` are both valid.
   */
  filters?: Readonly<Record<string, string>>;
}

/**
 * A list request as a query string, built from the constants above.
 *
 * Shared rather than written on the frontend so that both sides of the convention come from
 * one file. Empty values are dropped rather than sent blank, so a cleared search box produces
 * the same URL as one that was never typed in — which is what keeps the query cache from
 * holding two entries for one screen.
 */
export function listQueryString(query: ListQuery): string {
  const parameters = new URLSearchParams();

  if (query.page !== undefined && query.page > 1) {
    parameters.set(LIST_PARAMS.page, String(query.page));
  }
  if (query.pageSize !== undefined) {
    parameters.set(LIST_PARAMS.pageSize, String(query.pageSize));
  }
  if (query.sort) parameters.set(LIST_PARAMS.sort, query.sort);

  const search = query.search?.trim();
  if (search) parameters.set(LIST_PARAMS.search, search);

  for (const [key, value] of Object.entries(query.filters ?? {})) {
    if (value !== '') parameters.set(`${FILTER_PREFIX}${key}`, value);
  }

  // Sorted so that the same request is the same string, which is what makes it usable as a
  // cache key. `URLSearchParams` preserves insertion order otherwise.
  parameters.sort();

  const rendered = parameters.toString();
  return rendered === '' ? '' : `?${rendered}`;
}

/** A path with a list query appended. The one way a list URL is built. */
export function listPath(path: string, query: ListQuery = {}): string {
  return `${path}${listQueryString(query)}`;
}

/** How a sort is written down and taken apart, in one place so the two cannot disagree. */
export function sortParameter(field: string, descending: boolean): string {
  return descending ? `${SORT_DESCENDING_PREFIX}${field}` : field;
}

export function readSortParameter(sort: string): { field: string; descending: boolean } {
  const descending = sort.startsWith(SORT_DESCENDING_PREFIX);
  return { field: descending ? sort.slice(1) : sort, descending };
}

/** The page a list has when nothing matched. Saves every empty branch inventing one. */
export function emptyPage(size: number = PAGE_SIZE.default): PageInfo {
  return { number: 1, size, total: 0, pages: 0 };
}

/**
 * The query with one filter set, or gone.
 *
 * Two details every filter control needs and each would otherwise get right separately.
 * Cleared means *gone* rather than blank: an empty filter left in the object still counts as
 * narrowing, so the screen would go on offering "clear your filters" to somebody with none.
 * And paging returns to the first page, because page four of the old list is not page four of
 * the new one.
 */
export function narrowed(query: ListQuery, field: string, value: string): ListQuery {
  const filters = { ...query.filters };
  if (value) filters[field] = value;
  else delete filters[field];

  return { ...query, filters, page: 1 };
}
