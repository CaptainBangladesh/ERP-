import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ERROR_CODES,
  LOCATION_PATHS,
  type LocationResponse,
  type UpdateLocationRequest,
} from '@erp/shared';
import { Field, FormError } from '@erp/shared/ui';
import { ApiFailure, api } from '../../../api/client';

/**
 * One location, and everything that can be done to it.
 *
 * A panel rather than a page of its own because everything here is an edit to a row visible in
 * the list behind it, and each of those changes what the list says. Navigating away and back
 * would make every one of them a round trip through a page the user did not want to leave. It
 * is the same shape `ProductDetail` takes, deliberately: two screens that behave differently
 * for no reason are two screens somebody has to learn.
 *
 * Every action answers with the whole location, so the panel never patches its own copy from
 * what it *thinks* happened: it renders what the server said. That matters most for the one
 * action that can be refused — deactivating somewhere that still holds stock — where the
 * difference between "asked" and "happened" is the whole message.
 */
export function LocationDetail({
  locationId,
  onClose,
  onChanged,
}: {
  locationId: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const queryClient = useQueryClient();

  const location = useQuery({
    queryKey: ['locations', 'detail', locationId],
    queryFn: () => api.get<LocationResponse>(LOCATION_PATHS.location(locationId)),
  });

  /**
   * Both actions on this panel, sharing one pending state and one error.
   *
   * They are the same kind of thing from the user's point of view — a change to this location,
   * which answers with this location — so giving each its own mutation would mean two copies of
   * the same success handler and two places for one of them to forget to refresh.
   */
  const change = useMutation({
    mutationFn: (update: UpdateLocationRequest) =>
      api.patch<LocationResponse>(LOCATION_PATHS.location(locationId), update),
    onSuccess: (updated) => {
      queryClient.setQueryData(['locations', 'detail', locationId], updated);
      onChanged();
    },
  });

  const failure = change.error instanceof ApiFailure ? change.error : undefined;
  const fields = failure?.fields ?? {};
  const detail = location.data;

  if (location.isPending) {
    return (
      <section className="rounded-md border border-slate-200 bg-white p-4">
        <p role="status" className="text-sm text-slate-500">
          Loading location…
        </p>
      </section>
    );
  }

  if (!detail) {
    return (
      <section className="rounded-md border border-slate-200 bg-white p-4">
        <p role="alert" className="text-sm text-red-700">
          {location.error instanceof ApiFailure
            ? location.error.message
            : 'That location could not be loaded.'}
        </p>
      </section>
    );
  }

  const active = detail.status === 'active';

  return (
    <section
      aria-labelledby="location-detail"
      className="flex flex-col gap-6 rounded-md border border-slate-200 bg-white p-4"
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 id="location-detail" className="text-lg font-semibold text-slate-900">
            {detail.name}
          </h2>
          <p className="text-sm text-slate-600">
            {detail.code} · {active ? 'in use' : 'not in use'}
          </p>
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            disabled={change.isPending}
            onClick={() => change.mutate({ status: active ? 'inactive' : 'active' })}
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

      {/*
        A refusal in words rather than a status that silently did not change. Deactivating
        somewhere that still holds stock is the failure this panel exists to explain: the server
        says how much is in the way and what to do about it, and dropping that message would
        leave a button that appears not to work.
      */}
      {failure && failure.code !== ERROR_CODES.validationFailed && (
        <FormError>{failure.message}</FormError>
      )}

      <Details
        location={detail}
        fields={fields}
        pending={change.isPending}
        onSave={(update) => change.mutateAsync(update)}
      />
    </section>
  );
}

/**
 * Code and name — the two things somebody gets wrong when typing a location in for the first
 * time.
 *
 * Editable, and that is not a nicety. A location is never deleted here, so a mistyped code is a
 * record that has to be corrected rather than replaced; without this the only remedy for a
 * missing letter would be a second location and a deactivation.
 *
 * Behind a button, because reading a location is the common case and editing it is not: a panel
 * that opened with two filled boxes would look like a form somebody had left half-finished.
 */
function Details({
  location,
  fields,
  pending,
  onSave,
}: {
  location: LocationResponse;
  fields: Record<string, string>;
  pending: boolean;
  /** Resolves when the server accepted it, and rejects when it did not. */
  onSave: (update: UpdateLocationRequest) => Promise<unknown>;
}) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(() => ({ code: location.code, name: location.name }));

  if (!editing) {
    return (
      <div>
        <button
          type="button"
          onClick={() => {
            // Reset from the location rather than from whatever was typed and abandoned last
            // time, so opening the form twice does not offer a stale draft as the truth.
            setForm({ code: location.code, name: location.name });
            setEditing(true);
          }}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-900 hover:bg-slate-50"
        >
          Edit details
        </button>
      </div>
    );
  }

  return (
    <form
      noValidate
      aria-labelledby="edit-location"
      className="flex flex-col gap-4 rounded-md border border-slate-200 p-3"
      onSubmit={async (event) => {
        event.preventDefault();

        // Closed only once the server has accepted it. Closing on submit would take the boxes
        // away before the answer arrived, so a refused code would have nowhere to put its
        // message and would throw away what the user typed — which is the moment they most
        // need to see it again.
        try {
          await onSave({ code: form.code, name: form.name });
          setEditing(false);
        } catch {
          // Left open, with the message beside the box it belongs to. The refusal itself is
          // rendered from the mutation's error above.
        }
      }}
    >
      <h3 id="edit-location" className="text-sm font-medium text-slate-900">
        Details
      </h3>

      <div className="flex flex-wrap gap-4">
        <div className="min-w-48 flex-1">
          <Field
            id="detail-location-code"
            label="Code"
            value={form.code}
            error={fields.code}
            onChange={(code) => setForm((current) => ({ ...current, code }))}
          />
        </div>
        <div className="min-w-48 flex-1">
          <Field
            id="detail-location-name"
            label="Name"
            value={form.name}
            error={fields.name}
            onChange={(name) => setForm((current) => ({ ...current, name }))}
          />
        </div>
      </div>

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
