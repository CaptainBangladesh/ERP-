import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import {
  ERROR_CODES,
  PRODUCT_PATHS,
  WARRANTY_FIELDS,
  WARRANTY_PATHS,
  emptyPage,
  listPath,
  listQueryString,
  type CreateWarrantyRequest,
  type ListQuery,
  type ProductListResponse,
  type WarrantyListResponse,
  type WarrantyResponse,
  type WarrantyStatus,
  type WarrantySummary,
} from '@erp/shared';
import { DataTable, Field, FormError, Select } from '@erp/shared/ui';
import { ApiFailure, api } from '../../../api/client';

/**
 * Warranties — the add-on shape stub's screen. Reachable only for a company on the Custom
 * tier; the module manifest's `tier` is what decides that, not anything here.
 *
 * Everything about paging, sorting, filtering and searching is the platform's: this holds a
 * 'ListQuery' in state, hands it to the shared table, and builds the URL with the shared
 * helper. `productName` is not sortable or filterable — it is resolved through the products
 * module's public contract at read time rather than stored, so there is no column for the
 * server to sort by.
 */
export function WarrantiesPage() {
  const [query, setQuery] = useState<ListQuery>({});
  const queryClient = useQueryClient();

  const warranties = useQuery({
    // The query string *is* the cache key: two different requests are two different answers,
    // and the shared builder sorts its parameters so one request is always one key.
    queryKey: ['warranties', 'list', listQueryString(query)],
    queryFn: () =>
      api.get<WarrantyListResponse>(listPath(WARRANTY_PATHS.warranties, query)),
  });

  const failure = warranties.error instanceof ApiFailure ? warranties.error : undefined;

  const columns = useMemo<Array<ColumnDef<WarrantySummary, unknown>>>(
    () => [
      {
        id: 'productName',
        header: 'Product',
        enableSorting: false,
        cell: ({ row }) => row.original.productName,
      },
      // The id is the field name the server sorts by, taken from the shared contract so a
      // rename breaks the build rather than the sort.
      { id: WARRANTY_FIELDS.months, header: 'Months', cell: ({ row }) => row.original.months },
      {
        id: WARRANTY_FIELDS.status,
        header: 'Status',
        cell: ({ row }) => STATUS_LABELS[row.original.status],
      },
    ],
    [],
  );

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-slate-900">Warranties</h1>
        <p className="text-sm text-slate-600">Warranty cover recorded against a product.</p>
      </header>

      <AddWarranty
        onAdded={() => {
          // The list is stale the moment a row is added, and a screen showing a list that
          // does not contain what you just created is a screen nobody trusts again.
          void queryClient.invalidateQueries({ queryKey: ['warranties'] });
          setQuery({});
        }}
      />

      <DataTable
        caption="Warranties"
        columns={columns}
        rows={warranties.data?.items ?? []}
        rowId={(row) => row.id}
        page={warranties.data?.page ?? emptyPage()}
        query={query}
        onQueryChange={setQuery}
        status={warranties.isPending ? 'loading' : warranties.isError ? 'error' : 'ready'}
        error={failure?.message}
        onRetry={() => void warranties.refetch()}
        searchLabel="Search"
        empty={
          <div className="flex flex-col gap-1">
            <p className="font-medium text-slate-900">Nothing here yet.</p>
            <p>Add your first warranty using the form above.</p>
          </div>
        }
      />
    </div>
  );
}

const STATUS_LABELS = {
  active: 'Active',
  inactive: 'Inactive',
} as const satisfies Record<WarrantyStatus, string>;

/**
 * The form that creates one.
 *
 * On the page rather than behind a button, because of the empty state it has to serve:
 * nothing in this system is seeded, so an empty list is the first thing every user sees and
 * the thing the screen should guide them towards is right there.
 */
function AddWarranty({ onAdded }: { onAdded: (created: WarrantyResponse) => void }) {
  const [productId, setProductId] = useState('');
  const [months, setMonths] = useState('');

  const products = useQuery({
    queryKey: ['products', 'for-warranty-form'],
    queryFn: () => api.get<ProductListResponse>(listPath(PRODUCT_PATHS.products, { pageSize: 100 })),
  });

  const add = useMutation({
    mutationFn: () =>
      api.post<WarrantyResponse>(WARRANTY_PATHS.warranties, {
        productId,
        months: Number(months),
      } satisfies CreateWarrantyRequest),
    onSuccess: (created) => {
      setProductId('');
      setMonths('');
      onAdded(created);
    },
  });

  const failure = add.error instanceof ApiFailure ? add.error : undefined;
  const fields = failure?.fields ?? {};

  return (
    <form
      noValidate
      aria-labelledby="add-warranty"
      className="flex flex-col gap-4 rounded-md border border-slate-200 bg-white p-4"
      onSubmit={(event) => {
        event.preventDefault();
        add.mutate();
      }}
    >
      <h2 id="add-warranty" className="text-sm font-medium text-slate-900">
        Add a warranty
      </h2>

      <div className="flex flex-wrap gap-4">
        <div className="min-w-56 flex-1">
          <Select
            id="warranty-product"
            label="Product"
            value={productId}
            placeholder="Choose a product…"
            error={fields.productId}
            options={(products.data?.items ?? []).map((product) => ({
              value: product.id,
              label: `${product.code} — ${product.name}`,
            }))}
            onChange={setProductId}
          />
        </div>
        <div className="min-w-40 flex-1">
          <Field
            id="warranty-months"
            label="Months"
            inputMode="numeric"
            value={months}
            error={fields.months}
            onChange={setMonths}
          />
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
          {add.isPending ? 'Adding…' : 'Add warranty'}
        </button>
      </div>
    </form>
  );
}
