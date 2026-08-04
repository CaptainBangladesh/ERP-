import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import {
  LOCATION_PATHS,
  PRODUCT_PATHS,
  STOCK_FIELDS,
  STOCK_PATHS,
  emptyPage,
  listPath,
  listQueryString,
  narrowed,
  type ListQuery,
  type LocationListResponse,
  type ProductListResponse,
  type StockLevelSummary,
  type StockListResponse,
} from '@erp/shared';
import { DataTable, QuantityText, Select } from '@erp/shared/ui';
import { ApiFailure, api } from '../../../api/client';
import { linkProps } from '../../../app/location';
import { useSession } from '../../../session/SessionProvider';
import { hasPermission } from '../../../session/permissions';
import { RecordAdjustment, RecordMovement, RecordTransfer } from '../components/RecordMovement';

/**
 * What there is, and the ways to change it.
 *
 * The stock figures and the forms that move stock are on one screen deliberately: recording a
 * receipt and then seeing the number go up is one action from the user's side, and splitting it
 * across two screens would make the confirmation a navigation. It is also what makes the
 * refresh below matter — the table is invalidated the moment a movement is recorded, because a
 * screen showing a total that does not include what you just booked in is a screen nobody
 * trusts again.
 *
 * The empty states are the part worth reading, and there are three of them because a fresh
 * account genuinely has three different problems in order. Nothing in this system is seeded, so
 * a new company has no locations and no products, and a form whose dropdowns are empty is a
 * form whose only possible outcome is a message. Rather than offering one, the screen says
 * which thing is missing and points at the screen that fixes it — which is the redirection
 * ticket 08's locations screen was written to receive.
 */
export function StockPage() {
  const { session } = useSession();
  const canRecord = hasPermission(session, 'inventory:movements:write');
  const [query, setQuery] = useState<ListQuery>({});
  const queryClient = useQueryClient();

  const stock = useQuery({
    // The query string *is* the cache key: two different requests are two different answers,
    // and the shared builder sorts its parameters so one request is always one key.
    queryKey: ['stock', 'list', listQueryString(query)],
    queryFn: () => api.get<StockListResponse>(listPath(STOCK_PATHS.stock, query)),
  });

  /**
   * Everything this company has, for the filters — and, narrowed below, for the forms.
   *
   * Fetched whole and unfiltered, then split in memory, because the two uses want different
   * subsets of the same data and a second request for the second subset would be a second
   * thing to keep in step. Neither is gated on being allowed to record: somebody who may only
   * *read* stock still has to be able to filter it, and a dropdown with no options in it is a
   * filter that silently does not work.
   */
  const products = useQuery({
    queryKey: ['products', 'all-for-stock'],
    queryFn: () =>
      api.get<ProductListResponse>(listPath(PRODUCT_PATHS.products, { pageSize: 100 })),
  });

  const locations = useQuery({
    queryKey: ['locations', 'all-for-stock'],
    queryFn: () =>
      api.get<LocationListResponse>(listPath(LOCATION_PATHS.locations, { pageSize: 100 })),
  });

  const failure = stock.error instanceof ApiFailure ? stock.error : undefined;
  const allProducts = products.data?.items ?? [];
  const allLocations = locations.data?.items ?? [];

  /**
   * What the forms may actually offer.
   *
   * Narrowed to what the server would accept — active locations, and products that are both
   * active and stocked — because a dropdown offering a choice the endpoint refuses is a form
   * whose only possible outcome is an error message. The filters above are deliberately *not*
   * narrowed this way: you cannot record a movement into a closed location, but you very much
   * can need to see what is still sitting in one.
   */
  const movable = allProducts.filter(
    (product) => product.status === 'active' && product.stockable,
  );
  const usable = allLocations.filter((location) => location.status === 'active');

  function refresh() {
    // Both, because a movement changes both — the levels on this screen and the ledger the
    // movements screen shows.
    void queryClient.invalidateQueries({ queryKey: ['stock'] });
    void queryClient.invalidateQueries({ queryKey: ['movements'] });
  }

  const columns = useMemo<Array<ColumnDef<StockLevelSummary, unknown>>>(
    () => [
      {
        // The id is the field name the server sorts by, taken from the shared contract so a
        // rename breaks the build rather than the sort.
        id: STOCK_FIELDS.productId,
        header: 'Product',
        cell: ({ row }) => (
          <span className="font-medium text-slate-900">
            {row.original.productCode} — {row.original.productName}
          </span>
        ),
      },
      {
        id: STOCK_FIELDS.locationId,
        header: 'Location',
        cell: ({ row }) => `${row.original.locationCode} — ${row.original.locationName}`,
      },
      {
        id: STOCK_FIELDS.quantity,
        header: 'Held',
        cell: ({ row }) => (
          <span className="flex items-baseline gap-1">
            <QuantityText value={row.original.quantity} />
            <span className="text-slate-500">{row.original.unitCode}</span>
          </span>
        ),
      },
    ],
    [],
  );

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-slate-900">Stock</h1>
        <p className="text-sm text-slate-600">
          What this company holds, and where. Every figure here is the running total of the{' '}
          <a {...linkProps('/movements')} className="font-medium text-slate-900 underline">
            movements
          </a>{' '}
          recorded against it.
        </p>
      </header>

      {canRecord && (products.isError || locations.isError) && (
        <Missing>
          The products and locations a movement has to name could not be loaded, so the recording
          forms are not shown — offering dropdowns that are empty for a reason nobody has been
          told would be worse than saying so.{' '}
          <button
            type="button"
            onClick={() => {
              void products.refetch();
              void locations.refetch();
            }}
            className="font-medium text-slate-900 underline"
          >
            Try again
          </button>
          .
        </Missing>
      )}

      {canRecord && products.isSuccess && locations.isSuccess && (
        <Recording products={movable} locations={usable} onRecorded={refresh} />
      )}

      <DataTable
        caption="Stock levels"
        columns={columns}
        rows={stock.data?.items ?? []}
        rowId={(level) => `${level.productId}:${level.locationId}`}
        page={stock.data?.page ?? emptyPage()}
        query={query}
        onQueryChange={setQuery}
        status={stock.isPending ? 'loading' : stock.isError ? 'error' : 'ready'}
        error={failure?.message}
        onRetry={() => void stock.refetch()}
        filters={
          <>
            <Select
              id="stock-product"
              label="Product"
              value={query.filters?.[STOCK_FIELDS.productId] ?? ''}
              placeholder="Any product"
              options={allProducts.map((product) => ({
                value: product.id,
                label: `${product.code} — ${product.name}`,
              }))}
              onChange={(productId) =>
                setQuery(narrowed(query, STOCK_FIELDS.productId, productId))
              }
            />
            <Select
              id="stock-location"
              label="Location"
              value={query.filters?.[STOCK_FIELDS.locationId] ?? ''}
              placeholder="Anywhere"
              options={allLocations.map((location) => ({
                value: location.id,
                label: `${location.code} — ${location.name}`,
              }))}
              onChange={(locationId) =>
                setQuery(narrowed(query, STOCK_FIELDS.locationId, locationId))
              }
            />
          </>
        }
        empty={
          <div className="flex flex-col gap-1">
            <p className="font-medium text-slate-900">Nothing held anywhere yet.</p>
            <p>
              Stock exists once you record that it arrived. Use the receipt form above; nothing
              is counted for you, so a shelf is empty until you say what went on it.
            </p>
          </div>
        }
      />
    </div>
  );
}

/**
 * The two forms, or the one thing standing in their way.
 *
 * The order of the checks is the order somebody actually hits them: you cannot record a
 * movement without somewhere to put things, and you cannot record one without something to put
 * there. Reporting both at once would be a screen listing chores; reporting the first one is a
 * screen with a next step.
 *
 * Nothing is shown at all until both lists have loaded, because "no locations yet" and "we have
 * not asked yet" look identical from an empty array — and telling a company with four
 * warehouses to go and create one is worse than showing them nothing for a moment.
 */
function Recording({
  products,
  locations,
  onRecorded,
}: {
  products: ProductListResponse['items'];
  locations: LocationListResponse['items'];
  onRecorded: () => void;
}) {
  if (locations.length === 0) {
    return (
      <Missing>
        Stock has to be somewhere before it can move, and this company has nowhere yet. Add a
        warehouse, a van or a bay on the{' '}
        <a {...linkProps('/locations')} className="font-medium text-slate-900 underline">
          Locations
        </a>{' '}
        screen — nothing here is set up for you, so a warehouse exists once you say it does.
      </Missing>
    );
  }

  if (products.length === 0) {
    return (
      <Missing>
        Stock is stock of something, and this company has nothing stocked yet. Add one on the{' '}
        <a {...linkProps('/products')} className="font-medium text-slate-900 underline">
          Products
        </a>{' '}
        screen — and check that “stock of this is counted” is on, since a delivery charge is a
        product with a price and no shelf.
      </Missing>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <RecordMovement
        kind="receipt"
        products={products}
        locations={locations}
        onRecorded={onRecorded}
      />
      <RecordMovement
        kind="issue"
        products={products}
        locations={locations}
        onRecorded={onRecorded}
      />
      <RecordAdjustment
        products={products}
        locations={locations}
        onRecorded={onRecorded}
      />
      <RecordTransfer
        products={products}
        locations={locations}
        onRecorded={onRecorded}
      />
    </div>
  );
}

function Missing({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-md border border-slate-200 bg-white p-4 text-sm text-slate-700">
      {children}
    </p>
  );
}
