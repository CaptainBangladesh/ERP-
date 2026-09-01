import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  LEAD_FIELDS,
  LEAD_PATHS,
  LEAD_SOURCES,
  IDENTITY_PATHS,
  listPath,
  listQueryString,
  narrowed,
  type CreateLeadRequest,
  type LeadCustomValues,
  type LeadListResponse,
  type LeadResponse,
  type LeadSummary,
  type ListQuery,
  type UserListResponse,
} from '@erp/shared';
import { ApiFailure, api } from '../../../api/client';
import { navigate } from '../../../app/location';
import { useSession } from '../../../session/SessionProvider';
import { hasPermission } from '../../../session/permissions';
import { leadWorkspacePath } from './LeadWorkspace';
import { BoardSetupModal } from '../components/BoardSetupModal';
import { ColumnsModal } from '../components/ColumnsModal';
import { ConvertLeadModal } from '../components/ConvertLeadModal';
import { CustomFieldCell } from '../components/CustomFieldCell';
import { EditableText } from '../components/EditableCell';
import { EmailTemplatesModal } from '../components/EmailTemplatesModal';
import { MailboxesModal } from '../components/MailboxesModal';
import { SpreadsheetImportModal } from '../components/SpreadsheetImportModal';
import { StatusLabelsModal } from '../components/StatusLabelsModal';
import { StatusPicker } from '../components/StatusPicker';
import { WebFormModal } from '../components/WebFormModal';
import {
  boardColumns,
  boardMinWidth,
  fieldColumnKey,
  useVisibleColumns,
  type BoardColumn,
} from '../columns';
import {
  useLeadGroups,
  useLeadSources,
  useLeadStatusLabels,
  useLeadFields,
  LEAD_VOCABULARY_KEY,
} from '../vocabulary';

export function LeadsPage() {
  const { session } = useSession();
  const canWrite = hasPermission(session, 'crm:leads:write');
  const [query, setQuery] = useState<ListQuery>({});
  const [convertLead, setConvertLead] = useState<LeadSummary>();
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const [selectedLeadIds, setSelectedLeadIds] = useState<Set<string>>(new Set());

  // Modals state
  const [isMailboxesOpen, setIsMailboxesOpen] = useState(false);
  const [isTemplatesOpen, setIsTemplatesOpen] = useState(false);
  const [isWebFormOpen, setIsWebFormOpen] = useState(false);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [isLabelsOpen, setIsLabelsOpen] = useState(false);
  const [boardSetupTab, setBoardSetupTab] = useState<'groups' | 'sources'>();
  const [isColumnsOpen, setIsColumnsOpen] = useState(false);
  const [addingLeadInGroup, setAddingLeadInGroup] = useState<string>();

  const queryClient = useQueryClient();
  const { visible, toggle } = useVisibleColumns();
  const { groups } = useLeadGroups();
  const { sources } = useLeadSources();
  const statusLabels = useLeadStatusLabels();
  const { all: customFields } = useLeadFields();

  // Decided once and handed to every group table, so a column sits in the same place in each
  // section of the board no matter what that section's rows happen to contain.
  const columns = useMemo(() => boardColumns(visible, customFields), [visible, customFields]);
  const tableMinWidth = useMemo(() => boardMinWidth(columns), [columns]);

  const usersQuery = useQuery({
    queryKey: ['identity', 'users', 'list'],
    queryFn: () => api.get<UserListResponse>(IDENTITY_PATHS.users),
  });
  const users = usersQuery.data?.items ?? [];

  const leadsQuery = useQuery({
    queryKey: ['crm', 'leads', 'list', listQueryString(query)],
    queryFn: () => api.get<LeadListResponse>(listPath(LEAD_PATHS.leads, { ...query, pageSize: 100 })),
  });

  const failure = leadsQuery.error instanceof ApiFailure ? leadsQuery.error : undefined;

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: ['crm', 'leads'] });
    void queryClient.invalidateQueries({ queryKey: [...LEAD_VOCABULARY_KEY] });
  }

  // Deduplicate leads by id
  const rawLeads = leadsQuery.data?.items ?? [];
  const leads = useMemo(() => {
    const map = new Map<string, LeadSummary>();
    for (const lead of rawLeads) {
      map.set(lead.id, lead);
    }
    return Array.from(map.values());
  }, [rawLeads]);

  // Grouping leads by Group ID
  const groupedLeads = useMemo(() => {
    const map = new Map<string, LeadSummary[]>();
    if (groups.length === 0) {
      map.set('default', leads);
      return map;
    }
    for (const group of groups) {
      map.set(group.id, []);
    }
    for (const lead of leads) {
      const gId = lead.groupId || (groups[0]?.id ?? 'default');
      const list = map.get(gId) ?? [];
      list.push(lead);
      map.set(gId, list);
    }
    return map;
  }, [groups, leads]);

  const updateLead = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      api.patch<LeadResponse>(LEAD_PATHS.lead(id), data),
    onSuccess: refresh,
  });

  const updateFailure = updateLead.error instanceof ApiFailure ? updateLead.error : undefined;
  const updateFailureMsg = updateFailure
    ? (updateFailure.fields.email || updateFailure.fields.phone || updateFailure.fields.name || updateFailure.message)
    : undefined;

  // The selection checkboxes existed with nothing to spend a selection on. These are what
  // they are for. There is no bulk endpoint, so a bulk act is the same write repeated — fine
  // at a board's scale, and it means a partial failure still leaves the rest applied.
  const bulkUpdate = useMutation({
    mutationFn: async ({ ids, data }: { ids: string[]; data: Record<string, unknown> }) => {
      await Promise.all(ids.map((id) => api.patch<LeadResponse>(LEAD_PATHS.lead(id), data)));
    },
    onSuccess: refresh,
  });

  const bulkDelete = useMutation({
    mutationFn: async (ids: string[]) => {
      await Promise.all(ids.map((id) => api.delete(LEAD_PATHS.lead(id))));
    },
    onSuccess: () => {
      setSelectedLeadIds(new Set());
      refresh();
    },
  });

  const bulkFailure = [bulkUpdate.error, bulkDelete.error].find((e) => e instanceof ApiFailure);
  const bulkFailureMsg = bulkFailure instanceof ApiFailure ? bulkFailure.message : undefined;

  // A selection outlives the rows it was made on — a filter change, a group move — so the bar
  // counts what is actually still on the board rather than what was once ticked.
  const selectedIds = useMemo(
    () => leads.filter((lead) => selectedLeadIds.has(lead.id)).map((lead) => lead.id),
    [leads, selectedLeadIds],
  );

  const cleanDuplicates = useMutation({
    mutationFn: () => api.post<{ removedCount: number }>('/api/crm/leads/clean-duplicates', {}),
    onSuccess: (data) => {
      refresh();
      if (data.removedCount > 0) {
        alert(`Successfully removed ${data.removedCount} duplicate lead(s)!`);
      } else {
        alert('No duplicate leads found on your board!');
      }
    },
  });

  // Filter groups to display
  const selectedGroupFilter = query.filters?.[LEAD_FIELDS.groupId];
  const isFiltered = Boolean(
    selectedGroupFilter ||
    query.search ||
    query.filters?.[LEAD_FIELDS.source] ||
    query.filters?.[LEAD_FIELDS.status] ||
    query.filters?.[LEAD_FIELDS.assignedToUserId],
  );

  const displayGroups = useMemo(() => {
    let list = groups.length > 0 ? groups : [{ id: 'default', name: 'Leads', color: '#0284c7', leadCount: leads.length }];

    if (selectedGroupFilter) {
      list = list.filter((g) => g.id === selectedGroupFilter);
    } else if (isFiltered) {
      list = list.filter((g) => (groupedLeads.get(g.id)?.length ?? 0) > 0);
    }
    return list;
  }, [groups, leads.length, selectedGroupFilter, isFiltered, groupedLeads]);

  function toggleGroupCollapse(groupId: string) {
    setCollapsedGroups((prev) => ({ ...prev, [groupId]: !prev[groupId] }));
  }

  return (
    <div className="flex flex-col gap-6 p-2 max-w-[1600px] mx-auto">
      {/* Page header — identity and the primary action lead on the left, tools sit on the right */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-slate-200/80 pb-4">
        <h1 className="text-lg font-bold tracking-tight text-slate-900">Leads</h1>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold tabular-nums text-slate-600">
          {leads.length}
        </span>

        {canWrite && (
          <CreateSplitButton
            onNewLead={() => {
              const targetGroup = selectedGroupFilter || groups[0]?.id || 'default';
              setAddingLeadInGroup(targetGroup);
            }}
            onNewGroup={() => setBoardSetupTab('groups')}
            onNewSource={() => setBoardSetupTab('sources')}
          />
        )}

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setIsImportOpen(true)}
            className={TOOLBAR_BUTTON}
          >
            <span aria-hidden="true">⬆</span> Import spreadsheet
          </button>

          <ToolbarMenu
            label="Outreach"
            items={[
              { label: 'Mailboxes', icon: '📧', onClick: () => setIsMailboxesOpen(true) },
              { label: 'Email templates', icon: '📋', onClick: () => setIsTemplatesOpen(true) },
              { label: 'Web form', icon: '🌐', onClick: () => setIsWebFormOpen(true) },
            ]}
          />

          <ToolbarMenu
            label="Board"
            items={[
              { label: 'Choose columns', icon: '▦', onClick: () => setIsColumnsOpen(true) },
              { label: 'Edit labels', icon: '🏷', onClick: () => setIsLabelsOpen(true) },
              { label: 'Board setup', icon: '⚙', onClick: () => setBoardSetupTab('groups') },
              ...(canWrite
                ? [
                    {
                      label: cleanDuplicates.isPending ? 'Cleaning...' : 'Clean duplicates',
                      icon: '✨',
                      onClick: () => cleanDuplicates.mutate(),
                      disabled: cleanDuplicates.isPending,
                      separated: true,
                    },
                  ]
                : []),
            ]}
          />
        </div>
      </div>

      {/* Filters — one compact row: search, then the narrowing selects, then an escape hatch */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200/80 bg-white p-3 shadow-2xs">
        <div className="relative min-w-[240px] flex-1">
          <span aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">
            🔍
          </span>
          <input
            type="search"
            aria-label="Search leads"
            placeholder="Search by name, organisation or email..."
            value={query.search ?? ''}
            onChange={(e) => setQuery({ ...query, search: e.target.value || undefined })}
            className="w-full rounded-lg border border-slate-200 bg-white py-1.5 pl-8 pr-3 text-xs text-slate-900 placeholder:text-slate-400 focus:border-teal-500 focus:outline-none"
          />
        </div>

        <div className="h-5 w-px bg-slate-200" aria-hidden="true" />

        <select
          aria-label="Group"
          value={query.filters?.[LEAD_FIELDS.groupId] ?? ''}
          onChange={(e) => setQuery(narrowed(query, LEAD_FIELDS.groupId, e.target.value))}
          className={filterSelectClass(query.filters?.[LEAD_FIELDS.groupId])}
        >
          <option value="">All groups</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>

        <select
          aria-label="Source"
          value={query.filters?.[LEAD_FIELDS.source] ?? ''}
          onChange={(e) => setQuery(narrowed(query, LEAD_FIELDS.source, e.target.value))}
          className={filterSelectClass(query.filters?.[LEAD_FIELDS.source])}
        >
          <option value="">All sources</option>
          {sources.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
          {LEAD_SOURCES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>

        <select
          aria-label="Status"
          value={query.filters?.[LEAD_FIELDS.status] ?? ''}
          onChange={(e) => setQuery(narrowed(query, LEAD_FIELDS.status, e.target.value))}
          className={filterSelectClass(query.filters?.[LEAD_FIELDS.status])}
        >
          <option value="">All statuses</option>
          {statusLabels.list.map((item) => (
            <option key={item.status} value={item.status}>
              {item.label}
            </option>
          ))}
        </select>

        <select
          aria-label="Owner"
          value={query.filters?.[LEAD_FIELDS.assignedToUserId] ?? ''}
          onChange={(e) => setQuery(narrowed(query, LEAD_FIELDS.assignedToUserId, e.target.value))}
          className={filterSelectClass(query.filters?.[LEAD_FIELDS.assignedToUserId])}
        >
          <option value="">All owners</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
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

      {(failure || updateFailureMsg || bulkFailureMsg) && (
        <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3.5 text-xs font-medium text-rose-700">
          {failure?.message || updateFailureMsg || bulkFailureMsg}
        </div>
      )}

      {selectedIds.length > 0 && canWrite && (
        <BulkActionBar
          count={selectedIds.length}
          groups={groups}
          users={users}
          isBusy={bulkUpdate.isPending || bulkDelete.isPending}
          onAssign={(userId) => bulkUpdate.mutate({ ids: selectedIds, data: { assignedToUserId: userId } })}
          onMove={(groupId) => bulkUpdate.mutate({ ids: selectedIds, data: { groupId } })}
          onDelete={() => bulkDelete.mutate(selectedIds)}
          onClear={() => setSelectedLeadIds(new Set())}
        />
      )}

      {leads.length === 0 && !leadsQuery.isLoading && (
        <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/50 p-8 text-center">
          <p className="text-sm font-semibold text-slate-700">Your board is empty.</p>
          <p className="mt-1 text-xs text-slate-500">Create your first lead to get started.</p>
        </div>
      )}

      {/* Board Group Sections with Drag & Drop & Blue Accent Bar (Matching Screenshot-1) */}
      <div className="flex flex-col gap-6">
        {displayGroups.map((group, displayGroupIndex) => {
          const groupLeadItems = groupedLeads.get(group.id) ?? [];
          const isAddingInThisGroup =
            addingLeadInGroup === group.id ||
            (addingLeadInGroup === undefined && displayGroupIndex === 0);
          const isCollapsed = collapsedGroups[group.id] ?? false;

          const isAllGroupSelected =
            groupLeadItems.length > 0 &&
            groupLeadItems.every((l) => selectedLeadIds.has(l.id));
          const isSomeGroupSelected =
            groupLeadItems.some((l) => selectedLeadIds.has(l.id)) && !isAllGroupSelected;

          return (
            <section
              key={group.id}
              aria-labelledby={`group-${group.id}`}
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
              }}
              onDrop={(e) => {
                e.preventDefault();
                const leadId = e.dataTransfer.getData('text/plain');
                if (leadId && group.id !== 'default') {
                  const targetLead = leads.find((l) => l.id === leadId);
                  if (targetLead && targetLead.groupId !== group.id) {
                    updateLead.mutate({ id: leadId, data: { groupId: group.id } });
                  }
                }
              }}
              className="relative border-l-4 border-l-blue-500 flex flex-col gap-4 rounded-r-xl border-y border-r border-slate-200/90 bg-white p-4 sm:p-5 shadow-2xs overflow-hidden"
            >
              {/* Group Header Title & Count Badge */}
              <div className="flex items-center">
                <button
                  type="button"
                  onClick={() => toggleGroupCollapse(group.id)}
                  className="flex items-center gap-2 text-left group/title focus:outline-none"
                >
                  <span className="text-slate-400 text-xs font-bold transition group-hover/title:text-slate-600">
                    {isCollapsed ? '►' : '▾'}
                  </span>
                  <h2 id={`group-${group.id}`} role="heading" className="text-base font-bold text-[#0080ff]">
                    {group.name}
                  </h2>
                  <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-bold text-slate-600">
                    {groupLeadItems.length} leads
                  </span>
                </button>
              </div>

              {/* Group Table - Matching Screenshot-1 Headers & Layout */}
              {!isCollapsed && (
                <div className="overflow-x-auto">
                  <table
                    className="w-full table-fixed border-collapse text-left text-xs"
                    style={{ minWidth: tableMinWidth }}
                  >
                    <colgroup>
                      {columns.map((column) => (
                        <col
                          key={column.key}
                          style={column.width ? { width: `${column.width}px` } : undefined}
                        />
                      ))}
                    </colgroup>
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50/70 text-slate-600">
                        {columns.map((column) =>
                          column.key === 'select' ? (
                            <th key={column.key} scope="col" className="py-3 px-3 text-center">
                              <input
                                type="checkbox"
                                aria-label={`Select all leads in ${group.name}`}
                                checked={isAllGroupSelected}
                                ref={(el) => {
                                  if (el) el.indeterminate = isSomeGroupSelected;
                                }}
                                onChange={() => {
                                  setSelectedLeadIds((prev) => {
                                    const next = new Set(prev);
                                    const allSelected = groupLeadItems.every((l) => next.has(l.id));
                                    if (allSelected) {
                                      groupLeadItems.forEach((l) => next.delete(l.id));
                                    } else {
                                      groupLeadItems.forEach((l) => next.add(l.id));
                                    }
                                    return next;
                                  });
                                }}
                                className="rounded border-slate-300 text-teal-600 focus:ring-teal-500 cursor-pointer"
                              />
                            </th>
                          ) : (
                            <th
                              key={column.key}
                              scope="col"
                              className={`py-3 px-4 font-bold ${cellAlign(column)}`}
                            >
                              {column.label}
                            </th>
                          ),
                        )}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {/* The new row sits directly under the header, where the eye already is
                          after reading the column names — not at the far end of a long group. */}
                      {isAddingInThisGroup ? (
                        <InlineAddLeadRow
                          columns={columns}
                          groupId={group.id === 'default' ? undefined : group.id}
                          autoFocusTrigger={addingLeadInGroup}
                          onCancel={() => setAddingLeadInGroup(undefined)}
                          onAdded={refresh}
                        />
                      ) : (
                        canWrite && (
                          <tr>
                            <td />
                            <td className="py-2 px-4">
                              <button
                                type="button"
                                onClick={() => setAddingLeadInGroup(group.id)}
                                className="text-xs font-medium text-slate-500 transition hover:text-slate-800"
                              >
                                + Add a lead...
                              </button>
                            </td>
                            <td colSpan={columns.length - 2} />
                          </tr>
                        )
                      )}

                      {groupLeadItems.map((lead) => {
                        return (
                          <tr
                            key={lead.id}
                            draggable={canWrite}
                            onDragStart={(e) => {
                              e.dataTransfer.setData('text/plain', lead.id);
                              e.dataTransfer.effectAllowed = 'move';
                            }}
                            className="group/row cursor-move hover:bg-slate-50/80 transition-colors"
                          >
                            {columns.map((column) => {
                              switch (column.key) {
                                case 'select':
                                  return (
                                    <td key="select" className="py-3 px-3 align-middle text-center">
                                      <input
                                        type="checkbox"
                                        aria-label={`Select ${lead.name}`}
                                        checked={selectedLeadIds.has(lead.id)}
                                        onChange={() => {
                                          setSelectedLeadIds((prev) => {
                                            const next = new Set(prev);
                                            if (next.has(lead.id)) next.delete(lead.id);
                                            else next.add(lead.id);
                                            return next;
                                          });
                                        }}
                                        className="rounded border-slate-300 text-teal-600 focus:ring-teal-500 cursor-pointer"
                                      />
                                    </td>
                                  );

                                case 'lead':
                                  return (
                                    <td key="lead" className="py-3 px-4 align-middle">
                                      <div className="flex items-center gap-2 min-w-0">
                                        <span className="text-slate-300 font-mono text-xs cursor-grab shrink-0 select-none">
                                          ⠿
                                        </span>
                                        <button
                                          type="button"
                                          onClick={() => navigate(leadWorkspacePath(lead.id))}
                                          className="font-bold text-slate-900 hover:text-teal-700 hover:underline text-left truncate"
                                        >
                                          {lead.name}
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => navigate(leadWorkspacePath(lead.id))}
                                          title="Open lead details"
                                          aria-label={`Open ${lead.name}`}
                                          className="rounded p-0.5 text-slate-400 hover:text-sky-600 hover:bg-sky-50 shrink-0 font-bold"
                                        >
                                          ▤
                                        </button>
                                      </div>
                                    </td>
                                  );

                                case 'title':
                                  return (
                                    <td key="title" className="py-3 px-4 align-middle text-slate-600">
                                      <EditableText
                                        value={String(lead.customValues?.title ?? '')}
                                        label={`Title of ${lead.name}`}
                                        placeholder="—"
                                        canWrite={canWrite}
                                        className="font-medium text-slate-900"
                                        onSave={(val: string) =>
                                          updateLead.mutate({
                                            id: lead.id,
                                            data: { customValues: { ...(lead.customValues ?? {}), title: val } },
                                          })
                                        }
                                      />
                                    </td>
                                  );

                                case 'type':
                                  return (
                                    <td key="type" className="py-3 px-4 align-middle text-slate-600">
                                      <EditableText
                                        value={String(lead.customValues?.type ?? '')}
                                        label={`Type of ${lead.name}`}
                                        placeholder="—"
                                        canWrite={canWrite}
                                        className="font-bold text-emerald-700"
                                        onSave={(val: string) =>
                                          updateLead.mutate({
                                            id: lead.id,
                                            data: { customValues: { ...(lead.customValues ?? {}), type: val } },
                                          })
                                        }
                                      />
                                    </td>
                                  );

                                case 'company':
                                  return (
                                    <td key="company" className="py-3 px-4 align-middle text-slate-600">
                                      <EditableText
                                        value={lead.organisationName ?? ''}
                                        label={`Organisation of ${lead.name}`}
                                        icon="🏢"
                                        canWrite={canWrite}
                                        className="font-medium text-slate-900"
                                        onSave={(val: string) =>
                                          updateLead.mutate({ id: lead.id, data: { organisationName: val } })
                                        }
                                      />
                                    </td>
                                  );

                                case 'status':
                                  return (
                                    <td key="status" className="py-3 px-4 align-middle text-center">
                                      <StatusPicker
                                        status={lead.status}
                                        leadName={lead.name}
                                        canWrite={canWrite}
                                        onChange={(status) =>
                                          updateLead.mutate({ id: lead.id, data: { status } })
                                        }
                                      />
                                    </td>
                                  );

                                case 'priority':
                                  return (
                                    <td key="priority" className="py-3 px-4 align-middle text-center">
                                      <select
                                        value={String(lead.customValues?.priority || 'medium')}
                                        disabled={!canWrite}
                                        onChange={(e) =>
                                          updateLead.mutate({
                                            id: lead.id,
                                            data: { customValues: { ...(lead.customValues ?? {}), priority: e.target.value } },
                                          })
                                        }
                                        className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 font-medium shadow-2xs outline-none focus:border-slate-400 disabled:opacity-60"
                                      >
                                        <option value="high">🔴 High</option>
                                        <option value="medium">🟡 Medium</option>
                                        <option value="low">🔵 Low</option>
                                      </select>
                                    </td>
                                  );

                                case 'owner':
                                  return (
                                    <td key="owner" className="py-3 px-4 align-middle">
                                      <OwnerPicker
                                        leadName={lead.name}
                                        users={users}
                                        value={lead.assignedToUserId}
                                        canWrite={canWrite}
                                        onChange={(assignedToUserId) =>
                                          updateLead.mutate({ id: lead.id, data: { assignedToUserId } })
                                        }
                                      />
                                    </td>
                                  );

                                case 'deals':
                                  return (
                                    <td key="deals" className="py-3 px-4 align-middle text-slate-500 font-medium">
                                      {lead.partyId ? (
                                        <span className="text-xs font-semibold text-emerald-700">Contact created ↗</span>
                                      ) : (
                                        <span className="text-xs text-slate-400">No deals</span>
                                      )}
                                    </td>
                                  );

                                case 'convert':
                                  return (
                                    <td key="convert" className="py-3 px-4 align-middle text-center">
                                      {lead.partyId ? (
                                        <button
                                          type="button"
                                          onClick={() => navigate('/crm/contacts')}
                                          title="View Contact on Contacts board"
                                          className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-emerald-300 bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700 transition-colors hover:border-emerald-400 hover:bg-emerald-100 shadow-2xs cursor-pointer"
                                        >
                                          Contact created ↗
                                        </button>
                                      ) : (
                                        <button
                                          type="button"
                                          onClick={() => setConvertLead(lead)}
                                          className="whitespace-nowrap rounded-md bg-[#107c41] px-3.5 py-1 text-xs font-bold text-white shadow-2xs transition-colors hover:bg-[#0c6233]"
                                        >
                                          Move to Contacts
                                        </button>
                                      )}
                                    </td>
                                  );

                                case 'email':
                                  return (
                                    <td key="email" className="py-3 px-4 align-middle text-slate-600">
                                      <EditableText
                                        value={lead.email ?? ''}
                                        label={`Email of ${lead.name}`}
                                        type="email"
                                        icon="✉️"
                                        canWrite={canWrite}
                                        href={(val: string) => `mailto:${val}`}
                                        className="text-sky-600 font-medium hover:underline"
                                        onSave={(val: string) =>
                                          updateLead.mutate({ id: lead.id, data: { email: val } })
                                        }
                                      />
                                    </td>
                                  );

                                case 'phone':
                                  return (
                                    <td key="phone" className="py-3 px-4 align-middle text-slate-600">
                                      <EditableText
                                        value={lead.phone ?? ''}
                                        label={`Phone of ${lead.name}`}
                                        type="tel"
                                        icon="📞"
                                        canWrite={canWrite}
                                        className="text-slate-700 font-medium"
                                        onSave={(val: string) =>
                                          updateLead.mutate({ id: lead.id, data: { phone: val } })
                                        }
                                      />
                                    </td>
                                  );

                                case 'source':
                                  return (
                                    <td key="source" className="py-3 px-4 align-middle text-slate-500 font-medium">
                                      {lead.sourceName || lead.source || '—'}
                                    </td>
                                  );

                                case 'actions':
                                  return <td key="actions" className="py-3 px-4 text-right align-middle" />;

                                default: {
                                  const field = customFields.find((f) => fieldColumnKey(f) === column.key);
                                  if (!field) return <td key={column.key} className="py-3 px-4" />;
                                  return (
                                    <td key={field.id} className="py-3 px-4 align-middle text-slate-600">
                                      <CustomFieldCell
                                        field={field}
                                        values={lead.customValues ?? {}}
                                        leadName={lead.name}
                                        canWrite={canWrite}
                                        onSave={(nextValues: LeadCustomValues) =>
                                          updateLead.mutate({
                                            id: lead.id,
                                            data: {
                                              customValues: nextValues,
                                            },
                                          })
                                        }
                                      />
                                    </td>
                                  );
                                }
                              }
                            })}
                          </tr>
                        );
                      })}
                    </tbody>

                    {/* Footer row — inside the table, so the columns chooser lines up under
                        the last column instead of floating beneath the board. */}
                    <tfoot>
                      <tr className="border-t border-slate-100 bg-slate-50/60 text-slate-500">
                        <td colSpan={columns.length - 1} />
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

      {/* Modals */}
      {convertLead && (
        <ConvertLeadModal
          lead={convertLead}
          onClose={() => setConvertLead(undefined)}
          onConverted={() => {
            setConvertLead(undefined);
            refresh();
          }}
        />
      )}

      {isMailboxesOpen && (
        <MailboxesModal isOpen={true} onClose={() => setIsMailboxesOpen(false)} />
      )}

      {isTemplatesOpen && (
        <EmailTemplatesModal isOpen={true} onClose={() => setIsTemplatesOpen(false)} />
      )}

      {isWebFormOpen && (
        <WebFormModal isOpen={true} onClose={() => setIsWebFormOpen(false)} />
      )}

      {isImportOpen && (
        <SpreadsheetImportModal
          isOpen={true}
          onClose={() => setIsImportOpen(false)}
          onSuccess={refresh}
        />
      )}

      {isLabelsOpen && (
        <StatusLabelsModal onClose={() => setIsLabelsOpen(false)} />
      )}

      {boardSetupTab && (
        <BoardSetupModal initialTab={boardSetupTab} onClose={() => setBoardSetupTab(undefined)} />
      )}

      {isColumnsOpen && (
        <ColumnsModal
          fields={customFields}
          isVisible={visible}
          onToggle={toggle}
          onClose={() => setIsColumnsOpen(false)}
        />
      )}
    </div>
  );
}


/** Shared look for the secondary toolbar controls, so buttons and menu triggers stay identical. */
const TOOLBAR_BUTTON =
  'inline-flex items-center gap-1.5 rounded-lg border border-slate-200/80 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-2xs transition hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-1';

/** A filter select reads as active once it narrows the board, so the applied filters are visible at a glance. */
function filterSelectClass(value: string | undefined) {
  const base =
    'rounded-lg border px-2.5 py-1.5 text-xs font-medium shadow-2xs focus:outline-none focus:border-teal-500 cursor-pointer';
  return value
    ? `${base} border-teal-500 bg-teal-50 text-teal-800`
    : `${base} border-slate-200 bg-white text-slate-700`;
}

/**
 * The Owner cell: who on the team this lead is theirs to chase.
 *
 * A native select rather than the popover the status cell uses, because unlike statuses the
 * list of people is not something this screen may add to — there is nothing to create, rename
 * or recolour here, only one of a fixed set to pick. A select gets that right for free, in
 * every browser, with the keyboard already working.
 *
 * "Unassigned" is a real choice and not just the empty state: taking a lead off somebody is as
 * ordinary an act as giving it to them, and it sends `null` rather than an empty string, which
 * is what the API distinguishes "clear this" by.
 */
function OwnerPicker({
  leadName,
  users,
  value,
  canWrite,
  onChange,
}: {
  leadName: string;
  users: { id: string; name: string; email?: string }[];
  value: string | null;
  canWrite: boolean;
  onChange: (assignedToUserId: string | null) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [showTip, setShowTip] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedUser = useMemo(
    () => users.find((u) => u.id === value),
    [users, value],
  );

  const filteredUsers = useMemo(() => {
    if (!search.trim()) return users;
    const q = search.toLowerCase().trim();
    return users.filter(
      (u) =>
        u.name.toLowerCase().includes(q) ||
        (u.email && u.email.toLowerCase().includes(q)),
    );
  }, [users, search]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  const avatarBg = (name: string) => {
    const colors = [
      'bg-emerald-100 text-emerald-800 border-emerald-200',
      'bg-teal-100 text-teal-800 border-teal-200',
      'bg-sky-100 text-sky-800 border-sky-200',
      'bg-indigo-100 text-indigo-800 border-indigo-200',
      'bg-purple-100 text-purple-800 border-purple-200',
      'bg-amber-100 text-amber-800 border-amber-200',
    ];
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
    return colors[Math.abs(hash) % colors.length];
  };

  const getInitials = (name: string) => {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    const p0 = parts[0];
    const p1 = parts[1];
    if (parts.length >= 2 && p0 && p1 && p0[0] && p1[0]) {
      return `${p0[0]}${p1[0]}`.toUpperCase();
    }
    return (name.trim()[0] || 'U').toUpperCase();
  };

  return (
    <div ref={containerRef} className="relative inline-block text-left w-full">
      {/* Hidden select for accessibility & automated tests */}
      <select
        aria-label={`Owner of ${leadName}`}
        value={value ?? ''}
        disabled={!canWrite}
        onChange={(e) => onChange(e.target.value || null)}
        className="sr-only"
        tabIndex={-1}
      >
        <option value="">Unassigned</option>
        {users.map((user) => (
          <option key={user.id} value={user.id}>
            {user.name}
          </option>
        ))}
      </select>

      {/* Trigger Button Matching Screenshot-2 */}
      <button
        type="button"
        disabled={!canWrite}
        onClick={() => setIsOpen((prev) => !prev)}
        className={`group flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium transition-all focus:outline-none ${
          selectedUser
            ? 'bg-slate-50 hover:bg-slate-100 text-slate-800 border border-slate-200 shadow-2xs'
            : 'text-slate-500 hover:bg-slate-100 border border-dashed border-slate-300 hover:border-slate-400'
        }`}
      >
        {selectedUser ? (
          <>
            <span
              className={`w-5 h-5 rounded-full border flex items-center justify-center font-bold text-[10px] shrink-0 ${avatarBg(
                selectedUser.name,
              )}`}
            >
              {getInitials(selectedUser.name)}
            </span>
            <span className="truncate max-w-[100px]">{selectedUser.name}</span>
            <svg
              className="w-3 h-3 text-slate-400 group-hover:text-slate-600 transition-transform"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </>
        ) : (
          <>
            <div className="relative flex items-center justify-center w-5 h-5 rounded-full border border-slate-300 bg-slate-50 text-slate-400 group-hover:text-teal-600 group-hover:border-teal-400 transition-colors">
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                />
              </svg>
              <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-teal-500 text-white text-[8px] font-bold flex items-center justify-center">
                +
              </span>
            </div>
            <span className="text-slate-400 group-hover:text-slate-600">Unassigned</span>
            <svg
              className="w-3 h-3 text-slate-400 group-hover:text-slate-600"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </>
        )}
      </button>

      {/* Floating Popover Matching Screenshot-3 */}
      {isOpen && (
        <div className="absolute left-0 z-50 mt-1.5 w-72 rounded-xl bg-white p-3 text-left shadow-2xl ring-1 ring-black/5 border border-slate-200">
          {/* Search Box */}
          <div className="relative mb-2.5">
            <input
              type="text"
              autoFocus
              placeholder="Search names, roles or teams"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-lg border border-teal-500/70 bg-white py-1.5 pl-3 pr-8 text-xs text-slate-800 placeholder-slate-400 shadow-2xs focus:border-teal-600 focus:outline-none focus:ring-1 focus:ring-teal-500"
            />
            <svg
              className="absolute right-2.5 top-2.5 h-3.5 w-3.5 text-slate-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
          </div>

          {/* Section Header */}
          <div className="mb-1 px-1 py-1 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
            Suggested people
          </div>

          {/* User List */}
          <div className="max-h-52 overflow-y-auto space-y-0.5 pr-0.5">
            {/* Unassign option */}
            <button
              type="button"
              onClick={() => {
                onChange(null);
                setIsOpen(false);
              }}
              className={`w-full flex items-center justify-between px-2.5 py-2 rounded-lg text-xs transition-colors ${
                !value
                  ? 'bg-teal-50 text-teal-900 font-semibold'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              <div className="flex items-center gap-2.5">
                <span className="w-6 h-6 rounded-full border border-dashed border-slate-300 flex items-center justify-center text-slate-400 text-xs">
                  ✕
                </span>
                <span>Unassigned</span>
              </div>
              {!value && (
                <svg className="w-4 h-4 text-teal-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              )}
            </button>

            {filteredUsers.map((user) => {
              const isSelected = user.id === value;
              return (
                <button
                  key={user.id}
                  type="button"
                  onClick={() => {
                    onChange(user.id);
                    setIsOpen(false);
                  }}
                  className={`w-full flex items-center justify-between px-2.5 py-2 rounded-lg text-xs transition-colors ${
                    isSelected
                      ? 'bg-teal-50 text-teal-900 font-semibold'
                      : 'text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span
                      className={`w-6 h-6 rounded-full border flex items-center justify-center font-bold text-[10px] shrink-0 ${avatarBg(
                        user.name,
                      )}`}
                    >
                      {getInitials(user.name)}
                    </span>
                    <div className="flex flex-col text-left truncate">
                      <span className="truncate font-medium">{user.name}</span>
                      {user.email && (
                        <span className="text-[10px] text-slate-400 truncate">{user.email}</span>
                      )}
                    </div>
                  </div>
                  {isSelected && (
                    <svg className="w-4 h-4 text-teal-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </button>
              );
            })}

            {filteredUsers.length === 0 && search.trim() !== '' && (
              <div className="px-3 py-4 text-center text-xs text-slate-400">No matching members found</div>
            )}
          </div>

          {/* Action Row */}
          <div className="mt-2 pt-2 border-t border-slate-100">
            <button
              type="button"
              onClick={() => {
                setIsOpen(false);
              }}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition-colors"
            >
              <svg className="w-3.5 h-3.5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z"
                />
              </svg>
              <span>Invite a new member by email</span>
            </button>
          </div>

          {/* Bottom Tip Box Matching Screenshot-3 */}
          {showTip && (
            <div className="mt-2.5 bg-[#d8f3f0]/90 border border-teal-200 text-teal-900 text-[11px] px-3 py-2 rounded-lg flex items-center justify-between font-medium shadow-2xs">
              <span className="flex items-center gap-1">
                Hold{' '}
                <kbd className="px-1.5 py-0.5 bg-white border border-teal-300 rounded text-[10px] font-mono shadow-2xs font-bold text-slate-700">
                  Ctrl
                </kbd>{' '}
                for a multiple selection
              </span>
              <button
                type="button"
                onClick={() => setShowTip(false)}
                className="text-teal-600 hover:text-teal-900 ml-2 font-bold"
              >
                ✕
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * What a selection is for.
 *
 * Reassigning forty leads after somebody leaves, or clearing out an import that went in wrong,
 * is the reason a person ticks forty boxes — and until this bar existed the ticks did nothing
 * at all. It appears only with a selection and sticks to the top of the board, because the rows
 * being acted on are usually scrolled past by the time the decision is made.
 *
 * Delete asks twice. Every other act here is reversible by repeating it with a different value;
 * that one is not, and it is one careless click away from the whole board.
 */
/** Taking a lead off somebody is a choice, not the absence of one, so it needs a value of its own
 *  — sharing the placeholder's empty string would make the two indistinguishable to the select. */
const UNASSIGN = '__unassign__';

function BulkActionBar({
  count,
  groups,
  users,
  isBusy,
  onAssign,
  onMove,
  onDelete,
  onClear,
}: {
  count: number;
  groups: { id: string; name: string }[];
  users: { id: string; name: string }[];
  isBusy: boolean;
  onAssign: (userId: string | null) => void;
  onMove: (groupId: string) => void;
  onDelete: () => void;
  onClear: () => void;
}) {
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);

  // A confirmation is for the selection it was asked about. Change the selection and it lapses.
  useEffect(() => setIsConfirmingDelete(false), [count]);

  return (
    <div className="sticky top-2 z-30 flex flex-wrap items-center gap-2 rounded-xl border border-teal-200 bg-teal-50/95 p-2.5 shadow-xs backdrop-blur-xs">
      <span className="px-1 text-xs font-bold text-teal-900">
        {count} {count === 1 ? 'lead' : 'leads'} selected
      </span>

      <select
        aria-label="Assign selected leads to"
        value=""
        disabled={isBusy}
        onChange={(event) => event.target.value && onAssign(event.target.value === UNASSIGN ? null : event.target.value)}
        className="cursor-pointer rounded-lg border border-teal-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 focus:border-teal-600 focus:outline-none disabled:opacity-50"
      >
        <option value="" disabled>
          Assign owner...
        </option>
        <option value={UNASSIGN}>Unassigned</option>
        {users.map((user) => (
          <option key={user.id} value={user.id}>
            {user.name}
          </option>
        ))}
      </select>

      <select
        aria-label="Move selected leads to group"
        value=""
        disabled={isBusy || groups.length === 0}
        onChange={(event) => event.target.value && onMove(event.target.value)}
        className="cursor-pointer rounded-lg border border-teal-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 focus:border-teal-600 focus:outline-none disabled:opacity-50"
      >
        <option value="" disabled>
          Move to group...
        </option>
        {groups.map((group) => (
          <option key={group.id} value={group.id}>
            {group.name}
          </option>
        ))}
      </select>

      {isConfirmingDelete ? (
        <span className="flex items-center gap-2 rounded-lg border border-rose-300 bg-white px-2.5 py-1 text-xs font-semibold text-rose-700">
          Delete {count} for good?
          <button
            type="button"
            onClick={onDelete}
            disabled={isBusy}
            className="rounded-md bg-rose-600 px-2.5 py-1 text-xs font-bold text-white transition hover:bg-rose-700 disabled:opacity-50"
          >
            {isBusy ? 'Deleting...' : 'Delete'}
          </button>
          <button
            type="button"
            onClick={() => setIsConfirmingDelete(false)}
            className="font-medium text-slate-500 hover:text-slate-700"
          >
            Keep
          </button>
        </span>
      ) : (
        <button
          type="button"
          onClick={() => setIsConfirmingDelete(true)}
          disabled={isBusy}
          className="rounded-lg border border-rose-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-rose-700 transition hover:bg-rose-50 disabled:opacity-50"
        >
          Delete
        </button>
      )}

      <button
        type="button"
        onClick={onClear}
        className="ml-auto rounded-lg px-2.5 py-1.5 text-xs font-semibold text-teal-800 transition hover:bg-teal-100"
      >
        Clear selection
      </button>
    </div>
  );
}

/** Which way a column reads, so header, body and footer agree without repeating the string. */
function cellAlign(column: BoardColumn): string {
  if (column.align === 'center') return 'text-center';
  if (column.align === 'right') return 'text-right';
  return '';
}

/** Closes a popover on an outside press or on Escape — what every menu on this page needs. */
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

type ToolbarMenuItem = {
  label: string;
  icon?: string;
  onClick: () => void;
  disabled?: boolean;
  /** Draws a rule above the item, separating it from the group before it. */
  separated?: boolean;
};

/** The dropped panel itself. One copy, so every menu on the page dismisses and reads alike. */
function MenuPanel({
  items,
  onPicked,
  align = 'right',
}: {
  items: ToolbarMenuItem[];
  onPicked: () => void;
  align?: 'left' | 'right';
}) {
  return (
    <div
      role="menu"
      className={`absolute ${align === 'left' ? 'left-0' : 'right-0'} z-20 mt-1.5 w-52 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-lg`}
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
          <span aria-hidden="true" className="w-4 text-center text-slate-400">
            {item.icon}
          </span>
          {item.label}
        </button>
      ))}
    </div>
  );
}

/** Groups low-frequency toolbar actions behind one trigger, so the primary action keeps the visual weight. */
function ToolbarMenu({ label, items }: { label: string; items: ToolbarMenuItem[] }) {
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

/**
 * The board's create control: a lead in one click, its two setup lists behind the caret.
 *
 * A lead is what people come here to add, dozens of times a day; a group or a source is added
 * once a quarter and then lived with. Putting all three in a plain dropdown would tax the
 * frequent act to shorten the rare one — so the button keeps doing the frequent thing directly,
 * and the caret is where the two rarer ones live, next to it rather than three clicks away
 * under Board setup.
 */
function CreateSplitButton({
  onNewLead,
  onNewGroup,
  onNewSource,
}: {
  onNewLead: () => void;
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
          onClick={onNewLead}
          className="inline-flex items-center gap-1.5 bg-[#008080] px-4 py-1.5 text-xs font-bold text-white transition hover:bg-[#006666] focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2"
        >
          <span aria-hidden="true" className="text-sm leading-none">+</span> New Lead
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
            { label: 'New group', icon: '▤', onClick: onNewGroup },
            { label: 'New source', icon: '⇢', onClick: onNewSource },
          ]}
        />
      )}
    </div>
  );
}

/** Inline row for creating a new lead directly in the table. */
function InlineAddLeadRow({
  columns,
  groupId,
  autoFocusTrigger,
  onCancel,
  onAdded,
}: {
  columns: BoardColumn[];
  groupId?: string;
  autoFocusTrigger?: string;
  onCancel: () => void;
  onAdded: () => void;
}) {
  const [name, setName] = useState(() => {
    try {
      const saved = localStorage.getItem('erp_autosave_inline_lead');
      if (saved) return JSON.parse(saved).name || '';
    } catch {}
    return '';
  });
  const [email, setEmail] = useState(() => {
    try {
      const saved = localStorage.getItem('erp_autosave_inline_lead');
      if (saved) return JSON.parse(saved).email || '';
    } catch {}
    return '';
  });
  const [phone, setPhone] = useState(() => {
    try {
      const saved = localStorage.getItem('erp_autosave_inline_lead');
      if (saved) return JSON.parse(saved).phone || '';
    } catch {}
    return '';
  });

  useEffect(() => {
    if (name || email || phone) {
      localStorage.setItem('erp_autosave_inline_lead', JSON.stringify({ name, email, phone }));
    } else {
      localStorage.removeItem('erp_autosave_inline_lead');
    }
  }, [name, email, phone]);

  const add = useMutation({
    mutationFn: () =>
      api.post<LeadResponse>(LEAD_PATHS.leads, {
        name,
        ...(groupId ? { groupId } : {}),
        ...(email ? { email } : {}),
        ...(phone ? { phone } : {}),
      } satisfies CreateLeadRequest),
    onSuccess: () => {
      setName('');
      setEmail('');
      setPhone('');
      try {
        localStorage.removeItem('erp_autosave_inline_lead');
      } catch {}
      onAdded();
    },
  });

  const nameInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (autoFocusTrigger !== undefined) {
      nameInputRef.current?.focus();
    }
  }, [autoFocusTrigger]);

  const failure = add.error instanceof ApiFailure ? add.error : undefined;
  const failureMsg = failure
    ? (failure.fields.email || failure.fields.name || failure.fields.phone || failure.message)
    : undefined;

  const commit = () => {
    if (name.trim()) add.mutate();
  };
  const onFieldKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Enter') commit();
    if (event.key === 'Escape') onCancel();
  };

  return (
    <tr className="bg-sky-50/60">
      {columns.map((column) => {
        switch (column.key) {
          case 'select':
            return (
              <td key={column.key} className="py-3 px-3 text-center align-top">
                <span className="text-slate-300">—</span>
              </td>
            );

          case 'lead':
            return (
              <td key={column.key} className="py-3 px-4 align-top">
                <input
                  ref={nameInputRef}
                  type="text"
                  autoFocus
                  aria-label="Lead name"
                  placeholder="Lead name..."
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={onFieldKeyDown}
                  className="w-full rounded border border-sky-300 px-2.5 py-1 text-xs font-medium focus:outline-none"
                />
                {failureMsg && (
                  <p role="alert" className="mt-1 text-xs font-semibold text-rose-600">
                    {failureMsg}
                  </p>
                )}
              </td>
            );

          case 'status':
            return (
              <td key={column.key} className="py-3 px-4 text-center align-top">
                <span className="inline-flex w-32 items-center justify-center rounded-lg bg-sky-500 px-3 py-1 text-xs font-bold text-white">
                  New
                </span>
              </td>
            );

          case 'email':
            return (
              <td key={column.key} className="py-3 px-4 align-top">
                <input
                  type="email"
                  aria-label="Email"
                  placeholder="Email..."
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onKeyDown={onFieldKeyDown}
                  className="w-full rounded border border-slate-200 px-2.5 py-1 text-xs focus:outline-none"
                />
              </td>
            );

          case 'phone':
            return (
              <td key={column.key} className="py-3 px-4 align-top">
                <input
                  type="text"
                  aria-label="Phone"
                  placeholder="Phone..."
                  value={phone}
                  onChange={(e) => setPhone(e.target.value.replace(/\D/g, ''))}
                  onKeyDown={onFieldKeyDown}
                  className="w-full rounded border border-slate-200 px-2.5 py-1 text-xs focus:outline-none"
                />
              </td>
            );

          case 'actions':
            return (
              <td key={column.key} className="py-3 px-4 text-right align-top whitespace-nowrap">
                <button
                  type="button"
                  onClick={commit}
                  disabled={!name.trim() || add.isPending}
                  className="mr-2 rounded-md bg-[#107c41] px-3.5 py-1 text-xs font-bold text-white shadow-2xs hover:bg-[#0c6233] disabled:opacity-50"
                >
                  Save
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
              <td key={column.key} className="py-3 px-4 text-center align-top">
                <span className="text-xs text-slate-400">—</span>
              </td>
            );
        }
      })}
    </tr>
  );
}
