import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ERROR_CODES,
  PARTY_PATHS,
  PRODUCT_PATHS,
  listPath,
  type AddProductSupplierRequest,
  type PartyListResponse,
  type ProductResponse,
  type UnitSummary,
  type UpdateProductRequest,
} from '@erp/shared';
import { Field, FormError, MoneyInput, MoneyText, Select } from '@erp/shared/ui';
import { ApiFailure, api } from '../../../api/client';

/**
 * One product, and everything that can be done to it.
 *
 * A panel rather than a page of its own because everything here is an edit to a row visible in
 * the list behind it, and each of those changes what the list says. Navigating away and back
 * would make every one of them a round trip through a page the user did not want to leave.
 *
 * Every action answers with the whole product, so the panel never patches its own copy from
 * what it *thinks* happened: it renders what the server said.
 *
 * The supplier control reads from the address book's API — the parties module's wire contract,
 * not its screens. That is the one way frontend modules are allowed to know about each other,
 * and the right one: deleting the parties *screens* would not take this panel with it.
 */
export function ProductDetail({
  productId,
  units,
  onClose,
  onChanged,
}: {
  productId: string;
  /** The units a product may be measured in. Active ones, as the server will accept. */
  units: UnitSummary[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const queryClient = useQueryClient();

  const product = useQuery({
    queryKey: ['products', 'detail', productId],
    queryFn: () => api.get<ProductResponse>(PRODUCT_PATHS.product(productId)),
  });

  /**
   * Everybody in the address book, for the supplier control to offer.
   *
   * Everybody rather than only those already marked as suppliers, because products does not
   * give anybody that role — a role is what a party is to the business and the address book
   * owns it. Offering only existing suppliers would make the first supplier of anything
   * impossible to record here.
   */
  const parties = useQuery({
    queryKey: ['parties', 'directory'],
    queryFn: () =>
      api.get<PartyListResponse>(
        listPath(PARTY_PATHS.parties, { pageSize: 100, filters: { status: 'active' } }),
      ),
  });

  /**
   * Every action on this panel, sharing one pending state and one error.
   *
   * They are the same kind of thing from the user's point of view — a change to this product,
   * which answers with this product — so giving each its own mutation would mean four copies
   * of the same success handler and four places for one of them to forget to refresh.
   */
  const change = useMutation({
    mutationFn: (act: () => Promise<ProductResponse>) => act(),
    onSuccess: (updated) => {
      queryClient.setQueryData(['products', 'detail', productId], updated);
      onChanged();
    },
  });

  const failure = change.error instanceof ApiFailure ? change.error : undefined;
  const fields = failure?.fields ?? {};
  const detail = product.data;

  if (product.isPending) {
    return (
      <section className="rounded-md border border-slate-200 bg-white p-4">
        <p role="status" className="text-sm text-slate-500">
          Loading product…
        </p>
      </section>
    );
  }

  if (!detail) {
    return (
      <section className="rounded-md border border-slate-200 bg-white p-4">
        <p role="alert" className="text-sm text-red-700">
          {product.error instanceof ApiFailure
            ? product.error.message
            : 'That product could not be loaded.'}
        </p>
      </section>
    );
  }

  const active = detail.status === 'active';

  return (
    <section
      aria-labelledby="product-detail"
      className="flex flex-col gap-6 rounded-md border border-slate-200 bg-white p-4"
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 id="product-detail" className="text-lg font-semibold text-slate-900">
            {detail.name}
          </h2>
          <p className="text-sm text-slate-600">
            {detail.code} · measured in {detail.unitName} ({detail.unitCode})
            {detail.stockable ? '' : ' · stock not counted'}
          </p>
          <p className="text-sm text-slate-600">
            Cost: <MoneyText value={detail.cost} hidden="No cost recorded" />
          </p>
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            disabled={change.isPending}
            onClick={() =>
              change.mutate(() =>
                api.patch<ProductResponse>(PRODUCT_PATHS.product(productId), {
                  status: active ? 'inactive' : 'active',
                } satisfies UpdateProductRequest),
              )
            }
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-900 hover:bg-slate-50 disabled:opacity-50"
          >
            {active ? 'Deactivate' : 'Reactivate'}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-900 hover:bg-slate-50"
          >
            Close
          </button>
        </div>
      </header>

      {failure && failure.code !== ERROR_CODES.validationFailed && (
        <FormError>{failure.message}</FormError>
      )}

      <Details
        product={detail}
        units={units}
        fields={fields}
        pending={change.isPending}
        onSave={(update) =>
          change.mutate(() => api.patch<ProductResponse>(PRODUCT_PATHS.product(productId), update))
        }
      />

      <Suppliers
        suppliers={detail.suppliers}
        candidates={parties.data?.items ?? []}
        error={fields.partyId}
        pending={change.isPending}
        onAdd={(partyId) =>
          change.mutate(() =>
            api.post<ProductResponse>(PRODUCT_PATHS.suppliers(productId), {
              partyId,
            } satisfies AddProductSupplierRequest),
          )
        }
        onRemove={(partyId) =>
          change.mutate(() =>
            api.delete<ProductResponse>(PRODUCT_PATHS.supplier(productId, partyId)),
          )
        }
      />
    </section>
  );
}

/**
 * Code, name, unit and cost — the details somebody gets wrong when typing a product in for the
 * first time.
 *
 * Editable, and that is not a nicety. A product is never deleted here, so a mistyped SKU is a
 * record that has to be corrected rather than replaced; without this the only remedy would be
 * a second product and a deactivation, for a missing letter.
 *
 * Behind a button, because reading a product is the common case and editing it is not: a panel
 * that opened with four filled boxes would look like a form somebody had left half-finished.
 */
function Details({
  product,
  units,
  fields,
  pending,
  onSave,
}: {
  product: ProductResponse;
  units: UnitSummary[];
  fields: Record<string, string>;
  pending: boolean;
  onSave: (update: UpdateProductRequest) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(() => draftOf(product));

  if (!editing) {
    return (
      <div>
        <button
          type="button"
          onClick={() => {
            // Reset from the product rather than from whatever was typed and abandoned last
            // time, so opening the form twice does not offer a stale draft as the truth.
            setForm(draftOf(product));
            setEditing(true);
          }}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-900 hover:bg-slate-50"
        >
          Edit details
        </button>
      </div>
    );
  }

  const set = (key: keyof typeof form) => (value: string) =>
    setForm((current) => ({ ...current, [key]: value }));

  return (
    <form
      noValidate
      aria-labelledby="edit-product"
      className="flex flex-col gap-4 rounded-md border border-slate-200 p-3"
      onSubmit={(event) => {
        event.preventDefault();
        // Empty is left out rather than sent blank. The endpoint reads an absent field as "do
        // not touch it" and would refuse an empty one, so a product with no cost stays a
        // product with no cost instead of becoming a validation failure.
        onSave({
          code: form.code,
          name: form.name,
          unitId: form.unitId,
          stockable: form.stockable,
          ...(form.cost ? { cost: form.cost } : {}),
        });
        setEditing(false);
      }}
    >
      <h3 id="edit-product" className="text-sm font-medium text-slate-900">
        Details
      </h3>

      <div className="flex flex-wrap gap-4">
        <div className="min-w-48 flex-1">
          <Field id="detail-code" label="Code" value={form.code} error={fields.code} onChange={set('code')} />
        </div>
        <div className="min-w-48 flex-1">
          <Field id="detail-name" label="Name" value={form.name} error={fields.name} onChange={set('name')} />
        </div>
        <div className="min-w-48 flex-1">
          <Select
            id="detail-unit"
            label="Unit"
            value={form.unitId}
            error={fields.unitId}
            options={units.map((unit) => ({ value: unit.id, label: `${unit.code} — ${unit.name}` }))}
            onChange={set('unitId')}
          />
        </div>
        <div className="min-w-48 flex-1">
          <MoneyInput
            id="detail-cost"
            label="Cost"
            value={form.cost}
            error={fields.cost}
            onChange={set('cost')}
          />
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm text-slate-900">
        <input
          type="checkbox"
          checked={form.stockable}
          onChange={(event) =>
            setForm((current) => ({ ...current, stockable: event.target.checked }))
          }
        />
        Stock of this is counted
      </label>

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
        >
          Save details
        </button>
        <button
          type="button"
          onClick={() => setEditing(false)}
          className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-900 hover:bg-slate-50"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

/** The form's fields as text, which is what an input holds. */
function draftOf(product: ProductResponse) {
  return {
    code: product.code,
    name: product.name,
    unitId: product.unitId,
    // The canonical decimal text the money input expects, never a formatted string: a screen
    // handed '1,234.50' would have to take the comma back out before sending it.
    cost: product.cost?.amount ?? '',
    stockable: product.stockable,
  };
}

/**
 * Who this is bought from.
 *
 * The candidates are everybody in the address book. A party is not filtered to those already
 * holding the supplier role, because nothing here gives anybody that role — so filtering by it
 * would make the first supplier of anything unrecordable.
 */
function Suppliers({
  suppliers,
  candidates,
  error,
  pending,
  onAdd,
  onRemove,
}: {
  suppliers: ProductResponse['suppliers'];
  candidates: Array<{ id: string; name: string }>;
  error?: string;
  pending: boolean;
  onAdd: (partyId: string) => void;
  onRemove: (partyId: string) => void;
}) {
  const [partyId, setPartyId] = useState('');
  const linked = new Set(suppliers.map((supplier) => supplier.partyId));

  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-sm font-medium text-slate-900">Suppliers</h3>

      {suppliers.length === 0 ? (
        <p className="text-sm text-slate-600">
          Nobody recorded yet. A supplier is somebody from the address book.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {suppliers.map((supplier) => (
            <li
              key={supplier.partyId}
              className="flex items-center justify-between gap-3 rounded-md border border-slate-200 p-3 text-sm text-slate-700"
            >
              <span>
                <span className="font-medium text-slate-900">{supplier.name}</span>
                {supplier.email ? ` · ${supplier.email}` : ''}
              </span>
              <button
                type="button"
                disabled={pending}
                aria-label={`Remove supplier ${supplier.name}`}
                onClick={() => onRemove(supplier.partyId)}
                className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-900 hover:bg-slate-50 disabled:opacity-50"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      <form
        noValidate
        className="flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (!partyId) return;
          onAdd(partyId);
          setPartyId('');
        }}
      >
        <div className="min-w-56">
          <Select
            id="product-supplier"
            label="Add a supplier"
            value={partyId}
            placeholder="Choose from the address book…"
            error={error}
            options={candidates
              .filter((party) => !linked.has(party.id))
              .map((party) => ({ value: party.id, label: party.name }))}
            onChange={setPartyId}
          />
        </div>
        <button
          type="submit"
          disabled={pending || !partyId}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
        >
          Add supplier
        </button>
      </form>
    </div>
  );
}
