import { type Dispatch, type RefObject, type SetStateAction, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  DEAL_PATHS,
  DEAL_ROLLUP_MAX_PARTIES,
  LEAD_GROUP_PATHS,
  PARTY_FIELDS,
  PARTY_PATHS,
  SETTABLE_PARTY_STATUSES,
  listPath,
  listQueryString,
  narrowed,
  type CreatePartyRequest,
  type LeadGroupListResponse,
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
import { navigate } from '../../../app/location';
import { useSession } from '../../../session/SessionProvider';
import { hasPermission } from '../../../session/permissions';
import { ContactDetail } from '../components/ContactDetail';
import { EditableText } from '../components/EditableCell';
import { BoardSetupModal } from '../components/BoardSetupModal';
import { ColumnsModal } from '../components/ColumnsModal';
import { EmailTemplatesModal } from '../components/EmailTemplatesModal';
import { MailboxesModal } from '../components/MailboxesModal';
import { SpreadsheetImportModal } from '../components/SpreadsheetImportModal';
import { fieldColumnKey } from '../columns';
import { useLeadFields } from '../vocabulary';

const UNASSIGNED = 'unassigned';

const SORTS = [
  { label: 'Name (A–Z)', sort: PARTY_FIELDS.name },
  { label: 'Name (Z–A)', sort: `-${PARTY_FIELDS.name}` },
  { label: 'Recently added', sort: `-${PARTY_FIELDS.createdAt}` },
] as const;

const TOOLBAR_BUTTON =
  'inline-flex items-center gap-1.5 rounded-lg border border-slate-200/80 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-2xs transition hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2';

const COLOR_PRESETS: Record<string, { bg: string; text: string; label: string }> = {
  emerald: { bg: 'bg-[#00c875]', text: 'text-white', label: 'Green' },
  blue: { bg: 'bg-[#2684ff]', text: 'text-white', label: 'Blue' },
  sky: { bg: 'bg-[#579bfc]', text: 'text-white', label: 'Sky' },
  red: { bg: 'bg-[#ff5630]', text: 'text-white', label: 'Red' },
  orange: { bg: 'bg-[#ff9800]', text: 'text-white', label: 'Orange' },
  purple: { bg: 'bg-[#9c27b0]', text: 'text-white', label: 'Purple' },
  teal: { bg: 'bg-[#36b37e]', text: 'text-white', label: 'Teal' },
  grey: { bg: 'bg-slate-400', text: 'text-white', label: 'Grey' },
};

/** Closes popovers on outside press or Escape key. */
function useDismissable(
  isOpen: boolean,
  ref: RefObject<HTMLElement | null>,
  setIsOpen: Dispatch<SetStateAction<boolean>>,
) {
  useEffect(() => {
    if (!isOpen) return;

    function onPointerDown(event: PointerEvent) {
      if (!ref.current?.contains(event.target as Node)) setIsOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setIsOpen(false);
    }

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [isOpen, ref, setIsOpen]);
}

type MenuItem = {
  label: string;
  icon?: string;
  onClick: () => void;
  disabled?: boolean;
  separated?: boolean;
};

function MenuPanel({
  items,
  onPicked,
  align = 'right',
}: {
  items: MenuItem[];
  onPicked: () => void;
  align?: 'left' | 'right';
}) {
  return (
    <div
      role="menu"
      className={`absolute ${align === 'left' ? 'left-0' : 'right-0'} z-50 mt-1.5 w-52 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-lg`}
    >
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          role="menuitem"
          disabled={item.disabled}
          onClick={() => {
            onPicked();
            item.onClick();
          }}
          className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50 ${
            item.separated ? 'mt-1 border-t border-slate-100 pt-2.5' : ''
          }`}
        >
          {item.icon && (
            <span aria-hidden="true" className="w-4 text-center text-slate-400">
              {item.icon}
            </span>
          )}
          {item.label}
        </button>
      ))}
    </div>
  );
}

function ToolbarMenu({ label, items }: { label: string; items: MenuItem[] }) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  useDismissable(isOpen, containerRef, setIsOpen);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((open) => !open)}
        className={`${TOOLBAR_BUTTON} ${isOpen ? 'bg-slate-100' : ''}`}
      >
        {label}
        <span aria-hidden="true" className="text-[9px] text-slate-400">▼</span>
      </button>

      {isOpen && <MenuPanel items={items} onPicked={() => setIsOpen(false)} />}
    </div>
  );
}

function CreateSplitButton({
  onNewContact,
  onNewGroup,
  onNewSource,
}: {
  onNewContact: () => void;
  onNewGroup: () => void;
  onNewSource: () => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  useDismissable(isOpen, containerRef, setIsOpen);

  return (
    <div ref={containerRef} className="relative ml-1">
      <div className="inline-flex overflow-hidden rounded-lg shadow-xs">
        <button
          type="button"
          onClick={onNewContact}
          className="inline-flex items-center gap-1.5 bg-[#008080] px-4 py-1.5 text-xs font-bold text-white transition hover:bg-[#006666] focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2"
        >
          <span aria-hidden="true" className="text-sm leading-none">+</span> New contact
        </button>
        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded={isOpen}
          aria-label="More to add"
          onClick={() => setIsOpen((open) => !open)}
          className={`border-l border-teal-900/25 px-2.5 py-1.5 text-[9px] text-white transition hover:bg-[#006666] focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2 ${
            isOpen ? 'bg-[#006666]' : 'bg-[#008080]'
          }`}
        >
          <span aria-hidden="true">▼</span>
        </button>
      </div>

      {isOpen && (
        <MenuPanel
          align="left"
          onPicked={() => setIsOpen(false)}
          items={[
            { label: 'New contact', icon: '+', onClick: onNewContact },
            { label: 'New group', icon: '▤', onClick: onNewGroup },
            { label: 'New source', icon: '⇢', onClick: onNewSource },
          ]}
        />
      )}
    </div>
  );
}

function filterSelectClass(active?: unknown) {
  return `rounded-lg border px-2.5 py-1.5 text-xs font-medium shadow-2xs focus:outline-none focus:border-teal-500 cursor-pointer ${
    active ? 'border-teal-500 bg-teal-50/50 text-teal-900 font-semibold' : 'border-slate-200 bg-white text-slate-700'
  }`;
}

export function ContactsPage() {
  const { session } = useSession();
  const canWrite = hasPermission(session, 'parties:parties:write');
  const canReadDeals = hasPermission(session, 'crm:deals:read');

  const [query, setQuery] = useState<ListQuery>({});
  const [selectedId, setSelectedId] = useState<string>();
  const [isAdding, setIsAdding] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  // Contact priorities & custom colors local store
  const [priorities, setPriorities] = useState<Record<string, string>>({});
  const [statusColors, setStatusColors] = useState<Record<string, string>>({});
  const [priorityColors, setPriorityColors] = useState<Record<string, string>>({});

  // Custom cell values state making ALL fields editable
  const [cellValues, setCellValues] = useState<Record<string, Record<string, string>>>({});

  // Rich board features state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isColumnsOpen, setIsColumnsOpen] = useState(false);
  const [isBoardSetupOpen, setIsBoardSetupOpen] = useState(false);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [isMailboxesOpen, setIsMailboxesOpen] = useState(false);
  const [isTemplatesOpen, setIsTemplatesOpen] = useState(false);
  const [inlineAddingGroupId, setInlineAddingGroupId] = useState<string | null>(null);
  const [filterGroupId, setFilterGroupId] = useState('');

  // Default core & custom columns state matching Screenshots
  const [visibleColumns, setVisibleColumns] = useState<Record<string, boolean>>({
    select: true,
    contact: true,
    title: true,
    type: true,
    company: true,
    accounts: true,
    status: true,
    priority: true,
    email: true,
    phone: true,
    roles: true,
    deals: true,
    convert: true,
    owner: true,
    source: true,
    'field:location': true,
    'field:comments': true,
    actions: true,
  });

  const queryClient = useQueryClient();
  const { all: customFields } = useLeadFields(isColumnsOpen);

  const groupsQuery = useQuery({
    queryKey: ['crm', 'lead-groups'],
    queryFn: () => api.get<LeadGroupListResponse>(LEAD_GROUP_PATHS.leadGroups),
    enabled: isBoardSetupOpen,
  });
  const leadGroups = groupsQuery.data?.items ?? [];

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
    queryFn: () => api.get<PartyRolesResponse>(PARTY_PATHS.roles).catch(() => ({ roles: [] })),
    retry: false,
  });

  const contacts = contactsQuery.data?.items ?? [];
  const accounts = accountsQuery.data?.items ?? [];

  const pageInfo = contactsQuery.data?.page;
  const total = pageInfo?.total ?? contacts.length;
  const pageNumber = pageInfo?.number ?? 1;
  const pageCount = pageInfo?.pages ?? 1;

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

  const groups = useMemo(() => {
    const map = new Map<string, { id: string; name: string; contacts: PartySummary[] }>();

    for (const contact of contacts) {
      const id = contact.organisationId ?? UNASSIGNED;
      const name = contact.organisationId ? contact.organisationName ?? 'Unnamed account' : 'No account';

      if (!map.has(id)) map.set(id, { id, name, contacts: [] });
      map.get(id)!.contacts.push(contact);
    }

    const result = [...map.values()];
    result.sort((a, b) => {
      if (a.id === UNASSIGNED) return 1;
      if (b.id === UNASSIGNED) return -1;
      return a.name.localeCompare(b.name);
    });

    return result;
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

  const deleteContact = useMutation({
    mutationFn: (id: string) => api.delete(PARTY_PATHS.party(id)),
    onSuccess: () => {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        return next;
      });
      refresh();
    },
  });

  const deleteBatch = useMutation({
    mutationFn: async (ids: string[]) => {
      for (const id of ids) {
        await api.delete(PARTY_PATHS.party(id));
      }
    },
    onSuccess: () => {
      setSelectedIds(new Set());
      refresh();
    },
  });

  const assignAccountBatch = useMutation({
    mutationFn: async ({ ids, organisationId }: { ids: string[]; organisationId: string }) => {
      for (const id of ids) {
        await api.patch(PARTY_PATHS.party(id), { organisationId });
      }
    },
    onSuccess: () => {
      setSelectedIds(new Set());
      refresh();
    },
  });

  function getCellValue(contactId: string, colKey: string, fallback?: string): string {
    return cellValues[contactId]?.[colKey] ?? fallback ?? '';
  }

  function setCellValue(contactId: string, colKey: string, val: string) {
    setCellValues((prev) => ({
      ...prev,
      [contactId]: {
        ...(prev[contactId] ?? {}),
        [colKey]: val,
      },
    }));
    updateContact.mutate({
      id: contactId,
      data: { [colKey]: val },
    });
  }

  function toggleSelectAll(groupContacts: PartySummary[]) {
    const groupIds = groupContacts.map((c) => c.id);
    const allSelected = groupIds.every((id) => selectedIds.has(id));

    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allSelected) {
        groupIds.forEach((id) => next.delete(id));
      } else {
        groupIds.forEach((id) => next.add(id));
      }
      return next;
    });
  }

  function toggleSelectOne(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function isColumnVisible(key: string) {
    if (key === 'account' || key === 'accounts' || key === 'company')
      return visibleColumns['company'] ?? visibleColumns['accounts'] ?? visibleColumns['account'] ?? true;
    return visibleColumns[key] ?? true;
  }

  function toggleColumn(key: string, on: boolean) {
    setVisibleColumns((prev) => ({
      ...prev,
      [key]: on,
      ...(key === 'company' || key === 'accounts' || key === 'account'
        ? { company: on, accounts: on, account: on }
        : {}),
    }));
  }

  // Dynamically constructed active columns list mapping ColumnsModal choices
  const activeColumns = useMemo(() => {
    const cols: { key: string; label: string; align?: 'left' | 'center' | 'right' }[] = [];

    if (isColumnVisible('select')) cols.push({ key: 'select', label: '' });
    if (isColumnVisible('contact')) cols.push({ key: 'contact', label: 'Contact' });
    if (isColumnVisible('title')) cols.push({ key: 'title', label: 'Title' });
    if (isColumnVisible('type')) cols.push({ key: 'type', label: 'Type' });
    if (isColumnVisible('company') || isColumnVisible('accounts')) cols.push({ key: 'company', label: 'Accounts' });
    if (isColumnVisible('status')) cols.push({ key: 'status', label: 'Status', align: 'center' });
    if (isColumnVisible('priority') || isColumnVisible('field:priority')) cols.push({ key: 'priority', label: 'Priority', align: 'center' });
    if (isColumnVisible('email')) cols.push({ key: 'email', label: 'Email' });
    if (isColumnVisible('phone')) cols.push({ key: 'phone', label: 'Phone' });
    if (isColumnVisible('roles')) cols.push({ key: 'roles', label: 'Roles' });
    if (canReadDeals && (isColumnVisible('deals') || isColumnVisible('deal'))) cols.push({ key: 'deals', label: 'Deals' });
    if (isColumnVisible('owner')) cols.push({ key: 'owner', label: 'Owner' });
    if (isColumnVisible('convert')) cols.push({ key: 'convert', label: 'Move to Contacts', align: 'center' });
    if (isColumnVisible('source')) cols.push({ key: 'source', label: 'Source' });
    if (isColumnVisible('field:location') || isColumnVisible('location')) cols.push({ key: 'field:location', label: 'Location' });
    if (isColumnVisible('field:comments') || isColumnVisible('comments')) cols.push({ key: 'field:comments', label: 'Comments' });

    for (const field of customFields) {
      const fKey = fieldColumnKey(field);
      if (
        fKey !== 'field:location' &&
        fKey !== 'field:comments' &&
        fKey !== 'field:priority' &&
        isColumnVisible(fKey)
      ) {
        cols.push({ key: fKey, label: field.label });
      }
    }

    if (isColumnVisible('actions')) cols.push({ key: 'actions', label: 'Actions', align: 'right' });

    return cols;
  }, [visibleColumns, customFields, canReadDeals]);

  const failureMessage =
    contactsQuery.error instanceof ApiFailure ? contactsQuery.error.message : undefined;

  const isFiltered = Boolean(
    query.search ||
      query.filters?.[PARTY_FIELDS.organisationId] ||
      query.filters?.[PARTY_FIELDS.status] ||
      query.filters?.[PARTY_FIELDS.role] ||
      filterGroupId,
  );

  return (
    <div className="mx-auto flex max-w-[1600px] flex-col gap-6 p-2">
      {/* Header Toolbar */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-slate-200/80 pb-4">
        <h1 className="text-lg font-bold tracking-tight text-slate-900">Contacts</h1>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold tabular-nums text-slate-600">
          {total}
        </span>

        {canWrite && (
          <CreateSplitButton
            onNewContact={() => setIsAdding(true)}
            onNewGroup={() => setIsBoardSetupOpen(true)}
            onNewSource={() => setIsBoardSetupOpen(true)}
          />
        )}

        <div className="ml-auto flex flex-wrap items-center gap-2">
          {canWrite && (
            <button
              type="button"
              onClick={() => setIsImportOpen(true)}
              className={TOOLBAR_BUTTON}
            >
              <span aria-hidden="true">⬆</span> Import spreadsheet
            </button>
          )}

          <ToolbarMenu
            label="Outreach"
            items={[
              { label: 'Mailboxes', icon: '✉️', onClick: () => setIsMailboxesOpen(true) },
              { label: 'Email Templates', icon: '📝', onClick: () => setIsTemplatesOpen(true) },
            ]}
          />

          <ToolbarMenu
            label="Board"
            items={[
              { label: 'Configure columns', icon: '⚙️', onClick: () => setIsColumnsOpen(true) },
              { label: 'Board setup (Groups)', icon: '📋', onClick: () => setIsBoardSetupOpen(true) },
            ]}
          />
        </div>
      </div>

      {/* Filter Bar */}
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
            placeholder="Search by name, organisation or email..."
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

        {leadGroups.length > 0 && (
          <select
            aria-label="Group"
            value={filterGroupId}
            onChange={(event) => setFilterGroupId(event.target.value)}
            className={filterSelectClass(filterGroupId)}
          >
            <option value="">All groups</option>
            {leadGroups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        )}

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
            onClick={() => {
              setQuery({});
              setFilterGroupId('');
            }}
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
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-slate-300 bg-slate-50/50 p-8 text-center">
          <p className="text-sm font-semibold text-slate-700">
            {isFiltered ? 'No contacts match those filters.' : 'No contacts yet.'}
          </p>
          <p className="max-w-md text-xs text-slate-500">
            {isFiltered
              ? 'Widen the search, or clear the filters to see everybody.'
              : 'Add a person, or move a lead to contacts, and they appear here.'}
          </p>
          {!isFiltered && canWrite && (
            <button
              type="button"
              onClick={() => setIsAdding(true)}
              className="mt-1 inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-4 py-2 text-xs font-semibold text-white shadow-xs hover:bg-emerald-700"
            >
              + Add First Contact
            </button>
          )}
        </div>
      )}

      {/* Main Groups Table Section */}
      <div className="flex flex-col gap-6">
        {groups.map((group) => {
          const isCollapsed = collapsed[group.id] ?? false;
          const groupContacts = group.contacts;
          const allGroupSelected =
            groupContacts.length > 0 &&
            groupContacts.every((c) => selectedIds.has(c.id));

          return (
            <section
              key={group.id}
              aria-label={group.name}
              className="relative flex flex-col gap-4 overflow-hidden rounded-r-xl border-y border-r border-l-4 border-slate-200/90 border-l-blue-500 bg-white p-4 shadow-2xs sm:p-5"
            >
              <div className="flex items-center justify-between">
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
                    {groupContacts.length} {groupContacts.length === 1 ? 'contact' : 'contacts'}
                  </span>
                </button>
              </div>

              {!isCollapsed && (
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50/70 text-slate-600">
                        {activeColumns.map((col) => {
                          if (col.key === 'select') {
                            return (
                              <th key="select" scope="col" className="w-10 px-3 py-3 text-center">
                                <input
                                  type="checkbox"
                                  aria-label={`Select all in ${group.name}`}
                                  checked={allGroupSelected}
                                  onChange={() => toggleSelectAll(groupContacts)}
                                  className="rounded border-slate-300 text-teal-600 focus:ring-teal-500 cursor-pointer"
                                />
                              </th>
                            );
                          }
                          return (
                            <th
                              key={col.key}
                              scope="col"
                              className={`px-4 py-3 font-bold ${
                                col.align === 'center'
                                  ? 'text-center'
                                  : col.align === 'right'
                                  ? 'text-right'
                                  : 'text-left'
                              }`}
                            >
                              {col.label}
                            </th>
                          );
                        })}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {/* Inline Quick-Add Row or Add Row Button */}
                      {inlineAddingGroupId === group.id && canWrite ? (
                        <InlineAddContactRow
                          accounts={accounts}
                          columns={activeColumns}
                          defaultOrganisationId={group.id === UNASSIGNED ? undefined : group.id}
                          onCancel={() => setInlineAddingGroupId(null)}
                          onAdded={() => {
                            setInlineAddingGroupId(null);
                            refresh();
                          }}
                        />
                      ) : (
                        canWrite && (
                          <tr>
                            <td />
                            <td className="py-2.5 px-4" colSpan={activeColumns.length - 1}>
                              <button
                                type="button"
                                onClick={() => setInlineAddingGroupId(group.id)}
                                className="text-xs font-semibold text-teal-700 hover:text-teal-900 transition-colors"
                              >
                                + Add a contact...
                              </button>
                            </td>
                          </tr>
                        )
                      )}

                      {groupContacts.map((contact) => {
                        const isSelected = selectedIds.has(contact.id);
                        const contactPriority = priorities[contact.id] || 'medium';

                        return (
                          <tr
                            key={contact.id}
                            className={`transition-colors ${
                              isSelected ? 'bg-teal-50/60' : 'hover:bg-slate-50/80'
                            }`}
                          >
                            {activeColumns.map((col) => {
                              switch (col.key) {
                                case 'select':
                                  return (
                                    <td key="select" className="px-3 py-3 text-center align-middle">
                                      <input
                                        type="checkbox"
                                        aria-label={`Select ${contact.name}`}
                                        checked={isSelected}
                                        onChange={() => toggleSelectOne(contact.id)}
                                        className="rounded border-slate-300 text-teal-600 focus:ring-teal-500 cursor-pointer"
                                      />
                                    </td>
                                  );

                                case 'contact':
                                  return (
                                    <td key="contact" className="px-4 py-3 align-middle">
                                      <div className="flex min-w-0 items-center gap-2">
                                        <span aria-hidden="true" className="text-slate-300 font-bold select-none">
                                          ::
                                        </span>
                                        <EditableText
                                          value={contact.name}
                                          label={`Name of ${contact.name}`}
                                          canWrite={canWrite}
                                          className="font-bold text-slate-900"
                                          onSave={(value: string) =>
                                            updateContact.mutate({
                                              id: contact.id,
                                              data: { name: value },
                                            })
                                          }
                                        />
                                        <button
                                          type="button"
                                          aria-label={`Open ${contact.name}`}
                                          title="Open contact details"
                                          onClick={() => setSelectedId(contact.id)}
                                          className="shrink-0 rounded p-0.5 font-bold text-slate-400 hover:bg-sky-50 hover:text-sky-600"
                                        >
                                          ▤
                                        </button>
                                      </div>
                                    </td>
                                  );

                                case 'title':
                                  return (
                                    <td key="title" className="px-4 py-3 align-middle text-slate-700">
                                      <EditableText
                                        value={getCellValue(contact.id, 'title')}
                                        label={`Title of ${contact.name}`}
                                        placeholder="—"
                                        canWrite={canWrite}
                                        className="font-medium text-slate-800"
                                        onSave={(val) => setCellValue(contact.id, 'title', val)}
                                      />
                                    </td>
                                  );

                                case 'type':
                                  return (
                                    <td key="type" className="px-4 py-3 align-middle">
                                      <EditableText
                                        value={getCellValue(contact.id, 'type', 'Prospect')}
                                        label={`Type of ${contact.name}`}
                                        placeholder="—"
                                        canWrite={canWrite}
                                        className="font-bold text-[#2e7d32]"
                                        onSave={(val) => setCellValue(contact.id, 'type', val)}
                                      />
                                    </td>
                                  );

                                case 'company':
                                  return (
                                    <td key="company" className="px-4 py-3 align-middle text-slate-700">
                                      <EditableText
                                        value={contact.organisationName || getCellValue(contact.id, 'company')}
                                        label={`Company of ${contact.name}`}
                                        placeholder="—"
                                        canWrite={canWrite}
                                        className="font-medium text-slate-800"
                                        onSave={(val) => setCellValue(contact.id, 'company', val)}
                                      />
                                    </td>
                                  );

                                case 'status':
                                  return (
                                    <td key="status" className="px-4 py-3 text-center align-middle">
                                      <ContactStatusPicker
                                        status={contact.status}
                                        color={statusColors[contact.id]}
                                        canWrite={canWrite}
                                        onChange={(newStatus) =>
                                          updateContact.mutate({
                                            id: contact.id,
                                            data: { status: newStatus },
                                          })
                                        }
                                        onColorChange={(c) =>
                                          setStatusColors((prev) => ({ ...prev, [contact.id]: c }))
                                        }
                                      />
                                    </td>
                                  );

                                case 'priority':
                                  return (
                                    <td key="priority" className="px-4 py-3 text-center align-middle">
                                      <ContactPriorityPicker
                                        value={contactPriority}
                                        color={priorityColors[contact.id]}
                                        canWrite={canWrite}
                                        onChange={(p) =>
                                          setPriorities((prev) => ({ ...prev, [contact.id]: p }))
                                        }
                                        onColorChange={(c) =>
                                          setPriorityColors((prev) => ({ ...prev, [contact.id]: c }))
                                        }
                                      />
                                    </td>
                                  );

                                case 'owner':
                                  return (
                                    <td key="owner" className="px-4 py-3 align-middle text-slate-700">
                                      <EditableText
                                        value={getCellValue(contact.id, 'owner')}
                                        label={`Owner of ${contact.name}`}
                                        placeholder="—"
                                        canWrite={canWrite}
                                        className="font-medium text-slate-800"
                                        onSave={(val) => setCellValue(contact.id, 'owner', val)}
                                      />
                                    </td>
                                  );

                                case 'convert':
                                  return (
                                    <td key="convert" className="px-4 py-3 text-center align-middle">
                                      <button
                                        type="button"
                                        onClick={() => navigate('/crm/contacts')}
                                        title="View Contact on Contacts board"
                                        className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-emerald-300 bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700 transition-colors hover:border-emerald-400 hover:bg-emerald-100 shadow-2xs cursor-pointer"
                                      >
                                        Contact created ↗
                                      </button>
                                    </td>
                                  );

                                case 'email':
                                  return (
                                    <td key="email" className="px-4 py-3 align-middle text-slate-600">
                                      <EditableText
                                        value={contact.email}
                                        label={`Email of ${contact.name}`}
                                        type="email"
                                        icon="✉"
                                        canWrite={canWrite}
                                        href={(value: string) => `mailto:${value}`}
                                        className="font-medium text-sky-600 hover:underline"
                                        onSave={(value: string) =>
                                          updateContact.mutate({
                                            id: contact.id,
                                            data: { email: value },
                                          })
                                        }
                                      />
                                    </td>
                                  );

                                case 'phone':
                                  return (
                                    <td key="phone" className="px-4 py-3 align-middle text-slate-600">
                                      <EditableText
                                        value={contact.phone}
                                        label={`Phone of ${contact.name}`}
                                        type="tel"
                                        icon="📞"
                                        canWrite={canWrite}
                                        className="font-medium text-slate-700"
                                        onSave={(value: string) =>
                                          updateContact.mutate({
                                            id: contact.id,
                                            data: { phone: value },
                                          })
                                        }
                                      />
                                    </td>
                                  );

                                case 'roles':
                                  return (
                                    <td key="roles" className="px-4 py-3 align-middle text-slate-700 font-medium">
                                      <EditableText
                                        value={contact.roles.length === 0 ? getCellValue(contact.id, 'roles') : contact.roles.join(', ')}
                                        label={`Roles of ${contact.name}`}
                                        placeholder="—"
                                        canWrite={canWrite}
                                        className="font-medium text-slate-800"
                                        onSave={(val) => setCellValue(contact.id, 'roles', val)}
                                      />
                                    </td>
                                  );

                                case 'deals':
                                  return (
                                    <td key="deals" className="px-4 py-3 align-middle">
                                      <DealsCell
                                        contactName={contact.name}
                                        rollup={rollups.get(contact.id)}
                                        isPending={rollupQuery.isPending}
                                      />
                                    </td>
                                  );

                                case 'source':
                                  return (
                                    <td key="source" className="px-4 py-3 align-middle text-slate-700">
                                      <EditableText
                                        value={getCellValue(contact.id, 'source')}
                                        label={`Source of ${contact.name}`}
                                        placeholder="—"
                                        canWrite={canWrite}
                                        className="font-medium text-slate-800"
                                        onSave={(val) => setCellValue(contact.id, 'source', val)}
                                      />
                                    </td>
                                  );

                                case 'field:location':
                                  return (
                                    <td key="field:location" className="px-4 py-3 align-middle text-slate-700">
                                      <EditableText
                                        value={getCellValue(contact.id, 'field:location')}
                                        label={`Location of ${contact.name}`}
                                        placeholder="—"
                                        canWrite={canWrite}
                                        className="font-medium text-slate-800"
                                        onSave={(val) => setCellValue(contact.id, 'field:location', val)}
                                      />
                                    </td>
                                  );

                                case 'field:comments':
                                  return (
                                    <td key="field:comments" className="px-4 py-3 align-middle text-slate-700">
                                      <EditableText
                                        value={getCellValue(contact.id, 'field:comments')}
                                        label={`Comments of ${contact.name}`}
                                        placeholder="—"
                                        canWrite={canWrite}
                                        className="font-medium text-slate-800"
                                        onSave={(val) => setCellValue(contact.id, 'field:comments', val)}
                                      />
                                    </td>
                                  );

                                case 'actions':
                                  return (
                                    <td key="actions" className="px-4 py-3 text-right align-middle whitespace-nowrap">
                                      <div className="inline-flex items-center gap-1.5">
                                        <button
                                          type="button"
                                          onClick={() => navigate('/crm/deals')}
                                          title="Create Deal for contact"
                                          className="rounded bg-emerald-50 px-2 py-1 text-xs font-bold text-emerald-700 hover:bg-emerald-100 transition-colors"
                                        >
                                          + Deal
                                        </button>

                                        {canWrite && (
                                          <button
                                            type="button"
                                            aria-label={`Delete ${contact.name}`}
                                            title="Delete contact"
                                            onClick={() => {
                                              if (
                                                window.confirm(
                                                  `Are you sure you want to delete ${contact.name}?`,
                                                )
                                              ) {
                                                deleteContact.mutate(contact.id);
                                              }
                                            }}
                                            className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600 transition-colors"
                                          >
                                            🗑
                                          </button>
                                        )}
                                      </div>
                                    </td>
                                  );

                                default:
                                  return (
                                    <td key={col.key} className="px-4 py-3 align-middle text-slate-700 font-medium">
                                      <EditableText
                                        value={getCellValue(contact.id, col.key)}
                                        label={`${col.label} of ${contact.name}`}
                                        placeholder="—"
                                        canWrite={canWrite}
                                        className="font-medium text-slate-800"
                                        onSave={(val) => setCellValue(contact.id, col.key, val)}
                                      />
                                    </td>
                                  );
                              }
                            })}
                          </tr>
                        );
                      })}
                    </tbody>

                    {/* Table Footer - More fields → button */}
                    <tfoot>
                      <tr className="border-t border-slate-100 bg-slate-50/60 text-slate-500">
                        <td colSpan={activeColumns.length - 1} />
                        <td className="py-2.5 px-4 text-right">
                          <button
                            type="button"
                            onClick={() => setIsColumnsOpen(true)}
                            title="Choose columns"
                            aria-label="Choose columns"
                            className="whitespace-nowrap font-bold text-teal-700 hover:underline"
                          >
                            More fields →
                          </button>
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </section>
          );
        })}
      </div>

      {/* Pagination Footer */}
      {pageCount > 1 && (
        <div className="flex items-center justify-between border-t border-slate-200 pt-4 text-xs text-slate-500">
          <span>
            Page {pageNumber} of {pageCount} · {total} {total === 1 ? 'row' : 'rows'}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={pageNumber <= 1}
              onClick={() => setQuery({ ...query, page: pageNumber - 1 })}
              className="rounded border border-slate-200 px-2.5 py-1 font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              Previous
            </button>
            <button
              type="button"
              disabled={pageNumber >= pageCount}
              onClick={() => setQuery({ ...query, page: pageNumber + 1 })}
              className="rounded border border-slate-200 px-2.5 py-1 font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </div>
      )}

      {/* Floating Bulk Action Bar */}
      {selectedIds.size > 0 && canWrite && (
        <div className="fixed bottom-6 left-1/2 z-40 flex -translate-x-1/2 items-center gap-4 rounded-xl border border-slate-800 bg-slate-900 px-5 py-3 text-white shadow-2xl backdrop-blur-xs">
          <span className="text-xs font-bold">
            {selectedIds.size} {selectedIds.size === 1 ? 'contact' : 'contacts'} selected
          </span>

          <div className="h-4 w-px bg-slate-700" aria-hidden="true" />

          {accounts.length > 0 && (
            <select
              aria-label="Assign account to selected"
              onChange={(e) => {
                if (e.target.value) {
                  assignAccountBatch.mutate({
                    ids: Array.from(selectedIds),
                    organisationId: e.target.value,
                  });
                  e.target.value = '';
                }
              }}
              className="rounded bg-slate-800 px-2.5 py-1 text-xs font-medium text-slate-200 focus:outline-none"
            >
              <option value="">Assign Account…</option>
              {accounts.map((acc) => (
                <option key={acc.id} value={acc.id}>
                  {acc.name}
                </option>
              ))}
            </select>
          )}

          <button
            type="button"
            onClick={() => deleteBatch.mutate(Array.from(selectedIds))}
            disabled={deleteBatch.isPending}
            className="rounded bg-rose-600 px-3 py-1 text-xs font-bold text-white hover:bg-rose-700 transition"
          >
            {deleteBatch.isPending ? 'Deleting…' : 'Delete selected 🗑'}
          </button>

          <button
            type="button"
            onClick={() => setSelectedIds(new Set())}
            className="text-xs font-medium text-slate-400 hover:text-slate-200"
          >
            Deselect
          </button>
        </div>
      )}

      {/* Drawer Details Panel */}
      {selectedId && (
        <ContactDetail
          contactId={selectedId}
          accounts={accounts}
          onClose={() => setSelectedId(undefined)}
          onChanged={refresh}
        />
      )}

      {/* Modals */}
      {isColumnsOpen && (
        <ColumnsModal
          fields={customFields}
          isVisible={isColumnVisible}
          onToggle={toggleColumn}
          onClose={() => setIsColumnsOpen(false)}
        />
      )}

      {isBoardSetupOpen && (
        <BoardSetupModal onClose={() => setIsBoardSetupOpen(false)} />
      )}

      {isImportOpen && (
        <SpreadsheetImportModal isOpen={true} onClose={() => setIsImportOpen(false)} onSuccess={() => setIsImportOpen(false)} />
      )}

      {isMailboxesOpen && (
        <MailboxesModal isOpen={true} onClose={() => setIsMailboxesOpen(false)} />
      )}

      {isTemplatesOpen && (
        <EmailTemplatesModal isOpen={true} onClose={() => setIsTemplatesOpen(false)} />
      )}
    </div>
  );
}

/** Inline Quick-Add Contact Row matching dynamic column layout. */
/** Inline Quick-Add Contact Row matching dynamic column layout. */
function InlineAddContactRow({
  accounts,
  columns,
  defaultOrganisationId,
  onCancel,
  onAdded,
}: {
  accounts: PartySummary[];
  columns: { key: string; label: string; align?: 'left' | 'center' | 'right' }[];
  defaultOrganisationId?: string;
  onCancel: () => void;
  onAdded: () => void;
}) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [organisationId, setOrganisationId] = useState(defaultOrganisationId ?? '');

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

  const commit = () => {
    if (name.trim()) add.mutate();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') commit();
    if (e.key === 'Escape') onCancel();
  };

  return (
    <tr className="bg-sky-50/50 border-b border-sky-200">
      {columns.map((col) => {
        switch (col.key) {
          case 'select':
            return (
              <td key="select" className="w-10 px-3 py-2.5 text-center align-middle text-slate-300">
                —
              </td>
            );

          case 'contact':
            return (
              <td key="contact" className="px-4 py-2.5 align-middle">
                <input
                  autoFocus
                  type="text"
                  placeholder="Contact name..."
                  aria-label="Contact name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={onKeyDown}
                  className="w-full rounded border border-sky-400 bg-white px-2.5 py-1 text-xs font-bold focus:outline-none focus:ring-1 focus:ring-sky-500 shadow-2xs"
                />
              </td>
            );

          case 'email':
            return (
              <td key="email" className="px-4 py-2.5 align-middle">
                <input
                  type="email"
                  placeholder="Email..."
                  aria-label="Contact email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onKeyDown={onKeyDown}
                  className="w-full rounded border border-slate-200 bg-white px-2.5 py-1 text-xs focus:outline-none"
                />
              </td>
            );

          case 'phone':
            return (
              <td key="phone" className="px-4 py-2.5 align-middle">
                <input
                  type="tel"
                  placeholder="Phone..."
                  aria-label="Contact phone"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  onKeyDown={onKeyDown}
                  className="w-full rounded border border-slate-200 bg-white px-2.5 py-1 text-xs focus:outline-none"
                />
              </td>
            );

          case 'company':
            return (
              <td key="company" className="px-4 py-2.5 align-middle">
                <select
                  aria-label="Contact account"
                  value={organisationId}
                  onChange={(e) => setOrganisationId(e.target.value)}
                  className="w-full rounded border border-slate-200 bg-white px-2 py-1 text-xs"
                >
                  <option value="">No account</option>
                  {accounts.map((acc) => (
                    <option key={acc.id} value={acc.id}>
                      {acc.name}
                    </option>
                  ))}
                </select>
              </td>
            );

          case 'actions':
            return (
              <td key="actions" className="px-4 py-2.5 text-right align-middle whitespace-nowrap">
                <button
                  type="button"
                  onClick={commit}
                  disabled={!name.trim() || add.isPending}
                  className="mr-2 rounded-md bg-[#107c41] px-3.5 py-1 text-xs font-bold text-white shadow-2xs hover:bg-[#0c6233] disabled:opacity-50"
                >
                  {add.isPending ? 'Saving…' : 'Save'}
                </button>
                <button
                  type="button"
                  onClick={onCancel}
                  className="text-xs font-medium text-slate-500 hover:text-slate-700"
                >
                  Cancel
                </button>
              </td>
            );

          default:
            return (
              <td key={col.key} className="px-4 py-2.5 text-center align-middle text-slate-300">
                —
              </td>
            );
        }
      })}
    </tr>
  );
}

/** Interactive Contact Status Block Picker matching Priority Design & Color Modifier */
function ContactStatusPicker({
  status,
  color,
  canWrite,
  onChange,
  onColorChange,
}: {
  status: string;
  color?: string;
  canWrite: boolean;
  onChange: (status: 'active' | 'inactive') => void;
  onColorChange?: (color: string) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [openUpward, setOpenUpward] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  useDismissable(isOpen, containerRef, setIsOpen);

  useEffect(() => {
    if (!isOpen) return;
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      setOpenUpward(window.innerHeight - rect.bottom < 260);
    }
  }, [isOpen]);

  const isActive = status === 'active';
  const customColor = color ? COLOR_PRESETS[color] : null;

  const bgStyle = customColor
    ? `${customColor.bg} ${customColor.text} font-bold`
    : isActive
    ? 'bg-[#00c875] text-white font-bold'
    : 'bg-[#579bfc] text-white font-bold';

  const label = isActive ? 'Active' : 'Inactive';

  if (!canWrite) {
    return (
      <div className={`mx-auto flex h-7 w-24 items-center justify-center rounded-xs text-xs shadow-xs ${bgStyle}`}>
        {label}
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative inline-block text-center">
      <button
        type="button"
        onClick={() => setIsOpen((o) => !o)}
        className={`mx-auto flex h-7 w-24 items-center justify-center rounded-xs text-xs shadow-xs transition-opacity hover:opacity-90 cursor-pointer ${bgStyle}`}
      >
        {label}
      </button>

      {isOpen && (
        <div
          className={`absolute left-1/2 z-50 w-36 -translate-x-1/2 overflow-hidden rounded-md border border-slate-200 bg-white p-2 shadow-lg ${
            openUpward ? 'bottom-full mb-1' : 'top-full mt-1'
          }`}
        >
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1 text-left px-1">
            Set Status
          </div>
          <button
            type="button"
            onClick={() => {
              setIsOpen(false);
              onChange('active');
            }}
            className="flex h-7 w-full items-center justify-center rounded bg-[#00c875] text-xs font-bold text-white hover:opacity-90"
          >
            Active
          </button>
          <button
            type="button"
            onClick={() => {
              setIsOpen(false);
              onChange('inactive');
            }}
            className="mt-1 flex h-7 w-full items-center justify-center rounded bg-[#579bfc] text-xs font-bold text-white hover:opacity-90"
          >
            Inactive
          </button>

          {onColorChange && (
            <>
              <div className="mt-2 border-t border-slate-100 pt-1 text-[10px] font-bold uppercase tracking-wider text-slate-400 text-left px-1">
                Assign Color
              </div>
              <div className="mt-1 grid grid-cols-4 gap-1">
                {Object.entries(COLOR_PRESETS).map(([cKey, preset]) => (
                  <button
                    key={cKey}
                    type="button"
                    title={preset.label}
                    onClick={() => {
                      onColorChange(cKey);
                      setIsOpen(false);
                    }}
                    className={`h-5 w-5 rounded ${preset.bg} hover:ring-2 hover:ring-slate-400 transition-all`}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** Interactive Priority Block Picker matching Screenshot 2 EXACTLY & Color Modifier */
export function ContactPriorityPicker({
  value,
  color,
  canWrite = true,
  onChange,
  onColorChange,
}: {
  value?: string;
  color?: string;
  canWrite?: boolean;
  onChange: (priority: string) => void;
  onColorChange?: (color: string) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [openUpward, setOpenUpward] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  useDismissable(isOpen, containerRef, setIsOpen);

  useEffect(() => {
    if (!isOpen) return;
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      setOpenUpward(window.innerHeight - rect.bottom < 260);
    }
  }, [isOpen]);

  const priority = value?.toLowerCase();
  const customColor = color ? COLOR_PRESETS[color] : null;

  let bgStyle = 'bg-slate-200 text-slate-700 font-medium';
  let label = '—';

  if (customColor) {
    bgStyle = `${customColor.bg} ${customColor.text} font-bold`;
    label = priority === 'high' ? 'High' : priority === 'low' ? 'Low' : 'Medium';
  } else if (priority === 'high') {
    bgStyle = 'bg-[#ff5630] text-white font-bold';
    label = 'High';
  } else if (priority === 'medium') {
    bgStyle = 'bg-[#2684ff] text-white font-bold';
    label = 'Medium';
  } else if (priority === 'low') {
    bgStyle = 'bg-[#36b37e] text-white font-bold';
    label = 'Low';
  }

  if (!canWrite) {
    return (
      <div className={`mx-auto flex h-7 w-24 items-center justify-center rounded-xs text-xs shadow-xs ${bgStyle}`}>
        {label}
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative inline-block text-center">
      <button
        type="button"
        onClick={() => setIsOpen((o) => !o)}
        className={`mx-auto flex h-7 w-24 items-center justify-center rounded-xs text-xs shadow-xs transition-opacity hover:opacity-90 cursor-pointer ${bgStyle}`}
      >
        {label}
      </button>

      {isOpen && (
        <div
          className={`absolute left-1/2 z-50 w-36 -translate-x-1/2 overflow-hidden rounded-md border border-slate-200 bg-white p-2 shadow-lg ${
            openUpward ? 'bottom-full mb-1' : 'top-full mt-1'
          }`}
        >
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1 text-left px-1">
            Set Priority
          </div>
          <button
            type="button"
            onClick={() => {
              setIsOpen(false);
              onChange('high');
            }}
            className="flex h-7 w-full items-center justify-center rounded bg-[#ff5630] text-xs font-bold text-white hover:opacity-90"
          >
            High
          </button>
          <button
            type="button"
            onClick={() => {
              setIsOpen(false);
              onChange('medium');
            }}
            className="mt-1 flex h-7 w-full items-center justify-center rounded bg-[#2684ff] text-xs font-bold text-white hover:opacity-90"
          >
            Medium
          </button>
          <button
            type="button"
            onClick={() => {
              setIsOpen(false);
              onChange('low');
            }}
            className="mt-1 flex h-7 w-full items-center justify-center rounded bg-[#36b37e] text-xs font-bold text-white hover:opacity-90"
          >
            Low
          </button>

          {onColorChange && (
            <>
              <div className="mt-2 border-t border-slate-100 pt-1 text-[10px] font-bold uppercase tracking-wider text-slate-400 text-left px-1">
                Assign Color
              </div>
              <div className="mt-1 grid grid-cols-4 gap-1">
                {Object.entries(COLOR_PRESETS).map(([cKey, preset]) => (
                  <button
                    key={cKey}
                    type="button"
                    title={preset.label}
                    onClick={() => {
                      onColorChange(cKey);
                      setIsOpen(false);
                    }}
                    className={`h-5 w-5 rounded ${preset.bg} hover:ring-2 hover:ring-slate-400 transition-all`}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** Deals Rollup summary badge */
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

function NewContactForm({
  accounts,
  onCancel,
  onAdded,
}: {
  accounts: PartySummary[];
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
