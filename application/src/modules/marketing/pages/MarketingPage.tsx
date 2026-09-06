import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import {
  ERROR_CODES,
  MARKETING_FIELDS,
  MARKETING_PATHS,
  emptyPage,
  listPath,
  listQueryString,
  type CreateMarketingRequest,
  type ListQuery,
  type MarketingListResponse,
  type MarketingResponse,
  type MarketingStatus,
  type MarketingSummary,
} from '@erp/shared';
import { DataTable, Field, FormError } from '@erp/shared/ui';
import { ApiFailure, api } from '../../../api/client';

/**
 * Marketing.
 *
 * Everything about paging, sorting, filtering and searching is the platform's: this holds a
 * 'ListQuery' in state, hands it to the shared table, and builds the URL with the shared
 * helper. What a screen contributes is the columns, the filter controls its own fields
 * deserve, and the form.
 */
export function MarketingPage() {
  const [query, setQuery] = useState<ListQuery>({});
  const queryClient = useQueryClient();

  const marketing = useQuery({
    // The query string *is* the cache key: two different requests are two different answers,
    // and the shared builder sorts its parameters so one request is always one key.
    queryKey: ['marketing', 'list', listQueryString(query)],
    queryFn: () =>
      api.get<MarketingListResponse>(listPath(MARKETING_PATHS.marketings, query)),
  });

  const failure = marketing.error instanceof ApiFailure ? marketing.error : undefined;

  const columns = useMemo<Array<ColumnDef<MarketingSummary, unknown>>>(
    () => [
      // The id is the field name the server sorts by, taken from the shared contract so a
      // rename breaks the build rather than the sort.
      { id: MARKETING_FIELDS.name, header: 'Name', cell: ({ row }) => row.original.name },
      {
        id: MARKETING_FIELDS.status,
        header: 'Status',
        cell: ({ row }) => STATUS_LABELS[row.original.status],
      },
    ],
    [],
  );

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-slate-900">Marketing</h1>
        <p className="text-sm text-slate-600">Everything this company keeps here.</p>
      </header>

      <AddMarketing
        onAdded={() => {
          // The list is stale the moment a row is added, and a screen showing a list that
          // does not contain what you just created is a screen nobody trusts again.
          void queryClient.invalidateQueries({ queryKey: ['marketing'] });
          setQuery({});
        }}
      />

      <DataTable
        caption="Marketing"
        columns={columns}
        rows={marketing.data?.items ?? []}
        rowId={(row) => row.id}
        page={marketing.data?.page ?? emptyPage()}
        query={query}
        onQueryChange={setQuery}
        status={marketing.isPending ? 'loading' : marketing.isError ? 'error' : 'ready'}
        error={failure?.message}
        onRetry={() => void marketing.refetch()}
        searchLabel="Search by name"
        empty={
          <div className="flex flex-col gap-1">
            <p className="font-medium text-slate-900">Nothing here yet.</p>
            <p>Add your first marketing using the form above.</p>
          </div>
        }
      />
    </div>
  );
}

const STATUS_LABELS = {
  active: 'Active',
  inactive: 'Inactive',
} as const satisfies Record<MarketingStatus, string>;

/**
 * The form that creates one.
 *
 * On the page rather than behind a button, because of the empty state it has to serve:
 * nothing in this system is seeded, so an empty list is the first thing every user sees and
 * the thing the screen should guide them towards is right there.
 */
function AddMarketing({ onAdded }: { onAdded: (created: MarketingResponse) => void }) {
  const [name, setName] = useState('');

  const add = useMutation({
    mutationFn: () =>
      api.post<MarketingResponse>(MARKETING_PATHS.marketings, {
        name,
      } satisfies CreateMarketingRequest),
    onSuccess: (created) => {
      setName('');
      onAdded(created);
    },
  });

  const failure = add.error instanceof ApiFailure ? add.error : undefined;
  const fields = failure?.fields ?? {};

  return (
    <form
      noValidate
      aria-labelledby="add-marketing"
      className="flex flex-col gap-4 rounded-md border border-slate-200 bg-white p-4"
      onSubmit={(event) => {
        event.preventDefault();
        add.mutate();
      }}
    >
      <h2 id="add-marketing" className="text-sm font-medium text-slate-900">
        Add a marketing
      </h2>

      <div className="flex flex-wrap gap-4">
        <div className="min-w-56 flex-1">
          <Field id="marketing-name" label="Name" value={name} error={fields.name} onChange={setName} />
        </div>
      </div>

      {failure && failure.code !== ERROR_CODES.validationFailed && (
        <FormError>{failure.message}</FormError>
      )}

      <div>
        <button
          type="submit"
          disabled={add.isPending}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
        >
          {add.isPending ? 'Adding…' : 'Add marketing'}
        </button>
      </div>
    </form>
  );
}
