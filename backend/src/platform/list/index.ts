/**
 * The one list convention: search, filter, sort and paging, for every module.
 *
 * A module declares a `ListSpec` beside its controller, hands `listQuery` the request's query
 * object, and reads its rows with the `ListSlice` that comes back. It writes no paging, no
 * sorting and no filtering — which is what makes forty modules' list screens behave the same
 * way without forty implementations agreeing to.
 *
 * ADR 0004 records the shape and the two decisions inside it: offset paging with a total
 * rather than cursors, and a 403 rather than a 422 for a field the caller may not read.
 */
export { listQuery } from './list-query';
export { ListSlice } from './list-slice';
export {
  filterableFields,
  searchableFields,
  sortableFields,
  type ListField,
  type ListFieldType,
  type ListSpec,
} from './list-spec';
