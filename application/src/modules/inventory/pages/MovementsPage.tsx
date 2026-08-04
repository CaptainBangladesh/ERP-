import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import {
  LOCATION_PATHS,
  MOVEMENT_FIELDS,
  MOVEMENT_KINDS,
  MOVEMENT_PATHS,
  PRODUCT_PATHS,
  emptyPage,
  listPath,
  listQueryString,
  narrowed,
  type ListQuery,
  type LocationListResponse,
  type MovementKind,
  type MovementListResponse,
  type MovementSummary,
  type ProductListResponse,
} from '@erp/shared';
import { DataTable, Field, MoneyText, QuantityText, Select } from '@erp/shared/ui';
import { ApiFailure, api } from '../../../api/client';
import { linkProps } from '../../../app/location';

/**
 * Everything that has ever happened to this company's stock.
 *
 * Read-only, and that is the screen's whole character rather than a limitation. There is no
 * edit button and no delete button anywhere here, because a movement is what happened: the
 * accounting entries eventually derived from these rows would have nothing to reconcile against
 * if a line could be quietly corrected afterwards. Ticket 11 adds a reverse action, which puts
 * a *new* line beside the old one — the original stays, visible, for ever.
 *
 * A separate screen from Stock rather than a panel on it, because the two answer different
 * questions for different people. A warehouse manager wants to know what is on the shelf; this
 * is what somebody reaches for when the shelf and the system disagree, and it is the screen an
 * auditor is shown.
 */
export function MovementsPage() {
  const [query, setQuery] = useState<ListQuery>({});

  const movements = useQuery({
    // The query string *is* the cache key: two different requests are two different answers,
    // and the shared builder sorts its parameters so one request is always one key.
    queryKey: ['movements', 'list', listQueryString(query)],
    queryFn: () => api.get<MovementListResponse>(listPath(MOVEMENT_PATHS.movements, query)),
  });

  /**
   * The filter dropdowns' options.
   *
   * Unfiltered by status, unlike the recording forms on the Stock screen, and the difference is
   * the point: you cannot record a movement into a closed location, but you very much can need
   * to read the history of one. A filter list that hid deactivated places would hide the rows
   * somebody is most likely looking for.
   */
  const products = useQuery({
    queryKey: ['products', 'all-for-filter'],
    queryFn: () =>
      api.get<ProductListResponse>(listPath(PRODUCT_PATHS.products, { pageSize: 100 })),
  });

  const locations = useQuery({
    queryKey: ['locations', 'all-for-filter'],
    queryFn: () =>
      api.get<LocationListResponse>(listPath(LOCATION_PATHS.locations, { pageSize: 100 })),
  });

  const failure = movements.error instanceof ApiFailure ? movements.error : undefined;

  const columns = useMemo<Array<ColumnDef<MovementSummary, unknown>>>(
    () => [
      {
        // The id is the field name the server sorts by, taken from the shared contract so a
        // rename breaks the build rather than the sort.
        id: MOVEMENT_FIELDS.recordedAt,
        header: 'When',
        cell: ({ row }) => <When at={row.original.recordedAt} />,
      },
      {
        id: MOVEMENT_FIELDS.kind,
        header: 'Type',
        cell: ({ row }) => KIND_LABELS[row.original.kind],
      },
      /**
       * Everything below is deliberately unsortable, and each has to say so.
       *
       * The shared table offers a sort on every column unless told otherwise, so a column the
       * endpoint does not sort by is a heading that looks clickable and answers 422. Product
       * and location are chosen from a dropdown and ordering a ledger by an opaque identifier
       * orders it by nothing a person can see; quantity, value and who recorded it are not
       * fields `MOVEMENT_LIST` offers at all. Filter by them instead — which is what the
       * controls above the table are for.
       */
      {
        id: MOVEMENT_FIELDS.productId,
        header: 'Product',
        enableSorting: false,
        cell: ({ row }) => (
          <span className="font-medium text-slate-900">
            {row.original.productCode} — {row.original.productName}
          </span>
        ),
      },
      {
        id: MOVEMENT_FIELDS.locationId,
        header: 'Location',
        enableSorting: false,
        cell: ({ row }) => `${row.original.locationCode} — ${row.original.locationName}`,
      },
      {
        id: 'quantity',
        header: 'Quantity',
        enableSorting: false,
        cell: ({ row }) => (
          <span
            className={`flex items-baseline gap-1 ${
              row.original.quantity.startsWith('-') ? 'text-slate-600' : 'text-slate-900'
            }`}
          >
            <QuantityText value={row.original.quantity} />
            {/* Frozen on the row rather than looked up: what a quantity was measured in is
                part of the measurement, and has to still read correctly in three years. */}
            <span className="text-slate-500">{row.original.unitCode}</span>
          </span>
        ),
      },
      {
        id: 'value',
        header: 'Value',
        enableSorting: false,
        // `MoneyText` renders a withheld or absent amount as a dash with an accessible name
        // rather than as an empty cell, which is what makes "nobody has said what this costs"
        // legible as something other than "it is worth nothing".
        cell: ({ row }) => <MoneyText value={row.original.value} hidden="No cost recorded" />,
      },
      {
        id: 'recordedByName',
        header: 'Recorded by',
        enableSorting: false,
        cell: ({ row }) => row.original.recordedByName,
      },
    ],
    [],
  );

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-slate-900">Movements</h1>
        <p className="text-sm text-slate-600">
          Every receipt and issue ever recorded, in order. Nothing here can be edited or removed
          — a mistake is corrected by recording another movement, which is what keeps{' '}
          <a {...linkProps('/stock')} className="font-medium text-slate-900 underline">
            stock
          </a>{' '}
          worth trusting.
        </p>
      </header>

      <DataTable
        caption="Stock movements"
        columns={columns}
        rows={movements.data?.items ?? []}
        rowId={(movement) => movement.id}
        page={movements.data?.page ?? emptyPage()}
        query={query}
        onQueryChange={setQuery}
        status={movements.isPending ? 'loading' : movements.isError ? 'error' : 'ready'}
        error={failure?.message}
        onRetry={() => void movements.refetch()}
        filters={
          <>
            <Select
              id="movement-kind"
              label="Type"
              value={query.filters?.[MOVEMENT_FIELDS.kind] ?? ''}
              placeholder="Any type"
              options={MOVEMENT_KINDS.map((kind) => ({ value: kind, label: KIND_LABELS[kind] }))}
              onChange={(kind) => setQuery(narrowed(query, MOVEMENT_FIELDS.kind, kind))}
            />
            <Select
              id="movement-product"
              label="Product"
              value={query.filters?.[MOVEMENT_FIELDS.productId] ?? ''}
              placeholder="Any product"
              options={(products.data?.items ?? []).map((product) => ({
                value: product.id,
                label: `${product.code} — ${product.name}`,
              }))}
              onChange={(productId) =>
                setQuery(narrowed(query, MOVEMENT_FIELDS.productId, productId))
              }
            />
            <Select
              id="movement-location"
              label="Location"
              value={query.filters?.[MOVEMENT_FIELDS.locationId] ?? ''}
              placeholder="Anywhere"
              options={(locations.data?.items ?? []).map((location) => ({
                value: location.id,
                label: `${location.code} — ${location.name}`,
              }))}
              onChange={(locationId) =>
                setQuery(narrowed(query, MOVEMENT_FIELDS.locationId, locationId))
              }
            />
            {/*
              A date box rather than a range, because one bound answers the question people
              actually ask of a ledger — "what has happened since the count?" — and the platform's
              filter convention gives it for free. The operator is part of the parameter name.
            */}
            <Field
              id="movement-since"
              label="Since"
              type="date"
              value={query.filters?.[SINCE] ?? ''}
              onChange={(since) => setQuery(narrowed(query, SINCE, since))}
            />
          </>
        }
        empty={
          <div className="flex flex-col gap-1">
            <p className="font-medium text-slate-900">Nothing has moved yet.</p>
            <p>
              Once you record a receipt or an issue on the{' '}
              <a {...linkProps('/stock')} className="font-medium text-slate-900 underline">
                Stock
              </a>{' '}
              screen, it appears here and stays for good.
            </p>
          </div>
        }
      />
    </div>
  );
}

const KIND_LABELS = {
  receipt: 'Received',
  issue: 'Issued',
} as const satisfies Record<MovementKind, string>;

/**
 * The "since" filter's parameter name — the field and the operator, as the platform's
 * convention writes it.
 *
 * A bare `YYYY-MM-DD` is read as UTC midnight by the list platform, which is exactly what the
 * date input produces, so the value goes straight through with no formatting on either side.
 */
const SINCE = `${MOVEMENT_FIELDS.recordedAt}.gte`;

/**
 * When something happened, to the minute.
 *
 * A `<time>` element with the full instant in `dateTime`, so the exact moment is available to
 * anything reading the markup while the cell stays short enough to sit in a table. Rendered in
 * the reader's own locale, because a movement's timestamp is one of the few things on screen
 * that a person compares against their own memory of the day.
 */
function When({ at }: { at: string }) {
  const moment = new Date(at);

  return (
    <time dateTime={at} className="whitespace-nowrap tabular-nums">
      {moment.toLocaleDateString()} {moment.toLocaleTimeString([], { timeStyle: 'short' })}
    </time>
  );
}
