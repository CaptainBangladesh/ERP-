import {
  Decimal,
  DecimalFormatError,
  FILTER_PREFIX,
  LIST_PARAMS,
  PAGE_SIZE,
  readSortParameter,
  type FilterOperator,
} from '@erp/shared';
import { ValidationException } from '../../http/validation-exception';
import { ListSlice } from './list-slice';
import {
  OPERATORS_BY_TYPE,
  filterableFields,
  sortableFields,
  searchableFields,
  type ListField,
  type ListFieldType,
  type ListSpec,
} from './list-spec';

/**
 * One query string, read against one endpoint's declaration.
 *
 * This is the whole of "search, filter, sort and pagination follow one convention across all
 * modules". A module calls it with its `ListSpec` and gets back a `ListSlice`; it never sees
 * a parameter name, never parses a value, and never writes a `skip`.
 *
 * Everything a caller got wrong is collected before anything is refused, and each message is
 * keyed by the *parameter* it belongs to — `sort`, `pageSize`, `filter.name.contains` — so
 * the same field-level error shape a form uses works for a list screen's controls too.
 *
 * What it deliberately does not do is decide whether the caller may *read* a field. That is
 * `platform/tenancy`'s, which refuses the query and is translated to a 403 at the boundary.
 * Two places knowing which columns are restricted is two places for that to drift.
 */
export function listQuery(
  query: Readonly<Record<string, unknown>>,
  spec: ListSpec,
): ListSlice {
  const problems: Record<string, string> = {};
  const report = (parameter: string, message: string): void => {
    problems[parameter] = message;
  };

  const page = readPage(query, report);
  const pageSize = readPageSize(query, spec, report);
  const orderBy = readSort(query, spec, report);
  const where = readWhere(query, spec, report);

  if (Object.keys(problems).length > 0) {
    throw new ValidationException(problems, 'That list request could not be understood.');
  }

  return new ListSlice(page, pageSize, where, orderBy);
}

function readPage(
  query: Readonly<Record<string, unknown>>,
  report: Report,
): number {
  const raw = single(query[LIST_PARAMS.page]);
  if (raw === undefined) return 1;

  const page = Number(raw);
  if (!Number.isInteger(page) || page < 1) {
    report(LIST_PARAMS.page, 'Ask for a page number of 1 or more.');
    return 1;
  }
  return page;
}

function readPageSize(
  query: Readonly<Record<string, unknown>>,
  spec: ListSpec,
  report: Report,
): number {
  const fallback = spec.pageSize ?? PAGE_SIZE.default;
  const raw = single(query[LIST_PARAMS.pageSize]);
  if (raw === undefined) return fallback;

  const size = Number(raw);
  if (!Number.isInteger(size) || size < PAGE_SIZE.min || size > PAGE_SIZE.max) {
    report(
      LIST_PARAMS.pageSize,
      `Ask for between ${PAGE_SIZE.min} and ${PAGE_SIZE.max} rows at a time.`,
    );
    return fallback;
  }
  return size;
}

/**
 * The order, with a tiebreak the caller did not ask for and needs anyway.
 *
 * Sorting by a column with duplicate values leaves the database free to order the ties
 * however it likes, and it does not have to choose the same way twice — so a row can appear
 * on page one and again on page two while nothing has changed. Appending the identifier makes
 * the order total, which is what makes paging through it honest.
 */
function readSort(
  query: Readonly<Record<string, unknown>>,
  spec: ListSpec,
  report: Report,
): Array<Record<string, 'asc' | 'desc'>> {
  const raw = single(query[LIST_PARAMS.sort]) ?? spec.defaultSort;
  const { field, descending } = readSortParameter(raw);

  const declared = spec.fields[field];
  if (!declared?.sortable) {
    report(
      LIST_PARAMS.sort,
      `You cannot sort by '${field}'. ${offering(sortableFields(spec), 'Sort by')}`,
    );
    // The request is already refused; the endpoint's own order is returned only so the rest
    // of the parsing has something well-formed to carry on with and collect its own problems.
    return tiebroken(spec.defaultSort);
  }

  return order(field, descending);
}

function tiebroken(sort: string): Array<Record<string, 'asc' | 'desc'>> {
  const { field, descending } = readSortParameter(sort);
  return order(field, descending);
}

function order(field: string, descending: boolean): Array<Record<string, 'asc' | 'desc'>> {
  const direction = descending ? 'desc' : 'asc';
  // Sorting by the identifier is already total, so a second clause on it would be noise.
  return field === 'id' ? [{ id: direction }] : [{ [field]: direction }, { id: 'asc' }];
}

/**
 * The filters and the search, as one Prisma `where`.
 *
 * Filters are ANDed with each other and with the search, which is what a person operating a
 * list screen expects: narrowing by status and then typing in the search box should search
 * within the status, not alongside it.
 */
function readWhere(
  query: Readonly<Record<string, unknown>>,
  spec: ListSpec,
  report: Report,
): Record<string, unknown> {
  const where: Record<string, Record<string, unknown>> = {};

  for (const [parameter, value] of Object.entries(query)) {
    if (!parameter.startsWith(FILTER_PREFIX)) continue;

    const condition = readFilter(parameter, single(value), spec, report);
    if (!condition) continue;

    where[condition.field] = { ...where[condition.field], ...condition.clause };
  }

  const search = readSearch(query, spec, report);
  if (!search) return where;

  // `AND` rather than merging, because the search is an OR across several columns and one of
  // those columns may already carry a filter. Nesting keeps the two independent.
  return { AND: [where, search] };
}

interface Condition {
  field: string;
  clause: Record<string, unknown>;
}

function readFilter(
  parameter: string,
  value: string | undefined,
  spec: ListSpec,
  report: Report,
): Condition | undefined {
  if (value === undefined) return undefined;

  // `filter.name` is equality; `filter.name.contains` names an operator. Splitting from the
  // right rather than the left so a field name is free to contain a dot if a module ever has
  // one — the operator is the last segment or it is not there.
  const path = parameter.slice(FILTER_PREFIX.length);
  const lastDot = path.lastIndexOf('.');
  const maybeOperator = lastDot === -1 ? undefined : path.slice(lastDot + 1);
  const named = isOperator(maybeOperator);

  const field = named ? path.slice(0, lastDot) : path;
  const operator: FilterOperator = named ? (maybeOperator as FilterOperator) : 'eq';

  const declared = spec.fields[field];
  if (!declared?.filterable) {
    report(
      parameter,
      `You cannot filter by '${field}'. ${offering(filterableFields(spec), 'Filter by')}`,
    );
    return undefined;
  }

  const allowed: readonly string[] = OPERATORS_BY_TYPE[declared.type];
  if (!allowed.includes(operator)) {
    report(
      parameter,
      `'${operator}' cannot be used on '${field}'. ${offering([...allowed], 'Use')}`,
    );
    return undefined;
  }

  return clauseFor(parameter, field, declared, operator, value, report);
}

function clauseFor(
  parameter: string,
  field: string,
  declared: ListField,
  operator: FilterOperator,
  value: string,
  report: Report,
): Condition | undefined {
  if (operator === 'in') {
    const parts = value.split(',').map((part) => part.trim());
    const values: unknown[] = [];

    for (const part of parts) {
      const read = readValue(part, declared.type);
      if (read === undefined) {
        report(parameter, notA(part, declared.type));
        return undefined;
      }
      values.push(read);
    }

    return { field, clause: { in: values } };
  }

  // Substring matching is case-insensitive because a person searching a list is not thinking
  // about capitals. It is the one place a filter is not a literal comparison.
  if (operator === 'contains' || operator === 'startsWith') {
    return { field, clause: { [operator]: value, mode: 'insensitive' } };
  }

  const read = readValue(value, declared.type);
  if (read === undefined) {
    report(parameter, notA(value, declared.type));
    return undefined;
  }

  return { field, clause: operator === 'eq' ? { equals: read } : { [PRISMA_OPERATORS[operator]]: read } };
}

/** Our operator names, as Prisma's. Only `ne` differs, and only in spelling. */
const PRISMA_OPERATORS = {
  eq: 'equals',
  ne: 'not',
  lt: 'lt',
  lte: 'lte',
  gt: 'gt',
  gte: 'gte',
} as const satisfies Readonly<Record<string, string>>;

function readSearch(
  query: Readonly<Record<string, unknown>>,
  spec: ListSpec,
  report: Report,
): Record<string, unknown> | undefined {
  const raw = single(query[LIST_PARAMS.search])?.trim();
  if (!raw) return undefined;

  const fields = searchableFields(spec);
  if (fields.length === 0) {
    report(LIST_PARAMS.search, 'This list cannot be searched.');
    return undefined;
  }

  return {
    OR: fields.map((field) => ({ [field]: { contains: raw, mode: 'insensitive' } })),
  };
}

/**
 * A filter value, as the type its field was declared to be.
 *
 * A decimal is handed on as *text*. Prisma reads a string into a `numeric` column exactly,
 * and converting through a JavaScript number on the way — which is what `Number(value)`
 * would do — is the precision loss this whole ticket exists to rule out.
 */
function readValue(value: string, type: ListFieldType): unknown {
  switch (type) {
    case 'text':
      return value;

    case 'boolean':
      if (value === 'true') return true;
      return value === 'false' ? false : undefined;

    case 'integer': {
      const parsed = Number(value);
      return Number.isSafeInteger(parsed) ? parsed : undefined;
    }

    case 'decimal':
      try {
        return Decimal.parse(value).toString();
      } catch (cause) {
        if (cause instanceof DecimalFormatError) return undefined;
        throw cause;
      }

    case 'date': {
      // A bare `YYYY-MM-DD` is read as UTC midnight, as it is everywhere else in this
      // system; a full timestamp is taken as given.
      const parsed = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00.000Z` : value);
      return Number.isNaN(parsed.getTime()) ? undefined : parsed;
    }
  }
}

const TYPE_NAMES: Readonly<Record<ListFieldType, string>> = {
  text: 'text',
  integer: 'a whole number',
  decimal: 'a number',
  boolean: "'true' or 'false'",
  date: 'a date',
};

function notA(value: string, type: ListFieldType): string {
  return `'${value}' is not ${TYPE_NAMES[type]}.`;
}

function offering(fields: string[], verb: string): string {
  if (fields.length === 0) return 'This list offers none.';
  return `${verb} one of: ${fields.join(', ')}.`;
}

function isOperator(candidate: string | undefined): boolean {
  return candidate !== undefined && candidate in OPERATOR_NAMES;
}

const OPERATOR_NAMES: Readonly<Record<FilterOperator, true>> = {
  eq: true,
  ne: true,
  lt: true,
  lte: true,
  gt: true,
  gte: true,
  in: true,
  contains: true,
  startsWith: true,
};

/**
 * One value for a parameter.
 *
 * `?sort=name&sort=-name` arrives as an array. Taking the last is the same rule browsers and
 * every other query parser use, and it makes a screen that appends a parameter to a URL it
 * did not build behave the way whoever wrote it expected.
 */
function single(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    const last = value[value.length - 1];
    return typeof last === 'string' ? last : undefined;
  }
  return undefined;
}

type Report = (parameter: string, message: string) => void;
