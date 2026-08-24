import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ERROR_CODES,
  IDENTITY_PATHS,
  LEAD_PATHS,
  LEAD_SOURCES,
  PARTY_PATHS,
  listPath,
  type AddPartyRoleRequest,
  type CreatePartyRequest,
  type LeadQualifyAction,
  type LeadResponse,
  type LeadSource,
  type PartyKind,
  type PartyListResponse,
  type PartyResponse,
  type PartySummary,
  type QualifyLeadRequest,
  type UpdateLeadRequest,
  type UserListResponse,
  type UserSummary,
} from '@erp/shared';
import { Field, FormError, Select } from '@erp/shared/ui';
import { ApiFailure, api } from '../../../api/client';
import { useSession } from '../../../session/SessionProvider';
import { hasPermission } from '../../../session/permissions';
import { LEAD_SOURCE_LABELS, LEAD_STATUS_LABELS } from '../labels';
import { ActivityTimeline } from './ActivityTimeline';

/**
 * The role a qualified Lead's Party is tagged with. A new role string, not `customer` — a
 * qualified Lead is not a paying customer yet.
 */
const PROSPECT_ROLE = 'prospect';

/**
 * One Lead, and everything that can be done to it.
 *
 * A panel rather than a page of its own, matching Parties' own detail panel: everything here
 * is an edit to a row that is visible in the list behind it, and every action answers with the
 * whole Lead so the panel never patches its own copy from what it *thinks* happened.
 *
 * The qualify flow is the one that reaches outside this module entirely on the frontend: it
 * creates-or-finds a Party through Parties' own endpoints, calls crm's `qualify` with the
 * resulting id, and then — as a second, separate call — tags that Party `prospect` through
 * Parties' `POST /parties/:id/roles`. `crm`'s backend never creates a Party and never writes
 * a `PartyRole`; both of those happen here, in the browser, exactly as the spec composes them.
 *
 * The assignment picker is the other one: it resolves colleagues by calling identity's
 * `GET /api/identity/users` directly. `crm`'s backend has no user directory of its own —
 * identity's public surface is deliberately empty — so this is the same "compose a second
 * call, don't add a backend edge" discipline the qualify flow uses.
 */
export function LeadDetail({
  leadId,
  onClose,
  onChanged,
}: {
  leadId: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { session } = useSession();
  const canWrite = hasPermission(session, 'crm:leads:write');
  const canReadUsers = hasPermission(session, 'identity:users:read');
  const canReadParties = hasPermission(session, 'parties:parties:read');
  const queryClient = useQueryClient();

  const lead = useQuery({
    queryKey: ['crm', 'leads', 'detail', leadId],
    queryFn: () => api.get<LeadResponse>(LEAD_PATHS.lead(leadId)),
  });

  const users = useQuery({
    queryKey: ['identity', 'users', 'all'],
    queryFn: () => api.get<UserListResponse>(listPath(IDENTITY_PATHS.users, { pageSize: 200 })),
    enabled: canReadUsers,
  });

  const linkedParty = useQuery({
    queryKey: ['parties', 'detail', lead.data?.partyId],
    queryFn: () => api.get<PartyResponse>(PARTY_PATHS.party(lead.data!.partyId!)),
    enabled: canReadParties && Boolean(lead.data?.partyId),
  });

  /** Parties a "link" qualify can offer, fetched once the panel opens. */
  const parties = useQuery({
    queryKey: ['parties', 'directory'],
    queryFn: () => api.get<PartyListResponse>(listPath(PARTY_PATHS.parties, { pageSize: 100 })),
    enabled: canWrite,
  });

  /**
   * Every ordinary edit on this panel, sharing one pending state and one error — they all
   * answer with the same Lead, so one mutation is one place for the refresh to live rather
   * than five copies of the same success handler.
   */
  const change = useMutation({
    mutationFn: (act: () => Promise<LeadResponse>) => act(),
    onSuccess: (updated) => {
      queryClient.setQueryData(['crm', 'leads', 'detail', leadId], updated);
      onChanged();
    },
  });

  const failure = change.error instanceof ApiFailure ? change.error : undefined;
  const fields = failure?.fields ?? {};
  const detail = lead.data;

  if (lead.isPending) {
    return (
      <section className="rounded-md border border-slate-200 bg-white p-4">
        <p role="status" className="text-sm text-slate-500">
          Loading lead…
        </p>
      </section>
    );
  }

  if (!detail) {
    return (
      <section className="rounded-md border border-slate-200 bg-white p-4">
        <p role="alert" className="text-sm text-red-700">
          {lead.error instanceof ApiFailure ? lead.error.message : 'That lead could not be loaded.'}
        </p>
      </section>
    );
  }

  const assignee = users.data?.items.find((user) => user.id === detail.assignedToUserId);

  return (
    <section
      aria-labelledby="lead-detail"
      className="flex flex-col gap-6 rounded-md border border-slate-200 bg-white p-4"
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 id="lead-detail" className="text-lg font-semibold text-slate-900">
            {detail.name}
          </h2>
          <p className="text-sm text-slate-600">
            {LEAD_STATUS_LABELS[detail.status]}
            {detail.organisationName ? ` · ${detail.organisationName}` : ''}
            {detail.email ? ` · ${detail.email}` : ''}
            {detail.phone ? ` · ${detail.phone}` : ''}
            {' · '}Source: {LEAD_SOURCE_LABELS[detail.source]}
          </p>
          {detail.partyId && (
            <p className="text-sm text-slate-600">
              Linked party:{' '}
              {linkedParty.data ? linkedParty.data.name : canReadParties ? 'Loading…' : detail.partyId}
            </p>
          )}
        </div>

        <button
          type="button"
          onClick={onClose}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-900 hover:bg-slate-50"
        >
          Close
        </button>
      </header>

      {failure && failure.code !== ERROR_CODES.validationFailed && (
        <FormError>{failure.message}</FormError>
      )}

      {canWrite && (
        <Details
          detail={detail}
          fields={fields}
          pending={change.isPending}
          onSave={(update) =>
            change.mutate(() => api.patch<LeadResponse>(LEAD_PATHS.lead(leadId), update))
          }
        />
      )}

      <LifecycleActions
        status={detail.status}
        canWrite={canWrite}
        pending={change.isPending}
        onMarkContacted={() =>
          change.mutate(() =>
            api.patch<LeadResponse>(LEAD_PATHS.lead(leadId), {
              status: 'contacted',
            } satisfies UpdateLeadRequest),
          )
        }
        onDisqualify={() => change.mutate(() => api.post<LeadResponse>(LEAD_PATHS.disqualify(leadId)))}
        onReopen={() => change.mutate(() => api.post<LeadResponse>(LEAD_PATHS.reopen(leadId)))}
      />

      {canWrite && detail.status !== 'qualified' && detail.status !== 'disqualified' && (
        <Qualify
          leadId={leadId}
          leadName={detail.name}
          leadOrganisationName={detail.organisationName}
          leadEmail={detail.email}
          leadPhone={detail.phone}
          candidates={parties.data?.items ?? []}
          pending={change.isPending}
          onQualify={(act) => change.mutate(act)}
        />
      )}

      {canWrite && canReadUsers && (
        <Assignment
          assignedToUserId={detail.assignedToUserId}
          assignee={assignee}
          users={users.data?.items ?? []}
          pending={change.isPending}
          onAssign={(userId) =>
            change.mutate(() =>
              api.patch<LeadResponse>(LEAD_PATHS.lead(leadId), {
                assignedToUserId: userId,
              } satisfies UpdateLeadRequest),
            )
          }
        />
      )}

      <ActivityTimeline parentKind="lead" parentId={leadId} />
    </section>
  );
}

/**
 * Name, organisation, email, phone and source — the details somebody actually gets wrong
 * when typing a lead in for the first time.
 *
 * Behind a button, unlike the lifecycle actions beside it, because reading a lead's details
 * is the common case and editing them is not.
 */
function Details({
  detail,
  fields,
  pending,
  onSave,
}: {
  detail: LeadResponse;
  fields: Record<string, string>;
  pending: boolean;
  onSave: (update: UpdateLeadRequest) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    name: detail.name,
    organisationName: detail.organisationName ?? '',
    email: detail.email ?? '',
    phone: detail.phone ?? '',
    source: detail.source,
  });

  const set = <K extends keyof typeof form>(key: K) => (value: (typeof form)[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  if (!editing) {
    return (
      <div>
        <button
          type="button"
          onClick={() => {
            // Reset from the lead rather than from whatever was typed and abandoned last time,
            // so opening the form twice does not offer a stale draft as the truth.
            setForm({
              name: detail.name,
              organisationName: detail.organisationName ?? '',
              email: detail.email ?? '',
              phone: detail.phone ?? '',
              source: detail.source,
            });
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
      aria-labelledby="edit-lead-details"
      className="flex flex-col gap-4 rounded-md border border-slate-200 p-3"
      onSubmit={(event) => {
        event.preventDefault();
        // Empty is left out rather than sent blank. The endpoint reads an absent field as
        // "do not touch it" and would refuse an empty one.
        onSave({
          name: form.name,
          source: form.source,
          ...(form.organisationName ? { organisationName: form.organisationName } : {}),
          ...(form.email ? { email: form.email } : {}),
          ...(form.phone ? { phone: form.phone } : {}),
        });
        setEditing(false);
      }}
    >
      <h3 id="edit-lead-details" className="text-sm font-medium text-slate-900">
        Details
      </h3>

      <div className="flex flex-wrap gap-4">
        <div className="min-w-48 flex-1">
          <Field id="detail-name" label="Name" value={form.name} error={fields.name} onChange={set('name')} />
        </div>
        <div className="min-w-48 flex-1">
          <Field
            id="detail-organisation"
            label="Organisation"
            value={form.organisationName}
            error={fields.organisationName}
            onChange={set('organisationName')}
          />
        </div>
        <div className="min-w-48 flex-1">
          <Field
            id="detail-email"
            label="Email"
            type="email"
            value={form.email}
            error={fields.email}
            onChange={set('email')}
          />
        </div>
        <div className="min-w-48 flex-1">
          <Field id="detail-phone" label="Phone" value={form.phone} error={fields.phone} onChange={set('phone')} />
        </div>
        <div className="min-w-48 flex-1">
          <Select
            id="detail-source"
            label="Source"
            value={form.source}
            error={fields.source}
            options={LEAD_SOURCES.map((option) => ({ value: option, label: LEAD_SOURCE_LABELS[option] }))}
            onChange={(value) => set('source')(value as LeadSource)}
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

/** Mark contacted, disqualify, or reopen — the moves that do not need a Party first. */
function LifecycleActions({
  status,
  canWrite,
  pending,
  onMarkContacted,
  onDisqualify,
  onReopen,
}: {
  status: LeadResponse['status'];
  canWrite: boolean;
  pending: boolean;
  onMarkContacted: () => void;
  onDisqualify: () => void;
  onReopen: () => void;
}) {
  if (!canWrite) return null;

  return (
    <div className="flex flex-wrap gap-2">
      {status === 'new' && (
        <button
          type="button"
          disabled={pending}
          onClick={onMarkContacted}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-900 hover:bg-slate-50 disabled:opacity-50"
        >
          Mark contacted
        </button>
      )}
      {status !== 'disqualified' && (
        <button
          type="button"
          disabled={pending}
          onClick={onDisqualify}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-900 hover:bg-slate-50 disabled:opacity-50"
        >
          Disqualify
        </button>
      )}
      {status === 'disqualified' && (
        <button
          type="button"
          disabled={pending}
          onClick={onReopen}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-900 hover:bg-slate-50 disabled:opacity-50"
        >
          Reopen
        </button>
      )}
    </div>
  );
}

/**
 * Turns this Lead into a real customer record.
 *
 * The whole flow lives here rather than in the backend, per the spec: this component
 * creates-or-links a Party through Parties' own endpoints, calls crm's `qualify` with the
 * resulting id, and finally tags that Party `prospect` through a second, separate call to
 * Parties' `POST /parties/:id/roles`. `crm`'s backend never sees a Party payload and never
 * writes a `PartyRole` — there is no endpoint here that could ask it to.
 */
function Qualify({
  leadId,
  leadName,
  leadOrganisationName,
  leadEmail,
  leadPhone,
  candidates,
  pending,
  onQualify,
}: {
  leadId: string;
  leadName: string;
  leadOrganisationName: string | null;
  leadEmail: string | null;
  leadPhone: string | null;
  candidates: PartySummary[];
  pending: boolean;
  onQualify: (act: () => Promise<LeadResponse>) => void;
}) {
  const [mode, setMode] = useState<LeadQualifyAction>('create');
  const [kind, setKind] = useState<PartyKind>(leadOrganisationName ? 'organisation' : 'person');
  const [name, setName] = useState(leadOrganisationName || leadName);
  const [email, setEmail] = useState(leadEmail ?? '');
  const [phone, setPhone] = useState(leadPhone ?? '');
  const [partyId, setPartyId] = useState('');

  async function tagProspect(id: string): Promise<void> {
    await api.post<PartyResponse>(PARTY_PATHS.partyRoles(id), {
      role: PROSPECT_ROLE,
    } satisfies AddPartyRoleRequest);
  }

  async function createThenQualify(): Promise<LeadResponse> {
    const party = await api.post<PartyResponse>(PARTY_PATHS.parties, {
      kind,
      name,
      ...(email ? { email } : {}),
      ...(phone ? { phone } : {}),
    } satisfies CreatePartyRequest);

    const qualified = await api.post<LeadResponse>(LEAD_PATHS.qualify(leadId), {
      action: 'create',
      partyId: party.id,
    } satisfies QualifyLeadRequest);

    await tagProspect(party.id);
    return qualified;
  }

  async function linkThenQualify(): Promise<LeadResponse> {
    const qualified = await api.post<LeadResponse>(LEAD_PATHS.qualify(leadId), {
      action: 'link',
      partyId,
    } satisfies QualifyLeadRequest);

    await tagProspect(partyId);
    return qualified;
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border border-slate-200 p-3">
      <h3 className="text-sm font-medium text-slate-900">Qualify this lead</h3>
      <p className="text-sm text-slate-600">
        Turns this lead into a real party — the address book record the rest of the system
        recognises. This never happens automatically alongside anything else.
      </p>

      <fieldset className="flex flex-wrap gap-4">
        <legend className="sr-only">How to qualify</legend>
        {(['create', 'link'] as const).map((option) => (
          <label key={option} className="flex items-center gap-2 text-sm text-slate-900">
            <input
              type="radio"
              name="qualify-mode"
              value={option}
              checked={mode === option}
              onChange={() => setMode(option)}
            />
            {option === 'create' ? 'Create a new party' : 'Link an existing party'}
          </label>
        ))}
      </fieldset>

      {mode === 'create' ? (
        <div className="flex flex-wrap gap-4">
          <fieldset className="flex gap-4">
            <legend className="sr-only">Is this a</legend>
            {(['person', 'organisation'] as const).map((option) => (
              <label key={option} className="flex items-center gap-2 text-sm text-slate-900">
                <input
                  type="radio"
                  name="qualify-party-kind"
                  value={option}
                  checked={kind === option}
                  onChange={() => setKind(option)}
                />
                {option === 'person' ? 'Person' : 'Organisation'}
              </label>
            ))}
          </fieldset>
          <div className="min-w-56 flex-1">
            <Field id="qualify-name" label="Name" value={name} onChange={setName} />
          </div>
          <div className="min-w-56 flex-1">
            <Field id="qualify-email" label="Email" type="email" value={email} onChange={setEmail} />
          </div>
          <div className="min-w-56 flex-1">
            <Field id="qualify-phone" label="Phone" value={phone} onChange={setPhone} />
          </div>
        </div>
      ) : (
        <div className="min-w-56">
          <Select
            id="qualify-party"
            label="Party"
            value={partyId}
            placeholder="Choose a party…"
            options={candidates.map((party) => ({ value: party.id, label: party.name }))}
            onChange={setPartyId}
          />
        </div>
      )}

      <div>
        <button
          type="button"
          disabled={pending || (mode === 'create' ? !name.trim() : !partyId)}
          onClick={() => onQualify(mode === 'create' ? createThenQualify : linkThenQualify)}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
        >
          Qualify
        </button>
      </div>
    </div>
  );
}

/**
 * Who this Lead is assigned to.
 *
 * Resolved and displayed entirely on this side of the wire: `assignedToUserId` is an opaque
 * id as far as crm's backend is concerned, and this is the "compose a second call" the spec
 * asks for — `GET /api/identity/users`, joined against it client-side, so a name never has
 * to travel through a module that has no way to look one up.
 */
function Assignment({
  assignedToUserId,
  assignee,
  users,
  pending,
  onAssign,
}: {
  assignedToUserId: string | null;
  assignee: UserSummary | undefined;
  users: readonly UserSummary[];
  pending: boolean;
  onAssign: (userId: string) => void;
}) {
  return (
    <div className="flex flex-col gap-2 border-t border-slate-200 pt-4">
      <h3 className="text-sm font-medium text-slate-900">Assigned to</h3>
      <p className="text-sm text-slate-600">
        {assignedToUserId ? (assignee ? assignee.name : 'Somebody no longer in this company') : 'Nobody yet'}
      </p>
      <div className="min-w-56">
        <Select
          id="lead-assignee"
          label="Reassign"
          value={assignedToUserId ?? ''}
          placeholder="Unassigned"
          disabled={pending}
          options={users.map((user) => ({ value: user.id, label: user.name }))}
          onChange={(userId) => {
            if (userId) onAssign(userId);
          }}
        />
      </div>
    </div>
  );
}
