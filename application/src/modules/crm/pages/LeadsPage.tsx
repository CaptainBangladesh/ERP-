import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import {
  ERROR_CODES,
  LEAD_FIELDS,
  LEAD_PATHS,
  LEAD_SOURCES,
  emptyPage,
  listPath,
  listQueryString,
  narrowed,
  type CreateLeadRequest,
  type LeadListResponse,
  type LeadResponse,
  type LeadSource,
  type LeadStatus,
  type LeadSummary,
  type ListQuery,
} from '@erp/shared';
import { DataTable, Field, FormError, Select } from '@erp/shared/ui';
import { ApiFailure, api } from '../../../api/client';
import { useSession } from '../../../session/SessionProvider';
import { hasPermission } from '../../../session/permissions';
import { LeadDetail } from '../components/LeadDetail';
import { LEAD_SOURCE_LABELS, LEAD_STATUS_LABELS } from '../labels';

/**
 * Leads — where a prospect lives before there is a `Party` to hold it.
 *
 * Everything about paging, sorting, filtering and searching is the platform's: this holds a
 * `ListQuery` in state, hands it to the shared table, and builds the URL with the shared
 * helper. What it contributes is the source filter, the form that records a new Lead, and the
 * panel that opens when one is chosen.
 */
export function LeadsPage() {
  const { session } = useSession();
  const canWrite = hasPermission(session, 'crm:leads:write');
  const [query, setQuery] = useState<ListQuery>({});
  const [selectedId, setSelectedId] = useState<string>();
  const queryClient = useQueryClient();

  const leads = useQuery({
    // The query string *is* the cache key: two different requests are two different answers,
    // and the shared builder sorts its parameters so one request is always one key.
    queryKey: ['crm', 'leads', 'list', listQueryString(query)],
    queryFn: () => api.get<LeadListResponse>(listPath(LEAD_PATHS.leads, query)),
  });

  const failure = leads.error instanceof ApiFailure ? leads.error : undefined;

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: ['crm', 'leads'] });
  }

  const columns = useMemo<Array<ColumnDef<LeadSummary, unknown>>>(
    () => [
      {
        // The id is the field name the server sorts by, taken from the shared contract so a
        // rename breaks the build rather than the sort.
        id: LEAD_FIELDS.name,
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
        id: LEAD_FIELDS.organisationName,
        header: 'Organisation',
        cell: ({ row }) => row.original.organisationName ?? '—',
      },
      {
        id: LEAD_FIELDS.source,
        header: 'Source',
        cell: ({ row }) => LEAD_SOURCE_LABELS[row.original.source],
      },
      {
        id: LEAD_FIELDS.status,
        header: 'Status',
        cell: ({ row }) => LEAD_STATUS_LABELS[row.original.status],
      },
    ],
    [],
  );

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-slate-900">Leads</h1>
        <p className="text-sm text-slate-600">
          Everybody who might become a customer, before there is an address-book record for
          them. Qualifying a lead turns it into a real party, without ever losing this history.
        </p>
      </header>

      {canWrite && (
        <AddLead
          onAdded={(lead) => {
            // The list is stale the moment a lead is added, and a screen showing a list that
            // does not contain what you just created is a screen nobody trusts again.
            refresh();
            setQuery({});
            setSelectedId(lead.id);
          }}
        />
      )}

      {selectedId && (
        <LeadDetail leadId={selectedId} onClose={() => setSelectedId(undefined)} onChanged={refresh} />
      )}

      <DataTable
        caption="Leads"
        columns={columns}
        rows={leads.data?.items ?? []}
        rowId={(lead) => lead.id}
        page={leads.data?.page ?? emptyPage()}
        query={query}
        onQueryChange={setQuery}
        status={leads.isPending ? 'loading' : leads.isError ? 'error' : 'ready'}
        error={failure?.message}
        onRetry={() => void leads.refetch()}
        searchLabel="Search by name, organisation or email"
        filters={
          <>
            <Select
              id="lead-source"
              label="Source"
              value={query.filters?.[LEAD_FIELDS.source] ?? ''}
              placeholder="Any source"
              options={LEAD_SOURCES.map((source) => ({ value: source, label: LEAD_SOURCE_LABELS[source] }))}
              onChange={(source) => setQuery(narrowed(query, LEAD_FIELDS.source, source))}
            />
            <Select
              id="lead-status"
              label="Status"
              value={query.filters?.[LEAD_FIELDS.status] ?? ''}
              placeholder="Any status"
              options={(Object.keys(LEAD_STATUS_LABELS) as LeadStatus[]).map((status) => ({
                value: status,
                label: LEAD_STATUS_LABELS[status],
              }))}
              onChange={(status) => setQuery(narrowed(query, LEAD_FIELDS.status, status))}
            />
          </>
        }
        empty={
          <div className="flex flex-col gap-1">
            <p className="font-medium text-slate-900">No leads yet.</p>
            <p>Record your first lead using the form above.</p>
          </div>
        }
      />
    </div>
  );
}

/**
 * The form that records a Lead.
 *
 * On the page rather than behind a button, because of the empty state it has to serve: a
 * fresh company has nothing in the list, and the thing the screen should be guiding somebody
 * towards is right there rather than one click away. Nothing in this system is seeded, so an
 * empty database is the first thing every user sees.
 */
function AddLead({ onAdded }: { onAdded: (lead: LeadResponse) => void }) {
  const [name, setName] = useState('');
  const [organisationName, setOrganisationName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [source, setSource] = useState<LeadSource>('referral');

  const add = useMutation({
    mutationFn: () =>
      api.post<LeadResponse>(LEAD_PATHS.leads, {
        name,
        source,
        // Empty is absent rather than blank: an empty string is a value the rule would refuse,
        // and "I did not fill this in" is not the same as "this is empty".
        ...(organisationName ? { organisationName } : {}),
        ...(email ? { email } : {}),
        ...(phone ? { phone } : {}),
      } satisfies CreateLeadRequest),
    onSuccess: (lead) => {
      setName('');
      setOrganisationName('');
      setEmail('');
      setPhone('');
      onAdded(lead);
    },
  });

  const failure = add.error instanceof ApiFailure ? add.error : undefined;
  const fields = failure?.fields ?? {};

  return (
    <form
      noValidate
      aria-labelledby="add-lead"
      className="flex flex-col gap-4 rounded-md border border-slate-200 bg-white p-4"
      onSubmit={(event) => {
        event.preventDefault();
        add.mutate();
      }}
    >
      <h2 id="add-lead" className="text-sm font-medium text-slate-900">
        Add a lead
      </h2>

      <div className="flex flex-wrap gap-4">
        <div className="min-w-56 flex-1">
          <Field id="lead-name" label="Name" value={name} error={fields.name} onChange={setName} />
        </div>
        <div className="min-w-56 flex-1">
          <Field
            id="lead-organisation"
            label="Organisation"
            value={organisationName}
            error={fields.organisationName}
            onChange={setOrganisationName}
          />
        </div>
        <div className="min-w-56 flex-1">
          <Field
            id="lead-email"
            label="Email"
            type="email"
            value={email}
            error={fields.email}
            onChange={setEmail}
          />
        </div>
        <div className="min-w-56 flex-1">
          <Field id="lead-phone" label="Phone" value={phone} error={fields.phone} onChange={setPhone} />
        </div>
        <div className="min-w-56 flex-1">
          <Select
            id="lead-source"
            label="Source"
            value={source}
            options={LEAD_SOURCES.map((option) => ({ value: option, label: LEAD_SOURCE_LABELS[option] }))}
            onChange={(value) => setSource(value as LeadSource)}
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
          {add.isPending ? 'Adding…' : 'Add lead'}
        </button>
      </div>
    </form>
  );
}
