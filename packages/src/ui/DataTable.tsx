import { useEffect, useId, useState, type ReactNode } from 'react';
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
} from '@tanstack/react-table';
import {
  PAGE_SIZE,
  readSortParameter,
  sortParameter,
  type ListQuery,
  type PageInfo,
} from '../http/list.js';

/**
 * The one table every list screen uses.
 *
 * TanStack Table for the headless logic and not one byte of its markup — it ships none, which
 * is what qualifies it under the frontend dependency rule. Every element below is written
 * here, styled with Tailwind, and can be read.
 *
 * **The server does the work.** Sorting, filtering and paging are query-string parameters
 * this hands back through `onQueryChange`; the table never sorts an array or slices a page.
 * That is not an implementation detail — a table that sorted its own page would sort the
 * twenty-five rows it happens to be holding and call it a sort of a thousand, which looks
 * right and is wrong.
 *
 * **Three states, and empty split in two.** Loading, error and empty are different situations
 * and get different renderings. Empty is then split again, into *nothing here yet* — which
 * guides the first action, because nothing in this system is seeded and an empty database is
 * the first thing a user sees — and *nothing matched*, which offers a way back out. Showing
 * "add your first employee" to somebody who has two hundred and a typo in the search box is
 * the failure that split exists to prevent. Four renderings, three states.
 */
export interface DataTableProps<T> {
  /**
   * Each column's `id` is the field name the server sorts by. A column with no `id` cannot be
   * sortable, which is the right way round: sortability is a claim about the API.
   */
  columns: Array<ColumnDef<T, unknown>>;
  rows: T[];
  rowId: (row: T) => string;
  page: PageInfo;
  query: ListQuery;
  onQueryChange: (query: ListQuery) => void;
  /** What the request is doing right now. */
  status: 'loading' | 'error' | 'ready';
  /** Announced when `status` is `error`. A message from `ApiFailure`, usually. */
  error?: string;
  onRetry?: () => void;
  /** Shown when the account holds none of these at all. Should name the first action. */
  empty: ReactNode;
  /** Shown when filters or a search excluded everything. Defaults to a generic line. */
  noMatches?: ReactNode;
  /** Describes the table to a screen reader. Rendered as a visually hidden `<caption>`. */
  caption: string;
  /** Omit to hide the search box entirely, for a list with nothing searchable. */
  searchLabel?: string;
  /** Extra controls — a status filter, a date range — rendered beside the search box. */
  filters?: ReactNode;
}

export function DataTable<T>({
  columns,
  rows,
  rowId,
  page,
  query,
  onQueryChange,
  status,
  error,
  onRetry,
  empty,
  noMatches,
  caption,
  searchLabel,
  filters,
}: DataTableProps<T>) {
  const table = useReactTable({
    data: rows,
    columns,
    getCoreRowModel: getCoreRowModel(),
    // Every one of these says the same thing: the server already did it. Left on, TanStack
    // would re-sort and re-slice the single page it has been handed.
    manualSorting: true,
    manualFiltering: true,
    manualPagination: true,
    pageCount: page.pages,
  });

  const sort = query.sort ? readSortParameter(query.sort) : undefined;
  const narrowed = Boolean(query.search) || Object.keys(query.filters ?? {}).length > 0;

  return (
    <div className="flex flex-col gap-4">
      {(searchLabel || filters) && (
        <div className="flex flex-wrap items-end gap-3">
          {searchLabel && (
            <SearchBox
              label={searchLabel}
              value={query.search ?? ''}
              onSearch={(search) => onQueryChange({ ...query, search, page: 1 })}
            />
          )}
          {filters}
        </div>
      )}

      <div className="overflow-x-auto rounded-md border border-slate-200 bg-white">
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">{caption}</caption>

          <thead>
            {table.getHeaderGroups().map((group) => (
              <tr key={group.id} className="border-b border-slate-200">
                {group.headers.map((header) => {
                  const field = header.column.id;
                  const sortable = header.column.columnDef.enableSorting !== false;
                  const active = sort?.field === field;
                  const label = flexRender(
                    header.column.columnDef.header,
                    header.getContext(),
                  );

                  return (
                    <th
                      key={header.id}
                      scope="col"
                      // Announced by a screen reader as the column's sort state, which is
                      // the only signal a caret alone does not give.
                      aria-sort={
                        active ? (sort?.descending ? 'descending' : 'ascending') : undefined
                      }
                      className="px-4 py-2.5 text-left font-medium text-slate-600"
                    >
                      {sortable ? (
                        <button
                          type="button"
                          onClick={() =>
                            onQueryChange({
                              ...query,
                              // Clicking the column already sorted reverses it; clicking a
                              // different one starts it ascending, which is what everybody
                              // expects and nobody can articulate.
                              sort: sortParameter(field, active ? !sort?.descending : false),
                              page: 1,
                            })
                          }
                          className="flex items-center gap-1 hover:text-slate-900"
                        >
                          {label}
                          <span aria-hidden="true" className="text-xs">
                            {active ? (sort?.descending ? '▾' : '▴') : '↕'}
                          </span>
                        </button>
                      ) : (
                        label
                      )}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>

          <tbody>
            {status === 'ready' &&
              table.getRowModel().rows.map((row) => (
                <tr
                  key={rowId(row.original)}
                  className="border-b border-slate-100 last:border-0"
                >
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className="px-4 py-2.5 text-slate-900">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))}
          </tbody>
        </table>

        {/*
          Outside the table rather than in a spanning cell. A status message is not a row of
          data, and a screen reader announcing it as one — "row 1 of 1, loading" — is worse
          than not announcing it. The live regions do that job properly.
        */}
        {status === 'loading' && (
          <p role="status" className="px-4 py-8 text-center text-sm text-slate-500">
            Loading…
          </p>
        )}

        {status === 'error' && (
          <div role="alert" className="px-4 py-8 text-center">
            <p className="text-sm text-red-700">
              {error ?? 'Something went wrong. Please try again.'}
            </p>
            {onRetry && (
              <button
                type="button"
                onClick={onRetry}
                className="mt-3 rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
              >
                Try again
              </button>
            )}
          </div>
        )}

        {status === 'ready' && rows.length === 0 && (
          <div className="px-4 py-10 text-center text-sm text-slate-600">
            {narrowed ? (noMatches ?? <NoMatches onClear={() => onQueryChange({})} />) : empty}
          </div>
        )}
      </div>

      {status === 'ready' && page.pages > 1 && (
        <Paging page={page} onPage={(number) => onQueryChange({ ...query, page: number })} />
      )}
    </div>
  );
}

/**
 * The search box, which searches when asked rather than on every keystroke.
 *
 * A box that fires a request per character is a box that fires eight requests to search for
 * "lindqvist" and renders the answer to the seventh. Debouncing hides that rather than fixing
 * it, and adds a timer nobody can see in a test. Submitting is explicit, and Enter submits.
 */
function SearchBox({
  label,
  value,
  onSearch,
}: {
  label: string;
  value: string;
  onSearch: (value: string) => void;
}) {
  const [text, setText] = useState(value);
  // Generated rather than fixed, because two tables on one screen with the same hard-coded
  // id produce two elements sharing it and a label pointing at whichever the browser found
  // first — so one of the two search boxes would be unlabelled and unclickable.
  const id = useId();

  // Kept in step with the query it reflects, so clearing the filters from anywhere else —
  // the "clear" button on the empty state, for one — empties the box too.
  useEffect(() => setText(value), [value]);

  return (
    <form
      className="flex items-end gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        onSearch(text.trim());
      }}
    >
      <div className="flex flex-col gap-1.5">
        <label htmlFor={id} className="text-sm font-medium text-slate-900">
          {label}
        </label>
        <input
          id={id}
          name="search"
          type="search"
          value={text}
          onChange={(event) => setText(event.target.value)}
          className="w-64 rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-slate-900/20"
        />
      </div>
      <button
        type="submit"
        className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
      >
        Search
      </button>
    </form>
  );
}

function NoMatches({ onClear }: { onClear: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3">
      <p>Nothing matches what you asked for.</p>
      <button
        type="button"
        onClick={onClear}
        className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
      >
        Clear search and filters
      </button>
    </div>
  );
}

/**
 * Previous, next, and where you are.
 *
 * The count is the reason paging is offset-based rather than cursor-based: "Page 2 of 12,
 * 287 rows" is what somebody operating a list needs, and a cursor cannot produce either
 * number. See ADR 0004.
 */
function Paging({ page, onPage }: { page: PageInfo; onPage: (number: number) => void }) {
  const size = page.size || PAGE_SIZE.default;

  return (
    <nav aria-label="Pagination" className="flex items-center justify-between gap-4">
      <p className="text-sm text-slate-600">
        Page {page.number} of {page.pages} · {page.total}{' '}
        {page.total === 1 ? 'row' : 'rows'}
      </p>

      <div className="flex gap-2">
        <PageButton
          label="Previous"
          disabled={page.number <= 1}
          onClick={() => onPage(page.number - 1)}
        />
        <PageButton
          label="Next"
          disabled={page.number >= page.pages}
          onClick={() => onPage(page.number + 1)}
        />
      </div>
      <span className="sr-only">{size} rows a page</span>
    </nav>
  );
}

function PageButton({
  label,
  disabled,
  onClick,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-40"
    >
      {label}
    </button>
  );
}
