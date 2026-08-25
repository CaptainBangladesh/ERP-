import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  LEAD_FIELDS,
  LEAD_PATHS,
  LEAD_SOURCES,
  LEAD_STATUSES,
  IDENTITY_PATHS,
  listPath,
  listQueryString,
  narrowed,
  type CreateLeadRequest,
  type LeadCustomValues,
  type LeadListResponse,
  type LeadResponse,
  type LeadStatus,
  type LeadSummary,
  type ListQuery,
  type UserListResponse,
} from '@erp/shared';
import { ApiFailure, api } from '../../../api/client';
import { useSession } from '../../../session/SessionProvider';
import { hasPermission } from '../../../session/permissions';
import { LeadDetail } from '../components/LeadDetail';
import { BoardSetupModal } from '../components/BoardSetupModal';
import { ColumnsModal } from '../components/ColumnsModal';
import { ConvertLeadModal } from '../components/ConvertLeadModal';
import { CustomFieldCell } from '../components/CustomFieldCell';
import { EditableText } from '../components/EditableCell';
import { EmailTemplatesModal } from '../components/EmailTemplatesModal';
import { MailboxesModal } from '../components/MailboxesModal';
import { SpreadsheetImportModal } from '../components/SpreadsheetImportModal';
import { StatusLabelsModal } from '../components/StatusLabelsModal';
import { WebFormModal } from '../components/WebFormModal';
import { useVisibleColumns, fieldColumnKey } from '../columns';
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
  const [selectedId, setSelectedId] = useState<string>();
  const [convertLead, setConvertLead] = useState<LeadSummary>();
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});

  // Modals state
  const [isMailboxesOpen, setIsMailboxesOpen] = useState(false);
  const [isTemplatesOpen, setIsTemplatesOpen] = useState(false);
  const [isWebFormOpen, setIsWebFormOpen] = useState(false);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [isLabelsOpen, setIsLabelsOpen] = useState(false);
  const [isBoardSetupOpen, setIsBoardSetupOpen] = useState(false);
  const [isColumnsOpen, setIsColumnsOpen] = useState(false);
  const [addingLeadInGroup, setAddingLeadInGroup] = useState<string>();

  const queryClient = useQueryClient();
  const { visible, toggle } = useVisibleColumns();
  const { groups } = useLeadGroups();
  const { sources } = useLeadSources();
  const statusLabels = useLeadStatusLabels();
  const { all: customFields } = useLeadFields();

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

  const deleteLead = useMutation({
    mutationFn: (id: string) => api.delete(LEAD_PATHS.lead(id)),
    onSuccess: refresh,
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
      {/* Top Toolbar Action Buttons */}
      <div className="flex flex-wrap items-center justify-end gap-2 border-b border-slate-200/80 pb-4">
        <button
          type="button"
          onClick={() => setIsMailboxesOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200/80 bg-white px-3.5 py-1.5 text-xs font-semibold text-slate-700 shadow-2xs transition hover:bg-slate-50"
        >
          <span>📧</span> Mailboxes
        </button>
        <button
          type="button"
          onClick={() => setIsTemplatesOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200/80 bg-white px-3.5 py-1.5 text-xs font-semibold text-slate-700 shadow-2xs transition hover:bg-slate-50"
        >
          <span>📋</span> Templates
        </button>
        <button
          type="button"
          onClick={() => setIsWebFormOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200/80 bg-white px-3.5 py-1.5 text-xs font-semibold text-slate-700 shadow-2xs transition hover:bg-slate-50"
        >
          <span>🌐</span> Web form
        </button>
        <button
          type="button"
          onClick={() => setIsImportOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200/80 bg-white px-3.5 py-1.5 text-xs font-semibold text-slate-700 shadow-2xs transition hover:bg-slate-50"
        >
          Import spreadsheet
        </button>
        <button
          type="button"
          onClick={() => setIsLabelsOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200/80 bg-white px-3.5 py-1.5 text-xs font-semibold text-slate-700 shadow-2xs transition hover:bg-slate-50"
        >
          Edit labels
        </button>
        <button
          type="button"
          onClick={() => setIsBoardSetupOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200/80 bg-white px-3.5 py-1.5 text-xs font-semibold text-slate-700 shadow-2xs transition hover:bg-slate-50"
        >
          Board setup
        </button>

        {canWrite && (
          <button
            type="button"
            onClick={() => {
              const targetGroup = selectedGroupFilter || groups[0]?.id || 'default';
              setAddingLeadInGroup(targetGroup);
            }}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#008080] px-4 py-1.5 text-xs font-bold text-white shadow-xs transition hover:bg-[#006666]"
          >
            New Lead
          </button>
        )}
      </div>

      {/* Filter Toolbar Bar - Matching Original Layout (Stacked Labels + Selects Inline) */}
      <div className="flex flex-wrap items-end justify-between gap-4 rounded-xl border border-slate-200/80 bg-white p-4 shadow-2xs">
        {/* Search Input on the Left */}
        <div className="min-w-[240px] flex-1">
          <input
            type="text"
            placeholder="Search by name, organisation or email..."
            value={query.search ?? ''}
            onChange={(e) => setQuery({ ...query, search: e.target.value || undefined })}
            className="w-full rounded-lg border border-slate-200 bg-white px-3.5 py-1.5 text-xs text-slate-900 placeholder:text-slate-400 focus:border-teal-500 focus:outline-none"
          />
        </div>

        {/* 4 Stacked Label + Select Dropdowns Inline */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex flex-col gap-1 min-w-[120px]">
            <label className="text-xs font-bold text-slate-700">Group</label>
            <select
              value={query.filters?.[LEAD_FIELDS.groupId] ?? ''}
              onChange={(e) => setQuery(narrowed(query, LEAD_FIELDS.groupId, e.target.value))}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-2xs focus:border-teal-500 focus:outline-none cursor-pointer"
            >
              <option value="">All groups</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1 min-w-[120px]">
            <label className="text-xs font-bold text-slate-700">Source</label>
            <select
              value={query.filters?.[LEAD_FIELDS.source] ?? ''}
              onChange={(e) => setQuery(narrowed(query, LEAD_FIELDS.source, e.target.value))}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-2xs focus:border-teal-500 focus:outline-none cursor-pointer"
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
          </div>

          <div className="flex flex-col gap-1 min-w-[120px]">
            <label className="text-xs font-bold text-slate-700">Status</label>
            <select
              value={query.filters?.[LEAD_FIELDS.status] ?? ''}
              onChange={(e) => setQuery(narrowed(query, LEAD_FIELDS.status, e.target.value))}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-2xs focus:border-teal-500 focus:outline-none cursor-pointer"
            >
              <option value="">All statuses</option>
              {LEAD_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {statusLabels[s]?.label ?? s}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1 min-w-[120px]">
            <label className="text-xs font-bold text-slate-700">Owner</label>
            <select
              value={query.filters?.[LEAD_FIELDS.assignedToUserId] ?? ''}
              onChange={(e) => setQuery(narrowed(query, LEAD_FIELDS.assignedToUserId, e.target.value))}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-2xs focus:border-teal-500 focus:outline-none cursor-pointer"
            >
              <option value="">All owners</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {failure && (
        <div className="rounded-lg bg-rose-50 p-3.5 text-xs font-medium text-rose-700 border border-rose-200">{failure.message}</div>
      )}

      {/* Board Group Sections with Drag & Drop & Blue Accent Bar (Matching Screenshot-1) */}
      <div className="flex flex-col gap-6">
        {displayGroups.map((group) => {
          const groupLeadItems = groupedLeads.get(group.id) ?? [];
          const isAddingInThisGroup = addingLeadInGroup === group.id;
          const isCollapsed = collapsedGroups[group.id] ?? false;

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
              <div className="flex items-center justify-between">
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

                {canWrite && (
                  <button
                    type="button"
                    onClick={() => setAddingLeadInGroup(group.id)}
                    className="text-xs font-bold text-sky-600 hover:text-sky-800 transition"
                  >
                    + Add a lead
                  </button>
                )}
              </div>

              {/* Group Table - Matching Screenshot-1 Headers & Layout */}
              {!isCollapsed && (
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50/70 text-slate-600">
                        <th className="py-3 px-4 font-bold min-w-[180px]">Lead</th>
                        {visible('status') && <th className="py-3 px-4 font-bold text-center">Status</th>}
                        {visible('convert') && <th className="py-3 px-4 font-bold text-center">Move to Contacts</th>}
                        {visible('email') && <th className="py-3 px-4 font-bold">Email</th>}
                        {visible('phone') && <th className="py-3 px-4 font-bold">Phone</th>}
                        <th className="py-3 px-4 font-bold">Social & Links</th>
                        {visible('source') && <th className="py-3 px-4 font-bold">Source</th>}

                        {/* Custom Fields Columns */}
                        {customFields.map((field) => {
                          const colKey = fieldColumnKey(field);
                          if (!visible(colKey) || field.key === 'fb_link') return null;
                          return (
                            <th key={field.id} className="py-3 px-4 font-bold">
                              {field.label}
                            </th>
                          );
                        })}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {groupLeadItems.map((lead) => {
                        const fbLinkVal = lead.customValues?.fb_link;

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
                            {/* Lead Column (Grip icon + Name + Detail icon) */}
                            <td className="py-3 px-4 align-middle">
                              <div className="flex items-center gap-2 min-w-0">
                                <span className="text-slate-300 font-mono text-xs cursor-grab shrink-0 select-none">
                                  ⠿
                                </span>
                                <button
                                  type="button"
                                  onClick={() => setSelectedId(lead.id)}
                                  className="font-bold text-slate-900 hover:text-teal-700 hover:underline text-left truncate"
                                >
                                  {lead.name}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setSelectedId(lead.id)}
                                  title="Open lead details"
                                  aria-label={`Open details for ${lead.name}`}
                                  className="rounded p-0.5 text-slate-400 hover:text-sky-600 hover:bg-sky-50 shrink-0 font-bold"
                                >
                                  ▤
                                </button>
                              </div>
                            </td>

                            {/* Status Cell - Pill Badge Select */}
                            {visible('status') && (
                              <td className="py-3 px-4 align-middle text-center">
                                <select
                                  aria-label={`Status of ${lead.name}`}
                                  value={lead.status}
                                  onChange={(e) =>
                                    updateLead.mutate({
                                      id: lead.id,
                                      data: { status: e.target.value as LeadStatus },
                                    })
                                  }
                                  className="rounded-lg border-0 px-3.5 py-1 text-xs font-bold text-white cursor-pointer shadow-2xs focus:ring-2 focus:ring-teal-500"
                                  style={{
                                    backgroundColor:
                                      statusLabels[lead.status]?.color || '#3b82f6',
                                  }}
                                >
                                  {LEAD_STATUSES.map((st) => (
                                    <option key={st} value={st} className="bg-white text-slate-900 font-normal">
                                      {statusLabels[st]?.label ?? st}
                                    </option>
                                  ))}
                                </select>
                              </td>
                            )}

                            {/* Move to Contacts Cell */}
                            {visible('convert') && (
                              <td className="py-3 px-4 align-middle text-center">
                                {lead.partyId ? (
                                  <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700 border border-emerald-200">
                                    Contact created
                                  </span>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => setConvertLead(lead)}
                                    className="rounded-md bg-[#107c41] px-3.5 py-1 text-xs font-bold text-white shadow-2xs hover:bg-[#0c6233] transition-colors"
                                  >
                                    Move to Contacts
                                  </button>
                                )}
                              </td>
                            )}

                            {/* Email Cell */}
                            {visible('email') && (
                              <td className="py-3 px-4 align-middle text-slate-600">
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
                            )}

                            {/* Phone Cell */}
                            {visible('phone') && (
                              <td className="py-3 px-4 align-middle text-slate-600">
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
                            )}

                            {/* Social & Links Cell - Styled Pill matching Screenshot-1 */}
                            <td className="py-3 px-4 align-middle text-slate-600">
                              {fbLinkVal ? (
                                <a
                                  href={typeof fbLinkVal === 'string' && fbLinkVal.startsWith('http') ? fbLinkVal : `https://${fbLinkVal}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1.5 rounded-full bg-teal-50 border border-teal-200/80 px-2.5 py-1 text-xs font-semibold text-teal-800 hover:bg-teal-100 transition-colors"
                                >
                                  <span className="text-teal-600">🔗</span>
                                  <span className="truncate max-w-[160px]">
                                    FB link: {String(fbLinkVal)}
                                  </span>
                                </a>
                              ) : (
                                <span className="text-slate-300">—</span>
                              )}
                            </td>

                            {/* Source Cell */}
                            {visible('source') && (
                              <td className="py-3 px-4 align-middle text-slate-500 font-medium">
                                {lead.sourceName || lead.source || '—'}
                              </td>
                            )}

                            {/* Other Custom Fields Cells */}
                            {customFields.map((field) => {
                              const colKey = fieldColumnKey(field);
                              if (!visible(colKey) || field.key === 'fb_link') return null;
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
                            })}
                          </tr>
                        );
                      })}

                      {/* Inline Add Lead Row */}
                      {isAddingInThisGroup && (
                        <InlineAddLeadRow
                          groupId={group.id === 'default' ? undefined : group.id}
                          onCancel={() => setAddingLeadInGroup(undefined)}
                          onAdded={() => {
                            setAddingLeadInGroup(undefined);
                            refresh();
                          }}
                        />
                      )}
                    </tbody>
                  </table>

                  {/* Footer Bar Row (Matching Screenshot-1) */}
                  <div className="flex items-center justify-between border-t border-slate-100 bg-slate-50/50 px-4 py-3 text-xs text-slate-500 font-medium">
                    <button
                      type="button"
                      onClick={() => setAddingLeadInGroup(group.id)}
                      className="text-slate-500 hover:text-slate-800 transition"
                    >
                      + Add a lead...
                    </button>
                    <div className="flex items-center gap-6">
                      <span className="text-slate-400">Email</span>
                      <span className="text-slate-400">Phone</span>
                      <button
                        type="button"
                        onClick={() => setIsColumnsOpen(true)}
                        className="text-teal-700 font-bold hover:underline"
                      >
                        More fields →
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </section>
          );
        })}
      </div>

      {/* Side Detail Panel */}
      {selectedId && (
        <LeadDetail
          leadId={selectedId}
          onClose={() => setSelectedId(undefined)}
          onChanged={refresh}
        />
      )}

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

      {isBoardSetupOpen && (
        <BoardSetupModal onClose={() => setIsBoardSetupOpen(false)} />
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

/** Inline row for creating a new lead directly in the table. */
function InlineAddLeadRow({
  groupId,
  onCancel,
  onAdded,
}: {
  groupId?: string;
  onCancel: () => void;
  onAdded: () => void;
}) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');

  const add = useMutation({
    mutationFn: () =>
      api.post<LeadResponse>(LEAD_PATHS.leads, {
        name,
        ...(groupId ? { groupId } : {}),
        ...(email ? { email } : {}),
        ...(phone ? { phone } : {}),
        source: 'inbound',
      } satisfies CreateLeadRequest),
    onSuccess: onAdded,
  });

  const failure = add.error instanceof ApiFailure ? add.error : undefined;

  return (
    <tr className="bg-sky-50/50">
      <td className="py-3 px-4">
        <input
          type="text"
          autoFocus
          aria-label="Lead name"
          placeholder="Lead name..."
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && name.trim()) add.mutate();
            if (e.key === 'Escape') onCancel();
          }}
          className="w-full rounded border border-sky-300 px-2.5 py-1 text-xs focus:outline-none font-medium"
        />
      </td>
      <td className="py-3 px-4 text-center">
        <span className="rounded-lg bg-sky-500 px-3 py-1 text-xs font-bold text-white">
          New
        </span>
      </td>
      <td className="py-3 px-4 text-center">
        <span className="text-xs text-slate-400">—</span>
      </td>
      <td className="py-3 px-4">
        <input
          type="email"
          aria-label="Email"
          placeholder="Email..."
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && name.trim()) add.mutate();
            if (e.key === 'Escape') onCancel();
          }}
          className="w-full rounded border border-slate-200 px-2.5 py-1 text-xs focus:outline-none"
        />
      </td>
      <td className="py-3 px-4">
        <input
          type="text"
          aria-label="Phone"
          placeholder="Phone..."
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && name.trim()) add.mutate();
            if (e.key === 'Escape') onCancel();
          }}
          className="w-full rounded border border-slate-200 px-2.5 py-1 text-xs focus:outline-none"
        />
      </td>
      <td colSpan={3} className="py-3 px-4 text-right">
        {failure && <span className="mr-2 text-xs text-rose-600">{failure.message}</span>}
        <button
          type="button"
          onClick={() => name.trim() && add.mutate()}
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
    </tr>
  );
}
