import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import {
  ERROR_CODES,
  PRODUCT_FIELDS,
  PRODUCT_PATHS,
  CATALOGUE_STATUSES,
  UNIT_PATHS,
  emptyPage,
  listPath,
  listQueryString,
  narrowed,
  type CreateProductRequest,
  type ListQuery,
  type ProductListResponse,
  type ProductResponse,
  type CatalogueStatus,
  type ProductSummary,
  type UnitListResponse,
  type UnitSummary,
} from '@erp/shared';
import { DataTable, Field, FormError, MoneyInput, MoneyText, Select } from '@erp/shared/ui';
import { ApiFailure, api } from '../../../api/client';
import { linkProps } from '../../../app/location';
import { useSession } from '../../../session/SessionProvider';
import { hasPermission } from '../../../session/permissions';
import { ProductDetail } from '../components/ProductDetail';

/**
 * The catalogue.
 *
 * Everything about paging, sorting, filtering and searching is the platform's: this holds a
 * `ListQuery` in state, hands it to the shared table, and builds the URL with the shared
 * helper. What it contributes is the columns, two filters that are questions about *these*
 * fields, and the panel that opens when a product is chosen.
 *
 * The empty state is the part worth reading. Nothing in this system is seeded, so a new
 * company has no units either — and a product cannot exist without one. Rather than offering a
 * form whose unit dropdown is empty and whose submit button can only fail, the screen says so
 * and points at the screen that fixes it.
 */
export function ProductsPage() {
  const { session } = useSession();
  const canAddProduct = hasPermission(session, 'products:products:write');
  const [query, setQuery] = useState<ListQuery>({});
  const [selectedId, setSelectedId] = useState<string>();
  const queryClient = useQueryClient();

  const products = useQuery({
    // The query string *is* the cache key: two different requests are two different answers,
    // and the shared builder sorts its parameters so one request is always one key.
    queryKey: ['products', 'list', listQueryString(query)],
    queryFn: () => api.get<ProductListResponse>(listPath(PRODUCT_PATHS.products, query)),
  });

  /**
   * The units a product can be measured in.
   *
   * Active ones only, because the server refuses the rest — a dropdown offering a choice the
   * endpoint will not accept is a form whose only outcome is a message.
   */
  const units = useQuery({
    queryKey: ['units', 'active'],
    queryFn: () =>
      api.get<UnitListResponse>(
        listPath(UNIT_PATHS.units, { pageSize: 100, filters: { status: 'active' } }),
      ),
  });

  const failure = products.error instanceof ApiFailure ? products.error : undefined;
  const usable = units.data?.items ?? [];

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: ['products'] });
  }

  const columns = useMemo<Array<ColumnDef<ProductSummary, unknown>>>(
    () => [
      {
        // The id is the field name the server sorts by, taken from the shared contract so a
        // rename breaks the build rather than the sort.
        id: PRODUCT_FIELDS.code,
        header: 'Code',
        cell: ({ row }) => (
          <button
            type="button"
            onClick={() => setSelectedId(row.original.id)}
            className="text-left font-medium text-slate-900 underline decoration-slate-300 underline-offset-2 hover:decoration-slate-900"
          >
            {row.original.code}
          </button>
        ),
      },
      { id: PRODUCT_FIELDS.name, header: 'Name', cell: ({ row }) => row.original.name },
      {
        id: PRODUCT_FIELDS.unitId,
        header: 'Unit',
        // A product has one unit, but the column holds an identifier rather than the text
        // shown, so there is nothing here the server could sort on that would mean what the
        // reader sees. The column says so by not offering it.
        enableSorting: false,
        cell: ({ row }) => row.original.unitCode,
      },
      {
        id: 'cost',
        header: 'Cost',
        enableSorting: false,
        cell: ({ row }) => <MoneyText value={row.original.cost} hidden="No cost recorded" />,
      },
      {
        id: PRODUCT_FIELDS.status,
        header: 'Status',
        cell: ({ row }) =>
          `${STATUS_LABELS[row.original.status]}${row.original.stockable ? '' : ' · not stocked'}`,
      },
    ],
    [],
  );

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-slate-900">Products</h1>
        <p className="text-sm text-slate-600">
          Everything this company deals in, with what it is measured in and what it costs.
        </p>
      </header>

      {canAddProduct &&
        (units.isSuccess && usable.length === 0 ? (
          <p className="rounded-md border border-slate-200 bg-white p-4 text-sm text-slate-700">
            Before you can add a product, say what you measure things in. Units are on the{' '}
            <a {...linkProps('/units')} className="font-medium text-slate-900 underline">
              Units
            </a>{' '}
            screen — nothing here is set up for you, so a kilogram exists once you say it does.
          </p>
        ) : (
          <AddProduct
            units={usable}
            onAdded={(product) => {
              // The list is stale the moment a product is added, and a screen showing a list
              // that does not contain what you just created is a screen nobody trusts again.
              refresh();
              setQuery({});
              setSelectedId(product.id);
            }}
          />
        ))}

      {selectedId && (
        <ProductDetail
          productId={selectedId}
          units={usable}
          onClose={() => setSelectedId(undefined)}
          onChanged={refresh}
        />
      )}

      <DataTable
        caption="Products"
        columns={columns}
        rows={products.data?.items ?? []}
        rowId={(product) => product.id}
        page={products.data?.page ?? emptyPage()}
        query={query}
        onQueryChange={setQuery}
        status={products.isPending ? 'loading' : products.isError ? 'error' : 'ready'}
        error={failure?.message}
        onRetry={() => void products.refetch()}
        searchLabel="Search by code or name"
        filters={
          <>
            <Select
              id="product-status"
              label="Status"
              value={query.filters?.[PRODUCT_FIELDS.status] ?? ''}
              placeholder="Any status"
              options={CATALOGUE_STATUSES.map((status) => ({
                value: status,
                label: STATUS_LABELS[status],
              }))}
              onChange={(status) => setQuery(narrowed(query, PRODUCT_FIELDS.status, status))}
            />
            <Select
              id="product-stockable"
              label="Stock"
              value={query.filters?.[PRODUCT_FIELDS.stockable] ?? ''}
              placeholder="Everything"
              options={[
                { value: 'true', label: 'Stock is counted' },
                { value: 'false', label: 'Not stocked' },
              ]}
              onChange={(stockable) =>
                setQuery(narrowed(query, PRODUCT_FIELDS.stockable, stockable))
              }
            />
          </>
        }
        empty={
          <div className="flex flex-col gap-1">
            <p className="font-medium text-slate-900">Nothing in the catalogue yet.</p>
            <p>Add your first product using the form above.</p>
          </div>
        }
      />
    </div>
  );
}

const STATUS_LABELS = {
  active: 'Active',
  inactive: 'Inactive',
} as const satisfies Record<CatalogueStatus, string>;


/**
 * The form that puts something in the catalogue.
 *
 * On the page rather than behind a button, because of the empty state it has to serve: a fresh
 * account has nothing in the list, and the thing the screen should guide somebody towards is
 * right there rather than one click away.
 *
 * Suppliers are not on this form. Recording who sells you something is a thing you do to a
 * product that exists, and asking up front would make the first question about a new product
 * "who do you buy it from?" rather than "what is it?".
 */
function AddProduct({
  units,
  onAdded,
}: {
  units: UnitSummary[];
  onAdded: (product: ProductResponse) => void;
}) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [unitId, setUnitId] = useState('');
  const [cost, setCost] = useState('');
  const [stockable, setStockable] = useState(true);

  const add = useMutation({
    mutationFn: () =>
      api.post<ProductResponse>(PRODUCT_PATHS.products, {
        code,
        name,
        unitId,
        // Empty is absent rather than blank: an empty string is a value the rule would refuse,
        // and "I have not priced this yet" is not the same as "it costs nothing".
        ...(cost ? { cost } : {}),
        ...(stockable ? {} : { stockable: false }),
      } satisfies CreateProductRequest),
    onSuccess: (product) => {
      setCode('');
      setName('');
      setCost('');
      setStockable(true);
      onAdded(product);
    },
  });

  const failure = add.error instanceof ApiFailure ? add.error : undefined;
  const fields = failure?.fields ?? {};

  return (
    <form
      noValidate
      aria-labelledby="add-product"
      className="flex flex-col gap-4 rounded-md border border-slate-200 bg-white p-4"
      onSubmit={(event) => {
        event.preventDefault();
        add.mutate();
      }}
    >
      <h2 id="add-product" className="text-sm font-medium text-slate-900">
        Add a product
      </h2>

      <div className="flex flex-wrap gap-4">
        <div className="min-w-48 flex-1">
          <Field
            id="product-code"
            label="Code"
            value={code}
            error={fields.code}
            hint="Your SKU. Stored upper case."
            onChange={setCode}
          />
        </div>
        <div className="min-w-56 flex-1">
          <Field id="product-name" label="Name" value={name} error={fields.name} onChange={setName} />
        </div>
        <div className="min-w-48 flex-1">
          <Select
            id="product-unit"
            label="Unit"
            value={unitId}
            placeholder="Choose a unit…"
            error={fields.unitId}
            options={units.map((unit) => ({ value: unit.id, label: `${unit.code} — ${unit.name}` }))}
            onChange={setUnitId}
          />
        </div>
        <div className="min-w-48 flex-1">
          <MoneyInput
            id="product-cost"
            label="Cost"
            value={cost}
            error={fields.cost}
            hint="What one of these costs you. Optional."
            onChange={setCost}
          />
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm text-slate-900">
        <input
          type="checkbox"
          checked={stockable}
          onChange={(event) => setStockable(event.target.checked)}
        />
        Stock of this is counted
      </label>

      {failure && failure.code !== ERROR_CODES.validationFailed && (
        <FormError>{failure.message}</FormError>
      )}

      <div>
        <button
          type="submit"
          disabled={add.isPending}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
        >
          {add.isPending ? 'Adding…' : 'Add product'}
        </button>
      </div>
    </form>
  );
}
