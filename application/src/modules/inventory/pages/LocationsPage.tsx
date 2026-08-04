import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import {
  ERROR_CODES,
  LOCATION_FIELDS,
  LOCATION_PATHS,
  LOCATION_STATUSES,
  emptyPage,
  listPath,
  listQueryString,
  narrowed,
  type CreateLocationRequest,
  type ListQuery,
  type LocationListResponse,
  type LocationResponse,
  type LocationStatus,
  type LocationSummary,
} from '@erp/shared';
import { DataTable, Field, FormError, Select } from '@erp/shared/ui';
import { ApiFailure, api } from '../../../api/client';
import { useSession } from '../../../session/SessionProvider';
import { hasPermission } from '../../../session/permissions';
import { LocationDetail } from '../components/LocationDetail';

/**
 * Where this company keeps things.
 *
 * Everything about paging, sorting, filtering and searching is the platform's: this holds a
 * `ListQuery` in state, hands it to the shared table, and builds the URL with the shared
 * helper. What the screen contributes is the columns, one filter that is a question about its
 * own field, and the panel that opens when a location is chosen.
 *
 * The empty state is the part worth reading. Nothing in this system is seeded, so the first
 * thing every real user sees here is nothing at all — and this is the screen the movement
 * screen will send somebody to when there is nowhere to record a movement into. So it says what
 * a location is rather than merely reporting that there are none, with the form that fixes it
 * directly above.
 */
export function LocationsPage() {
  const { session } = useSession();
  const canAddLocation = hasPermission(session, 'inventory:locations:write');
  const [query, setQuery] = useState<ListQuery>({});
  const [selectedId, setSelectedId] = useState<string>();
  const queryClient = useQueryClient();

  const locations = useQuery({
    // The query string *is* the cache key: two different requests are two different answers,
    // and the shared builder sorts its parameters so one request is always one key.
    queryKey: ['locations', 'list', listQueryString(query)],
    queryFn: () => api.get<LocationListResponse>(listPath(LOCATION_PATHS.locations, query)),
  });

  const failure = locations.error instanceof ApiFailure ? locations.error : undefined;

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: ['locations'] });
  }

  const columns = useMemo<Array<ColumnDef<LocationSummary, unknown>>>(
    () => [
      {
        // The id is the field name the server sorts by, taken from the shared contract so a
        // rename breaks the build rather than the sort.
        id: LOCATION_FIELDS.code,
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
      { id: LOCATION_FIELDS.name, header: 'Name', cell: ({ row }) => row.original.name },
      {
        id: LOCATION_FIELDS.status,
        header: 'Status',
        cell: ({ row }) => STATUS_LABELS[row.original.status],
      },
    ],
    [],
  );

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-slate-900">Locations</h1>
        <p className="text-sm text-slate-600">Everywhere this company keeps stock.</p>
      </header>

      {canAddLocation && (
        <AddLocation
          onAdded={(location) => {
            // The list is stale the moment a location is added, and a screen showing a list
            // that does not contain what you just created is a screen nobody trusts again.
            refresh();
            setQuery({});
            setSelectedId(location.id);
          }}
        />
      )}

      {selectedId && (
        <LocationDetail
          locationId={selectedId}
          onClose={() => setSelectedId(undefined)}
          onChanged={refresh}
        />
      )}

      <DataTable
        caption="Locations"
        columns={columns}
        rows={locations.data?.items ?? []}
        rowId={(location) => location.id}
        page={locations.data?.page ?? emptyPage()}
        query={query}
        onQueryChange={setQuery}
        status={locations.isPending ? 'loading' : locations.isError ? 'error' : 'ready'}
        error={failure?.message}
        onRetry={() => void locations.refetch()}
        searchLabel="Search by code or name"
        filters={
          <Select
            id="location-status"
            label="Status"
            value={query.filters?.[LOCATION_FIELDS.status] ?? ''}
            placeholder="Any status"
            options={LOCATION_STATUSES.map((status) => ({
              value: status,
              label: STATUS_LABELS[status],
            }))}
            onChange={(status) => setQuery(narrowed(query, LOCATION_FIELDS.status, status))}
          />
        }
        empty={
          <div className="flex flex-col gap-1">
            <p className="font-medium text-slate-900">Nowhere to keep anything yet.</p>
            <p>
              A location is a place stock sits — a warehouse, a van, a bay. Add your first one
              using the form above; nothing is set up for you, so a warehouse exists once you say
              it does.
            </p>
          </div>
        }
      />
    </div>
  );
}

const STATUS_LABELS = {
  active: 'In use',
  inactive: 'Not in use',
} as const satisfies Record<LocationStatus, string>;

/**
 * The form that adds somewhere.
 *
 * On the page rather than behind a button, because of the empty state it has to serve: a fresh
 * account has nothing in the list, and the thing the screen should guide somebody towards is
 * right there rather than one click away.
 */
function AddLocation({ onAdded }: { onAdded: (location: LocationResponse) => void }) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');

  const add = useMutation({
    mutationFn: () =>
      api.post<LocationResponse>(LOCATION_PATHS.locations, {
        code,
        name,
      } satisfies CreateLocationRequest),
    onSuccess: (location) => {
      setCode('');
      setName('');
      onAdded(location);
    },
  });

  const failure = add.error instanceof ApiFailure ? add.error : undefined;
  const fields = failure?.fields ?? {};

  return (
    <form
      noValidate
      aria-labelledby="add-location"
      className="flex flex-col gap-4 rounded-md border border-slate-200 bg-white p-4"
      onSubmit={(event) => {
        event.preventDefault();
        add.mutate();
      }}
    >
      <h2 id="add-location" className="text-sm font-medium text-slate-900">
        Add a location
      </h2>

      <div className="flex flex-wrap gap-4">
        <div className="min-w-48 flex-1">
          <Field
            id="location-code"
            label="Code"
            value={code}
            error={fields.code}
            hint="What you write on the label. Stored upper case."
            onChange={setCode}
          />
        </div>
        <div className="min-w-56 flex-1">
          <Field
            id="location-name"
            label="Name"
            value={name}
            error={fields.name}
            onChange={setName}
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
          {add.isPending ? 'Adding…' : 'Add location'}
        </button>
      </div>
    </form>
  );
}
