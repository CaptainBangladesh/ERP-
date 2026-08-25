import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  DEAL_PATHS,
  DEAL_ROLLUP_MAX_PARTIES,
  PARTY_FIELDS,
  PARTY_PATHS,
  SETTABLE_PARTY_STATUSES,
  listPath,
  listQueryString,
  narrowed,
  sortParameter,
  type CreatePartyRequest,
  type ListQuery,
  type PartyDealRollup,
  type PartyDealRollupResponse,
  type PartyListResponse,
  type PartyResponse,
  type PartyRolesResponse,
  type PartySummary,
} from '@erp/shared';
import { formatMoney } from '@erp/shared/ui';
import { ApiFailure, api } from '../../../api/client';
import { useSession } from '../../../session/SessionProvider';
import { hasPermission } from '../../../session/permissions';
import { ContactDetail } from '../components/ContactDetail';
import { EditableText } from '../components/EditableCell';

/**
 * The Contacts board — every individual this company deals with, under the account they
 * belong to.
 *
 * A contact is a `Party` of kind `person`; nothing new is stored to make this screen work.
 * That is deliberate, and it is what "keeping all boards perfectly in sync" actually means
 * here: there is no second copy of a person to fall out of step with the first. A contact
 * created by qualifying a Lead, by the address book, or by the button on this page is the
 * same row, and every screen showing them is showing that row.
 *
 * Three modules meet on this page and each is asked for exactly what it owns:
 *
 * - **parties** answers who these people are, and does the filtering. Every control below is
 *   a field `PARTY_LIST` already declares — this screen adds no query language of its own.
 * - **crm** answers what is in flight with them, in one roll-up for the whole page rather
 *   than a request per row.
 * - **identity** is not asked at all: a contact has no owner, unlike a Lead.
 *
 * It lives in `crm` rather than in `parties` for a reason the module graph decides rather
 * than taste: `crm` depends on `parties`, so this screen may read both, while the address
 * book at `/parties` may never read a Deal. The two are not duplicates — `/parties` is the
 * whole book, both kinds, with roles, addresses and merging; this is the CRM's view of the
 * people in it.
 */
export function ContactsPage() {
  const { session } = useSession();
  const canWrite = hasPermission(session, 'parties:parties:write');
  const canReadDeals = hasPermission(session, 'crm:deals:read');

  const [query, setQuery] = useState<ListQuery>({});
  const [selectedId, setSelectedId] = useState<string>();
  const [isAdding, setIsAdding] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const queryClient = useQueryClient();

  /**
   * The board's own question, with `kind` pinned.
   *
   * Pinned here rather than offered as a filter: a board of contacts that could be switched
   * to showing companies would be the address book, and the address book already exists.
   */
  const contactsQuery = useQuery({
    queryKey: ['parties', 'contacts', listQueryString(query)],
    queryFn: () =>
      api.get<PartyListResponse>(
        listPath(PARTY_PATHS.parties, {
          ...query,
          filters: { ...query.filters, [PARTY_FIELDS.kind]: 'person' },
          pageSize: 100,
        }),
      ),
  });

  /** The accounts a contact can belong to — the filter's options, and the panel's picker. */
  const accountsQuery = useQuery({
    queryKey: ['parties', 'accounts'],
    queryFn: () =>
      api.get<PartyListResponse>(
        listPath(PARTY_PATHS.parties, {
          filters: { [PARTY_FIELDS.kind]: 'organisation' },
          sort: PARTY_FIELDS.name,
          pageSize: 100,
        }),
      ),
  });

  const rolesQuery = useQuery({
    queryKey: ['parties', 'roles'],
    queryFn: () => api.get<PartyRolesResponse>(PARTY_PATHS.roles),
  });

  const contacts = contactsQuery.data?.items ?? [];
  const accounts = accountsQuery.data?.items ?? [];

  // The count badge and the pager both read the *server's* total. `contacts.length` is the
  // size of the page in hand, which silently said "100" to a company with four hundred.
  const pageInfo = contactsQuery.data?.page;
  const total = pageInfo?.total ?? contacts.length;
  const pageCount = pageInfo?.pages ?? 1;
  const pageNumber = pageInfo?.number ?? 1;

  /**
   * Every contact's deals, in one request.
   *
   * Capped at what the endpoint will answer for, so a page size raised later degrades into
   * showing fewer deal cells rather than into a refusal that blanks the board.
   */
  const rollupIds = useMemo(
    () => contacts.slice(0, DEAL_ROLLUP_MAX_PARTIES).map((contact) => contact.id),
    [contacts],
  );

  const rollupQuery = useQuery({
    queryKey: ['crm', 'deals', 'by-party', rollupIds],
    queryFn: () =>
      api.get<PartyDealRollupResponse>(
        `${DEAL_PATHS.dealsByParty}?partyIds=${encodeURIComponent(rollupIds.join(','))}`,
      ),
    enabled: canReadDeals && rollupIds.length > 0,
  });

  const rollups = useMemo(() => {
    const map = new Map<string, PartyDealRollup>();
    for (const item of rollupQuery.data?.items ?? []) map.set(item.partyId, item);
    return map;
  }, [rollupQuery.data]);

  /**
   * Stakeholders, gathered under their account.
   *
   * Grouped from the contacts themselves rather than from the accounts list, so a contact
   * always appears somewhere: an account the accounts query has not returned — beyond its
   * first hundred, created a moment ago — still forms a section from the name the contact
   * carries. "No account" sorts last, because it is where the eye goes least often.
   */
  const groups = useMemo(() => {
    const map = new Map<string, { id: string; name: string; contacts: PartySummary[] }>();

    for (const contact of contacts) {
      const id = contact.organisationId ?? UNASSIGNED;
      const name = contact.organisationId ? contact.organisationName ?? 'Unnamed account' : 'No account';
      const group = map.get(id) ?? { id, name, contacts: [] };
      group.contacts.push(contact);
      map.set(id, group);
    }

    return [...map.values()].sort((a, b) => {
      if (a.id === UNASSIGNED) return 1;
      if (b.id === UNASSIGNED) return -1;
      return a.name.localeCompare(b.name);
    });
  }, [contacts]);

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: ['parties'] });
    void queryClient.invalidateQueries({ queryKey: ['crm', 'deals'] });
  }

  const updateContact = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      api.patch<PartyResponse>(PARTY_PATHS.party(id), data),
    onSuccess: refresh,
  });

  const failure = [contactsQuery.error, updateContact.error].find((e) => e instanceof ApiFailure);
  const failureMessage = failure instanceof ApiFailure ? failure.message : undefined;

  const isFiltered = Boolean(
    query.sort ||
      query.search ||
      query.filters?.[PARTY_FIELDS.organisationId] ||
      query.filters?.[PARTY_FIELDS.status] ||
      query.filters?.[PARTY_FIELDS.role],
  );

  return (
    <div className="mx-auto flex max-w-[1600px] flex-col gap-6 p-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-slate-200/80 pb-4">
        <h1 className="text-lg font-bold tracking-tight text-slate-900">Contacts</h1>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold tabular-nums text-slate-600">
          {total}
        </span>

        {canWrite && (
          <button
            type="button"
            onClick={() => setIsAdding((open) => !open)}
            className="ml-1 inline-flex items-center gap-1.5 rounded-lg bg-[#008080] px-4 py-1.5 text-xs font-bold text-white shadow-xs transition hover:bg-[#006666] focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2"
          >
            <span aria-hidden="true" className="text-sm leading-none">
              +
            </span>{' '}
            New contact
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200/80 bg-white p-3 shadow-2xs">
        <div className="relative min-w-[240px] flex-1">
          <span
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs text-slate-400"
          >
            🔍
          </span>
          <input
            type="search"
            aria-label="Search contacts"
            placeholder="Search by name or email..."
            value={query.search ?? ''}
            onChange={(event) =>
              setQuery({ ...query, search: event.target.value || undefined, page: 1 })
            }
            className="w-full rounded-lg border border-slate-200 bg-white py-1.5 pl-8 pr-3 text-xs text-slate-900 placeholder:text-slate-400 focus:border-teal-500 focus:outline-none"
          />
        </div>

        <div className="h-5 w-px bg-slate-200" aria-hidden="true" />

        <select
          aria-label="Account"
          value={query.filters?.[PARTY_FIELDS.organisationId] ?? ''}
          onChange={(event) =>
            setQuery(narrowed(query, PARTY_FIELDS.organisationId, event.target.value))
          }
          className={filterSelectClass(query.filters?.[PARTY_FIELDS.organisationId])}
        >
          <option value="">All accounts</option>
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name}
            </option>
          ))}
        </select>

        <select
          aria-label="Status"
          value={query.filters?.[PARTY_FIELDS.status] ?? ''}
          onChange={(event) => setQuery(narrowed(query, PARTY_FIELDS.status, event.target.value))}
          className={filterSelectClass(query.filters?.[PARTY_FIELDS.status])}
        >
          <option value="">All statuses</option>
          {SETTABLE_PARTY_STATUSES.map((status) => (
            <option key={status} value={status}>
              {status === 'active' ? 'Active' : 'Inactive'}
            </option>
          ))}
        </select>

        <select
          aria-label="Role"
          value={query.filters?.[PARTY_FIELDS.role] ?? ''}
          onChange={(event) => setQuery(narrowed(query, PARTY_FIELDS.role, event.target.value))}
          className={filterSelectClass(query.filters?.[PARTY_FIELDS.role])}
        >
          <option value="">All roles</option>
          {(rolesQuery.data?.roles ?? []).map((role) => (
            <option key={role} value={role}>
              {role}
            </option>
          ))}
        </select>

        <select
          aria-label="Sort by"
          value={query.sort ?? ''}
          onChange={(event) =>
            setQuery({ ...query, sort: event.target.value || undefined, page: 1 })
          }
          className={filterSelectClass(query.sort)}
        >
          {SORTS.map((option) => (
            <option key={option.label} value={option.sort}>
              {option.label}
            </option>
          ))}
        </select>

        {isFiltered && (
          <button
            type="button"
            onClick={() => setQuery({})}
            className="ml-auto inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-slate-500 transition hover:bg-slate-100 hover:text-slate-700"
          >
            <span aria-hidden="true">✕</span> Clear filters
          </button>
        )}
      </div>

      {failureMessage && (
        <div
          role="alert"
          className="rounded-lg border border-rose-200 bg-rose-50 p-3.5 text-xs font-medium text-rose-700"
        >
          {failureMessage}
        </div>
      )}

      {isAdding && canWrite && (
        <NewContactForm
          accounts={accounts}
          onCancel={() => setIsAdding(false)}
          onAdded={() => {
            setIsAdding(false);
            refresh();
          }}
        />
      )}

      {contacts.length === 0 && !contactsQuery.isPending && (
        <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/50 p-8 text-center">
          <p className="text-sm font-semibold text-slate-700">
            {isFiltered ? 'No contacts match those filters.' : 'No contacts yet.'}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {isFiltered
              ? 'Widen the search, or clear the filters to see everybody.'
              : 'Add a person, or move a lead to contacts, and they appear here.'}
          </p>
        </div>
      )}

      <div className="flex flex-col gap-6">
        {groups.map((group) => {
          const isCollapsed = collapsed[group.id] ?? false;

          return (
            <section
              key={group.id}
              aria-label={group.name}
              className="relative flex flex-col gap-4 overflow-hidden rounded-r-xl border-y border-r border-l-4 border-slate-200/90 border-l-blue-500 bg-white p-4 shadow-2xs sm:p-5"
            >
              <div className="flex items-center">
                <button
                  type="button"
                  onClick={() =>
                    setCollapsed((previous) => ({ ...previous, [group.id]: !previous[group.id] }))
                  }
                  className="group/title flex items-center gap-2 text-left focus:outline-none"
                >
                  <span className="text-xs font-bold text-slate-400 transition group-hover/title:text-slate-600">
                    {isCollapsed ? '►' : '▾'}
                  </span>
                  <h2 className="text-base font-bold text-[#0080ff]">{group.name}</h2>
                  <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-bold text-slate-600">
                    {group.contacts.length}{' '}
                    {group.contacts.length === 1 ? 'contact' : 'contacts'}
                  </span>
                </button>
              </div>

              {!isCollapsed && (
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50/70 text-slate-600">
                        <th scope="col" className="px-4 py-3 font-bold">
                          Contact
                        </th>
                        <th scope="col" className="px-4 py-3 font-bold">
                          Email
                        </th>
                        <th scope="col" className="px-4 py-3 font-bold">
                          Phone
                        </th>
                        <th scope="col" className="px-4 py-3 font-bold">
                          Roles
                        </th>
                        {canReadDeals && (
                          <th scope="col" className="px-4 py-3 font-bold">
                            Deals
                          </th>
                        )}
                        <th scope="col" className="px-4 py-3 text-center font-bold">
                          Status
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {group.contacts.map((contact) => (
                        <tr key={contact.id} className="transition-colors hover:bg-slate-50/80">
                          <td className="px-4 py-3 align-middle">
                            <div className="flex min-w-0 items-center gap-2">
                              <EditableText
                                value={contact.name}
                                label={`Name of ${contact.name}`}
                                canWrite={canWrite}
                                className="font-bold text-slate-900"
                                onSave={(value: string) =>
                                  updateContact.mutate({ id: contact.id, data: { name: value } })
                                }
                              />
                              <button
                                type="button"
                                aria-label={`Open ${contact.name}`}
                                title="Open contact"
                                onClick={() => setSelectedId(contact.id)}
                                className="shrink-0 rounded p-0.5 font-bold text-slate-400 hover:bg-sky-50 hover:text-sky-600"
                              >
                                ▤
                              </button>
                            </div>
                          </td>

                          <td className="px-4 py-3 align-middle text-slate-600">
                            <EditableText
                              value={contact.email}
                              label={`Email of ${contact.name}`}
                              type="email"
                              icon="✉️"
                              canWrite={canWrite}
                              href={(value: string) => `mailto:${value}`}
                              className="font-medium text-sky-600 hover:underline"
                              onSave={(value: string) =>
                                updateContact.mutate({ id: contact.id, data: { email: value } })
                              }
                            />
                          </td>

                          <td className="px-4 py-3 align-middle text-slate-600">
                            <EditableText
                              value={contact.phone}
                              label={`Phone of ${contact.name}`}
                              type="tel"
                              icon="📞"
                              canWrite={canWrite}
                              className="font-medium text-slate-700"
                              onSave={(value: string) =>
                                updateContact.mutate({ id: contact.id, data: { phone: value } })
                              }
                            />
                          </td>

                          <td className="px-4 py-3 align-middle text-slate-500">
                            {contact.roles.length === 0 ? '—' : contact.roles.join(', ')}
                          </td>

                          {canReadDeals && (
                            <td className="px-4 py-3 align-middle">
                              <DealsCell
                                contactName={contact.name}
                                rollup={rollups.get(contact.id)}
                                isPending={rollupQuery.isPending}
                              />
                            </td>
                          )}

                          <td className="px-4 py-3 text-center align-middle">
                            <span
                              className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold ${
                                contact.status === 'active'
                                  ? 'bg-emerald-50 text-emerald-700'
                                  : 'bg-slate-100 text-slate-500'
                              }`}
                            >
                              {contact.status === 'active' ? 'Active' : 'Inactive'}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          );
        })}
      </div>

      {pageCount > 1 && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-200/80 bg-white p-3 text-xs shadow-2xs">
          <span className="font-medium text-slate-500">
            Page {pageNumber} of {pageCount} — {total} contacts
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={pageNumber <= 1}
              onClick={() => setQuery({ ...query, page: pageNumber - 1 })}
              className={PAGER_BUTTON}
            >
              ← Previous
            </button>
            <button
              type="button"
              disabled={pageNumber >= pageCount}
              onClick={() => setQuery({ ...query, page: pageNumber + 1 })}
              className={PAGER_BUTTON}
            >
              Next →
            </button>
          </div>
        </div>
      )}

      {selectedId && (
        <ContactDetail
          contactId={selectedId}
          accounts={accounts}
          onClose={() => setSelectedId(undefined)}
          onChanged={refresh}
        />
      )}
    </div>
  );
}

/** The group a contact with no account sits in. Not an id — no party ever has this one. */
const UNASSIGNED = '__no_account__';

/**
 * What the board can be ordered by, in the words somebody would use.
 *
 * Every one is a field `PARTY_LIST` declares sortable, so the server does the ordering and the
 * board never sorts a page it happens to be holding — which would order a hundred contacts
 * within themselves and call it sorted. `kind` is sortable too and is left out: this board is
 * people, so ordering by whether they are a person answers nothing.
 *
 * The empty first entry is the server's own default rather than "no sort": a list has an order
 * whether or not anybody chose one.
 */
const SORTS: { label: string; sort: string }[] = [
  { label: 'Name (A–Z)', sort: '' },
  { label: 'Name (Z–A)', sort: sortParameter(PARTY_FIELDS.name, true) },
  { label: 'Newest first', sort: sortParameter(PARTY_FIELDS.createdAt, true) },
  { label: 'Oldest first', sort: sortParameter(PARTY_FIELDS.createdAt, false) },
  { label: 'Status', sort: sortParameter(PARTY_FIELDS.status, false) },
];

const PAGER_BUTTON =
  'rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-default disabled:opacity-40';

/** A filter select reads as active once it narrows the board, so applied filters are visible. */
function filterSelectClass(value: string | undefined) {
  const base =
    'rounded-lg border px-2.5 py-1.5 text-xs font-medium shadow-2xs focus:outline-none focus:border-teal-500 cursor-pointer';
  return value
    ? `${base} border-teal-500 bg-teal-50 text-teal-800`
    : `${base} border-slate-200 bg-white text-slate-700`;
}

/**
 * What this contact has in flight — the Deals board, reflected.
 *
 * Open and won are shown apart and never added: a contact with one won deal and nothing
 * current is not the same as one with a live pipeline, and a single total would say they
 * were. Lost is counted but not valued, because money that was never received is not a
 * figure anybody wants totalled beside one that was.
 */
function DealsCell({
  contactName,
  rollup,
  isPending,
}: {
  contactName: string;
  rollup: PartyDealRollup | undefined;
  isPending: boolean;
}) {
  if (!rollup) {
    return (
      <span aria-label={`Deals for ${contactName}`} className="text-xs text-slate-400">
        {isPending ? '…' : 'No deals'}
      </span>
    );
  }

  return (
    <span aria-label={`Deals for ${contactName}`} className="flex flex-col gap-0.5">
      {rollup.openCount > 0 && (
        <span className="font-semibold text-slate-800">
          {rollup.openCount} open
          <span className="ml-1.5 font-bold tabular-nums text-teal-700">
            {formatMoney(rollup.openValue)}
          </span>
        </span>
      )}
      {rollup.wonCount > 0 && (
        <span className="text-xs font-medium text-emerald-700">
          {rollup.wonCount} won
          <span className="ml-1.5 font-bold tabular-nums">{formatMoney(rollup.wonValue)}</span>
        </span>
      )}
      {rollup.lostCount > 0 && (
        <span className="text-xs font-medium text-slate-400">{rollup.lostCount} lost</span>
      )}
    </span>
  );
}

/**
 * Adding somebody to the book, from the board.
 *
 * `kind` is not asked: this screen adds people. An organisation is added where organisations
 * are managed, which is the address book — offering the choice here would make the board's
 * one job ambiguous for the sake of an act nobody comes to this screen to perform.
 */
function NewContactForm({
  accounts,
  onCancel,
  onAdded,
}: {
  accounts: { id: string; name: string }[];
  onCancel: () => void;
  onAdded: () => void;
}) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [organisationId, setOrganisationId] = useState('');

  const add = useMutation({
    mutationFn: () =>
      api.post<PartyResponse>(PARTY_PATHS.parties, {
        kind: 'person',
        name: name.trim(),
        ...(email ? { email } : {}),
        ...(phone ? { phone } : {}),
        ...(organisationId ? { organisationId } : {}),
      } satisfies CreatePartyRequest),
    onSuccess: onAdded,
  });

  const failure = add.error instanceof ApiFailure ? add.error : undefined;
  const message = failure
    ? failure.fields.name || failure.fields.email || failure.message
    : undefined;

  return (
    <form
      className="flex flex-wrap items-end gap-2 rounded-xl border border-teal-200 bg-teal-50/60 p-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (name.trim()) add.mutate();
      }}
    >
      <label className="flex min-w-[180px] flex-1 flex-col gap-1">
        <span className="text-xs font-semibold text-slate-600">Name</span>
        <input
          autoFocus
          aria-label="Contact name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs focus:border-teal-500 focus:outline-none"
        />
      </label>

      <label className="flex min-w-[180px] flex-1 flex-col gap-1">
        <span className="text-xs font-semibold text-slate-600">Email</span>
        <input
          type="email"
          aria-label="Contact email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs focus:border-teal-500 focus:outline-none"
        />
      </label>

      <label className="flex min-w-[140px] flex-col gap-1">
        <span className="text-xs font-semibold text-slate-600">Phone</span>
        <input
          aria-label="Contact phone"
          value={phone}
          onChange={(event) => setPhone(event.target.value)}
          className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs focus:border-teal-500 focus:outline-none"
        />
      </label>

      <label className="flex min-w-[160px] flex-col gap-1">
        <span className="text-xs font-semibold text-slate-600">Account</span>
        <select
          aria-label="Contact account"
          value={organisationId}
          onChange={(event) => setOrganisationId(event.target.value)}
          className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs focus:border-teal-500 focus:outline-none"
        >
          <option value="">No account</option>
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name}
            </option>
          ))}
        </select>
      </label>

      <div className="flex items-center gap-2 pb-0.5">
        <button
          type="submit"
          disabled={!name.trim() || add.isPending}
          className="rounded-lg bg-[#107c41] px-3.5 py-1.5 text-xs font-bold text-white shadow-2xs transition hover:bg-[#0c6233] disabled:opacity-50"
        >
          {add.isPending ? 'Adding…' : 'Add contact'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="text-xs font-medium text-slate-500 transition hover:text-slate-700"
        >
          Cancel
        </button>
      </div>

      {message && (
        <p role="alert" className="w-full text-xs font-semibold text-rose-600">
          {message}
        </p>
      )}
    </form>
  );
}
