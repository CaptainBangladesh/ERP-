import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  ERROR_CODES,
  MOVEMENT_PATHS,
  type LocationSummary,
  type MovementKind,
  type MovementResponse,
  type ProductSummary,
  type RecordAdjustmentRequest,
  type RecordIssueRequest,
  type RecordReceiptRequest,
  type RecordTransferRequest,
  type TransferResponse,
} from '@erp/shared';
import { Field, FormError, QuantityInput, Select } from '@erp/shared/ui';
import { ApiFailure, api } from '../../../api/client';

/**
 * Recording that something arrived, or that something left.
 *
 * One component for both, because the two forms ask the same three questions — what, where, how
 * much — and the difference between them is which endpoint the answers go to. Writing them
 * separately would be two copies of the same field-error handling, and the second copy is the
 * one that stops clearing the box on success.
 *
 * What it deliberately does *not* do is let somebody type a negative quantity to mean the
 * opposite movement. The server refuses one, and the reason is worth having on both sides: the
 * sign is what makes every stock figure right, and it belongs to the act the person chose
 * rather than to a character they typed.
 *
 * Everything about the form is a question with an answer already on screen: products and
 * locations arrive as lists the parent already had to fetch, so choosing is a dropdown rather
 * than an identifier somebody has to know.
 */
export function RecordMovement({
  kind,
  products,
  locations,
  onRecorded,
}: {
  kind: Extract<MovementKind, 'receipt' | 'issue'>;
  /** Only what can actually be moved — the parent filters, so this cannot offer a refusal. */
  products: ProductSummary[];
  locations: LocationSummary[];
  onRecorded: () => void;
}) {
  const [productId, setProductId] = useState('');
  const [locationId, setLocationId] = useState('');
  const [quantity, setQuantity] = useState('');

  const words = WORDS[kind];

  const record = useMutation({
    mutationFn: () => {
      // The two requests are field-identical and are still two named types, because they are
      // two endpoints in the contract — the union is what says "whichever of them this is",
      // rather than one of them standing in for both.
      const body: RecordReceiptRequest | RecordIssueRequest = { productId, locationId, quantity };

      return api.post<MovementResponse>(
        kind === 'receipt' ? MOVEMENT_PATHS.receipts : MOVEMENT_PATHS.issues,
        body,
      );
    },
    onSuccess: () => {
      // The quantity is cleared and the choices are kept. Somebody booking in a delivery
      // records six things into one place one after another, and re-choosing the warehouse
      // every time would be the form fighting the job.
      setQuantity('');
      onRecorded();
    },
  });

  const failure = record.error instanceof ApiFailure ? record.error : undefined;
  const fields = failure?.fields ?? {};

  const chosen = products.find((product) => product.id === productId);

  return (
    <form
      noValidate
      aria-labelledby={`record-${kind}`}
      className="flex flex-col gap-4 rounded-md border border-slate-200 bg-white p-4"
      onSubmit={(event) => {
        event.preventDefault();
        record.mutate();
      }}
    >
      <div className="flex flex-col gap-1">
        <h2 id={`record-${kind}`} className="text-sm font-medium text-slate-900">
          {words.heading}
        </h2>
        <p className="text-sm text-slate-600">{words.explanation}</p>
      </div>

      <div className="flex flex-wrap gap-4">
        <div className="min-w-56 flex-1">
          <Select
            id={`${kind}-product`}
            label="Product"
            value={productId}
            placeholder="Choose a product…"
            error={fields.productId}
            options={products.map((product) => ({
              value: product.id,
              label: `${product.code} — ${product.name}`,
            }))}
            onChange={setProductId}
          />
        </div>
        <div className="min-w-56 flex-1">
          <Select
            id={`${kind}-location`}
            label={words.locationLabel}
            value={locationId}
            placeholder="Choose a location…"
            error={fields.locationId}
            options={locations.map((location) => ({
              value: location.id,
              label: `${location.code} — ${location.name}`,
            }))}
            onChange={setLocationId}
          />
        </div>
        <div className="min-w-40 flex-1">
          <QuantityInput
            id={`${kind}-quantity`}
            label="Quantity"
            value={quantity}
            error={fields.quantity}
            // The unit comes from the catalogue rather than from a box on this form: what
            // something is measured in is a fact about the product, and asking here would be
            // inviting two answers to one question.
            hint={chosen ? `Measured in ${chosen.unitCode}.` : undefined}
            onChange={setQuantity}
          />
        </div>
      </div>

      {/*
        A refusal in words — no stock at that location, a product that is not stocked, a
        location no longer in use. These are not field problems and have nowhere to sit beside
        an input, so they go here rather than being swallowed.
      */}
      {failure && failure.code !== ERROR_CODES.validationFailed && (
        <FormError>{failure.message}</FormError>
      )}

      <div>
        <button
          type="submit"
          disabled={record.isPending}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
        >
          {record.isPending ? `${words.pending}…` : words.submit}
        </button>
      </div>
    </form>
  );
}

/**
 * Recording a stock adjustment when a physical count disagrees with the system.
 */
export function RecordAdjustment({
  products,
  locations,
  onRecorded,
}: {
  products: ProductSummary[];
  locations: LocationSummary[];
  onRecorded: () => void;
}) {
  const [productId, setProductId] = useState('');
  const [locationId, setLocationId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [reason, setReason] = useState('');

  const record = useMutation({
    mutationFn: () => {
      const body: RecordAdjustmentRequest = { productId, locationId, quantity, reason };
      return api.post<MovementResponse>(MOVEMENT_PATHS.adjustments, body);
    },
    onSuccess: () => {
      setQuantity('');
      setReason('');
      onRecorded();
    },
  });

  const failure = record.error instanceof ApiFailure ? record.error : undefined;
  const fields = failure?.fields ?? {};

  const chosen = products.find((product) => product.id === productId);
  const hintText = chosen
    ? `Measured in ${chosen.unitCode}. Positive to raise, negative to lower.`
    : 'Positive to raise, negative to lower.';

  return (
    <form
      noValidate
      aria-labelledby="record-adjustment"
      className="flex flex-col gap-4 rounded-md border border-slate-200 bg-white p-4"
      onSubmit={(event) => {
        event.preventDefault();
        record.mutate();
      }}
    >
      <div className="flex flex-col gap-1">
        <h2 id="record-adjustment" className="text-sm font-medium text-slate-900">
          Record an adjustment
        </h2>
        <p className="text-sm text-slate-600">
          Physical count disagrees with the system. Explain discrepancy with a reason.
        </p>
      </div>

      <div className="flex flex-wrap gap-4">
        <div className="min-w-56 flex-1">
          <Select
            id="adjustment-product"
            label="Product"
            value={productId}
            placeholder="Choose a product…"
            error={fields.productId}
            options={products.map((product) => ({
              value: product.id,
              label: `${product.code} — ${product.name}`,
            }))}
            onChange={setProductId}
          />
        </div>
        <div className="min-w-56 flex-1">
          <Select
            id="adjustment-location"
            label="Location"
            value={locationId}
            placeholder="Choose a location…"
            error={fields.locationId}
            options={locations.map((location) => ({
              value: location.id,
              label: `${location.code} — ${location.name}`,
            }))}
            onChange={setLocationId}
          />
        </div>
        <div className="min-w-40 flex-1">
          <QuantityInput
            id="adjustment-quantity"
            label="Quantity (+ / -)"
            value={quantity}
            error={fields.quantity}
            hint={hintText}
            onChange={setQuantity}
          />
        </div>
      </div>

      <div>
        <Field
          id="adjustment-reason"
          label="Reason"
          value={reason}
          error={fields.reason}
          onChange={setReason}
        />
      </div>

      {failure && failure.code !== ERROR_CODES.validationFailed && (
        <FormError>{failure.message}</FormError>
      )}

      <div>
        <button
          type="submit"
          disabled={record.isPending}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
        >
          {record.isPending ? 'Recording…' : 'Record adjustment'}
        </button>
      </div>
    </form>
  );
}

/**
 * Transferring stock of a product from one location to another.
 */
export function RecordTransfer({
  products,
  locations,
  onRecorded,
}: {
  products: ProductSummary[];
  locations: LocationSummary[];
  onRecorded: () => void;
}) {
  const [productId, setProductId] = useState('');
  const [fromLocationId, setFromLocationId] = useState('');
  const [toLocationId, setToLocationId] = useState('');
  const [quantity, setQuantity] = useState('');

  const record = useMutation({
    mutationFn: () => {
      const body: RecordTransferRequest = { productId, fromLocationId, toLocationId, quantity };
      return api.post<TransferResponse>(MOVEMENT_PATHS.transfers, body);
    },
    onSuccess: () => {
      setQuantity('');
      onRecorded();
    },
  });

  const failure = record.error instanceof ApiFailure ? record.error : undefined;
  const fields = failure?.fields ?? {};

  const chosen = products.find((product) => product.id === productId);

  return (
    <form
      noValidate
      aria-labelledby="record-transfer"
      className="flex flex-col gap-4 rounded-md border border-slate-200 bg-white p-4"
      onSubmit={(event) => {
        event.preventDefault();
        record.mutate();
      }}
    >
      <div className="flex flex-col gap-1">
        <h2 id="record-transfer" className="text-sm font-medium text-slate-900">
          Record a transfer
        </h2>
        <p className="text-sm text-slate-600">
          Move stock between locations without changing total inventory held.
        </p>
      </div>

      <div className="flex flex-wrap gap-4">
        <div className="min-w-56 flex-1">
          <Select
            id="transfer-product"
            label="Product"
            value={productId}
            placeholder="Choose a product…"
            error={fields.productId}
            options={products.map((product) => ({
              value: product.id,
              label: `${product.code} — ${product.name}`,
            }))}
            onChange={setProductId}
          />
        </div>
        <div className="min-w-44 flex-1">
          <Select
            id="transfer-from-location"
            label="From"
            value={fromLocationId}
            placeholder="Origin location…"
            error={fields.fromLocationId}
            options={locations.map((location) => ({
              value: location.id,
              label: `${location.code} — ${location.name}`,
            }))}
            onChange={setFromLocationId}
          />
        </div>
        <div className="min-w-44 flex-1">
          <Select
            id="transfer-to-location"
            label="To"
            value={toLocationId}
            placeholder="Destination location…"
            error={fields.toLocationId}
            options={locations.map((location) => ({
              value: location.id,
              label: `${location.code} — ${location.name}`,
            }))}
            onChange={setToLocationId}
          />
        </div>
        <div className="min-w-40 flex-1">
          <QuantityInput
            id="transfer-quantity"
            label="Quantity"
            value={quantity}
            error={fields.quantity}
            hint={chosen ? `Measured in ${chosen.unitCode}.` : undefined}
            onChange={setQuantity}
          />
        </div>
      </div>

      {failure && failure.code !== ERROR_CODES.validationFailed && (
        <FormError>{failure.message}</FormError>
      )}

      <div>
        <button
          type="submit"
          disabled={record.isPending}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
        >
          {record.isPending ? 'Recording…' : 'Record transfer'}
        </button>
      </div>
    </form>
  );
}

/**
 * The two forms in the words of the job rather than of the schema.
 *
 * "Record a receipt" and "Record an issue" are what the ledger calls them and what a person
 * doing the job calls them; "create a movement with kind receipt" is what the table calls them,
 * and nobody unloading a van says that.
 */
const WORDS = {
  receipt: {
    heading: 'Record a receipt',
    explanation: 'Goods have arrived. This adds to what is held at the location you choose.',
    locationLabel: 'Into',
    submit: 'Record receipt',
    pending: 'Recording',
  },
  issue: {
    heading: 'Record an issue',
    explanation: 'Goods have left. This takes away from what is held at the location you choose.',
    locationLabel: 'Out of',
    submit: 'Record issue',
    pending: 'Recording',
  },
} as const satisfies Record<
  Extract<MovementKind, 'receipt' | 'issue'>,
  {
    heading: string;
    explanation: string;
    locationLabel: string;
    submit: string;
    pending: string;
  }
>;

