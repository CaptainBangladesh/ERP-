import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import {
  ERROR_CODES,
  PARTY_FIELDS,
  PARTY_PATHS,
  SETTABLE_PARTY_STATUSES,
  emptyPage,
  listPath,
  listQueryString,
  type ListQuery,
  type PartyKind,
  type CreatePartyRequest,
  type PartyListResponse,
  type PartyResponse,
  type PartyRolesResponse,
  type PartyStatus,
  type PartySummary,
} from '@erp/shared';
import { DataTable, Field, FormError } from '@erp/shared/ui';
import { ApiFailure, api } from '../../../api/client';
import { PartyDetail } from '../components/PartyDetail';

/**
 * The address book — the first screen in this system with real business data on it.
 *
 * Everything about paging, sorting, filtering and searching is the platform's: this holds a
 * `ListQuery` in state, hands it to the shared table, and builds the URL with the shared
 * helper. What it contributes is the two filter controls, which are questions about *these*
 * fields — a status is a short closed list, a role is whatever this company has used — and
 * the panel that opens when a party is chosen.
 *
 * The roles filter is worth a second look. Its options come from the server's answer to
 * "which roles are in use here?", not from a list in this file, which is the screen keeping
 * the same promise the module makes: a module that introduces a role changes nothing here.
 */
export function PartiesPage() {
  const [query, setQuery] = useState<ListQuery>({});
  const [selectedId, setSelectedId] = useState<string>();
  const queryClient = useQueryClient();

  const parties = useQuery({
    // The query string *is* the cache key: two different requests are two different answers,
    // and the shared builder sorts its parameters so one request is always one key.
    queryKey: ['parties', 'list', listQueryString(query)],
    queryFn: () => api.get<PartyListResponse>(listPath(PARTY_PATHS.parties, query)),
  });

  const roles = useQuery({
    queryKey: ['parties', 'roles'],
    queryFn: () => api.get<PartyRolesResponse>(PARTY_PATHS.roles),
  });

  /**
   * The organisations a person can be put in, and the parties a duplicate can be merged
   * into. One request, because they are the same question — "who else is in this book?" —
   * and the address book a screen can usefully offer as a dropdown is a small one.
   */
  const directory = useQuery({
    queryKey: ['parties', 'directory'],
    queryFn: () =>
      api.get<PartyListResponse>(
        listPath(PARTY_PATHS.parties, { pageSize: 100, sort: PARTY_FIELDS.name }),
      ),
  });

  const failure = parties.error instanceof ApiFailure ? parties.error : undefined;
  const everyone = directory.data?.items ?? [];

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: ['parties'] });
  }

  const columns = useMemo<Array<ColumnDef<PartySummary, unknown>>>(
    () => [
      {
        // The id is the field name the server sorts by, taken from the shared contract so a
        // rename breaks the build rather than the sort.
        id: PARTY_FIELDS.name,
        header: 'Name',
        cell: ({ row }) => (
          <button
            type="button"
            onClick={() => setSelectedId(row.original.id)}
            className="text-left font-medium text-slate-900 underline decoration-slate-300 underline-offset-2 hover:decoration-slate-900"
          >
            {row.original.name}
          </button>
        ),
      },
      {
        id: PARTY_FIELDS.kind,
        header: 'Type',
        cell: ({ row }) => (row.original.kind === 'person' ? 'Person' : 'Organisation'),
      },
      {
        id: PARTY_FIELDS.role,
        header: 'Roles',
        // The server has no single value to sort a party by when it holds three roles, and
        // the platform refuses the sort rather than picking one. The column says so by not
        // offering it.
        enableSorting: false,
        cell: ({ row }) =>
          row.original.roles.length === 0 ? '—' : row.original.roles.join(', '),
      },
      {
        id: PARTY_FIELDS.status,
        header: 'Status',
        cell: ({ row }) => STATUS_LABELS[row.original.status],
      },
    ],
    [],
  );

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-slate-900">Parties</h1>
        <p className="text-sm text-slate-600">
          Everybody this company deals with, in one place. The same record can be a customer,
          a supplier and an employee contact at once.
        </p>
      </header>

      <AddParty
        organisations={everyone.filter((party) => party.kind === 'organisation')}
        onAdded={(party) => {
          // The list is stale the moment a party is added, and a screen showing a list that
          // does not contain what you just created is a screen nobody trusts again.
          refresh();
          setQuery({});
          setSelectedId(party.id);
        }}
      />

      {selectedId && (
        <PartyDetail
          partyId={selectedId}
          knownRoles={roles.data?.roles ?? []}
          candidates={everyone}
          onClose={() => setSelectedId(undefined)}
          onChanged={refresh}
        />
      )}

      <DataTable
        caption="Parties"
        columns={columns}
        rows={parties.data?.items ?? []}
        rowId={(party) => party.id}
        page={parties.data?.page ?? emptyPage()}
        query={query}
        onQueryChange={setQuery}
        status={parties.isPending ? 'loading' : parties.isError ? 'error' : 'ready'}
        error={failure?.message}
        onRetry={() => void parties.refetch()}
        searchLabel="Search by name or email"
        filters={
          <>
            <Choice
              id="party-status"
              label="Status"
              value={query.filters?.[PARTY_FIELDS.status] ?? ''}
              anything="Any status"
              options={SETTABLE_PARTY_STATUSES.map((status) => ({
                value: status,
                label: STATUS_LABELS[status],
              }))}
              onChange={(status) => setQuery(narrowed(query, PARTY_FIELDS.status, status))}
            />
            <Choice
              id="party-role"
              label="Role"
              value={query.filters?.[PARTY_FIELDS.role] ?? ''}
              anything="Any role"
              options={(roles.data?.roles ?? []).map((role) => ({ value: role, label: role }))}
              onChange={(role) => setQuery(narrowed(query, PARTY_FIELDS.role, role))}
            />
          </>
        }
        empty={
          <div className="flex flex-col gap-1">
            <p className="font-medium text-slate-900">Nobody in the address book yet.</p>
            <p>Add your first party using the form above.</p>
          </div>
        }
      />
    </div>
  );
}

const STATUS_LABELS = {
  active: 'Active',
  inactive: 'Inactive',
  merged: 'Merged',
} as const satisfies Record<PartyStatus, string>;

/**
 * The query with one filter set, or gone.
 *
 * Cleared means gone rather than blank: an empty filter still in the object would count as
 * "narrowed" and show "nothing matches" to somebody who had filtered nothing. Paging goes
 * back to the first page, because page four of the old list is not page four of the new one.
 */
function narrowed(query: ListQuery, field: string, value: string): ListQuery {
  const filters = { ...query.filters };
  if (value) filters[field] = value;
  else delete filters[field];

  return { ...query, filters, page: 1 };
}

/**
 * A dropdown filter, and the screen's whole contribution to filtering alongside the search
 * box the table already provides.
 *
 * The table takes filter controls as a slot rather than generating them, because what a
 * filter should look like is a question about the field — a select here, a date picker in
 * hrm, a location tree in inventory — and a table answering it for forty modules would answer
 * it badly for most of them.
 */
function Choice({
  id,
  label,
  value,
  anything,
  options,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  anything: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-slate-900">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-slate-900/20"
      >
        <option value="">{anything}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

/**
 * The form that puts somebody in the book.
 *
 * On the page rather than behind a button, because of the empty state it has to serve: a
 * fresh account has nothing in the list, and the thing the screen should be guiding somebody
 * towards is right there rather than one click away. Nothing in this system is seeded, so an
 * empty database is the first thing every user sees.
 *
 * Roles are not on this form. Giving somebody a role is a thing you do to a party that
 * exists, and asking for it up front would make the first question about a new customer
 * "what is it to you?" rather than "who is it?".
 */
function AddParty({
  organisations,
  onAdded,
}: {
  organisations: PartySummary[];
  onAdded: (party: PartyResponse) => void;
}) {
  const [kind, setKind] = useState<PartyKind>('person');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [organisationId, setOrganisationId] = useState('');

  const add = useMutation({
    mutationFn: () =>
      api.post<PartyResponse>(PARTY_PATHS.parties, {
        kind,
        name,
        // Empty is absent rather than blank: an empty string is a value the rule would refuse,
        // and "I did not fill this in" is not the same as "this is empty".
        ...(email ? { email } : {}),
        ...(kind === 'person' && organisationId ? { organisationId } : {}),
      } satisfies CreatePartyRequest),
    onSuccess: (party) => {
      setName('');
      setEmail('');
      setOrganisationId('');
      onAdded(party);
    },
  });

  const failure = add.error instanceof ApiFailure ? add.error : undefined;
  const fields = failure?.fields ?? {};

  return (
    <form
      noValidate
      aria-labelledby="add-party"
      className="flex flex-col gap-4 rounded-md border border-slate-200 bg-white p-4"
      onSubmit={(event) => {
        event.preventDefault();
        add.mutate();
      }}
    >
      <h2 id="add-party" className="text-sm font-medium text-slate-900">
        Add a party
      </h2>

      <fieldset className="flex flex-wrap gap-4">
        <legend className="text-sm font-medium text-slate-900">Is this a</legend>
        {(['person', 'organisation'] as const).map((option) => (
          <label key={option} className="flex items-center gap-2 text-sm text-slate-900">
            <input
              type="radio"
              name="party-kind"
              value={option}
              checked={kind === option}
              onChange={() => setKind(option)}
            />
            {option === 'person' ? 'Person' : 'Organisation'}
          </label>
        ))}
      </fieldset>

      <div className="flex flex-wrap gap-4">
        <div className="min-w-56 flex-1">
          <Field id="party-name" label="Name" value={name} error={fields.name} onChange={setName} />
        </div>
        <div className="min-w-56 flex-1">
          <Field
            id="party-email"
            label="Email"
            type="email"
            value={email}
            error={fields.email}
            onChange={setEmail}
          />
        </div>

        {/* Only a person belongs to an organisation, so the control is only there for one. */}
        {kind === 'person' && organisations.length > 0 && (
          <div className="min-w-56 flex-1">
            <Choice
              id="party-organisation"
              label="Belongs to"
              value={organisationId}
              anything="Nobody in particular"
              options={organisations.map((organisation) => ({
                value: organisation.id,
                label: organisation.name,
              }))}
              onChange={setOrganisationId}
            />
          </div>
        )}
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
          {add.isPending ? 'Adding…' : 'Add party'}
        </button>
      </div>
    </form>
  );
}
