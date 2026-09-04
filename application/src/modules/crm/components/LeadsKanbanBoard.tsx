import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  LeadFieldSummary,
  LeadGroupSummary,
  LeadSourceSummary,
  LeadStatusKey,
  LeadSummary,
  UserSummary,
} from '@erp/shared';
import { navigate } from '../../../app/location';
import { leadWorkspacePath } from '../pages/LeadWorkspace';
import type { LeadStatusVocabulary, StatusLabel } from '../vocabulary';

/**
 * Deterministic background color and text color for initials avatar
 */
const AVATAR_PALETTES = [
  { bg: 'bg-blue-100 text-blue-700 border-blue-200' },
  { bg: 'bg-purple-100 text-purple-700 border-purple-200' },
  { bg: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  { bg: 'bg-amber-100 text-amber-700 border-amber-200' },
  { bg: 'bg-rose-100 text-rose-700 border-rose-200' },
  { bg: 'bg-indigo-100 text-indigo-700 border-indigo-200' },
  { bg: 'bg-teal-100 text-teal-700 border-teal-200' },
  { bg: 'bg-orange-100 text-orange-700 border-orange-200' },
  { bg: 'bg-cyan-100 text-cyan-700 border-cyan-200' },
  { bg: 'bg-fuchsia-100 text-fuchsia-700 border-fuchsia-200' },
];

function getAvatarPalette(str: string) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  const index = Math.abs(hash) % AVATAR_PALETTES.length;
  return AVATAR_PALETTES[index]!;
}

function getInitials(name: string): string {
  if (!name.trim()) return 'L';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) {
    return parts[0]!.slice(0, 2).toUpperCase();
  }
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

/**
 * Format relative or human-friendly timestamp for lead creation/activity
 */
function formatLeadTimestamp(lead: LeadSummary): string {
  const rawDate = lead.customValues?.createdAt || (lead as unknown as Record<string, unknown>).createdAt;
  if (rawDate && typeof rawDate === 'string') {
    const d = new Date(rawDate);
    if (!isNaN(d.getTime())) {
      const now = new Date();
      const isToday =
        d.getDate() === now.getDate() &&
        d.getMonth() === now.getMonth() &&
        d.getFullYear() === now.getFullYear();

      const timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      if (isToday) {
        return `Today at ${timeStr}`;
      }
      return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} at ${timeStr}`;
    }
  }
  return 'Recently added';
}

function isUrl(value: string): boolean {
  if (typeof value !== 'string') return false;
  return /^https?:\/\//i.test(value) || /^www\./i.test(value) || /^(facebook|fb|instagram|linkedin|twitter)\.com\//i.test(value);
}

function toHref(value: string): string {
  return /^https?:\/\//i.test(value) ? value : `https://${value}`;
}

function shortenUrl(value: string): string {
  return value.replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/$/, '');
}

function getFieldIcon(key: string, label: string): string {
  const named = `${key} ${label}`.toLowerCase();
  if (/facebook|\bfb\b/.test(named)) return '🌐';
  if (/instagram|\binsta\b/.test(named)) return '📸';
  if (/linkedin/.test(named)) return '💼';
  if (/twitter|\bx\b/.test(named)) return '🐦';
  if (/location|address|city|country/.test(named)) return '📍';
  if (/title|role|position/.test(named)) return '📇';
  if (/priority/.test(named)) return '🚩';
  if (/type/.test(named)) return '🗂';
  if (/comment|note|desc/.test(named)) return '💬';
  if (/whatsapp/.test(named)) return '💬';
  if (/date|time/.test(named)) return '📅';
  if (/num|count|amount|qty/.test(named)) return '#';
  return '⊞';
}

const HIDDEN_STATUSES_STORAGE_KEY = 'erp.crm.leads.hidden_board_statuses';

interface LeadsKanbanBoardProps {
  leads: LeadSummary[];
  statusLabels: LeadStatusVocabulary;
  groups: LeadGroupSummary[];
  sources: LeadSourceSummary[];
  users: UserSummary[];
  customFields?: LeadFieldSummary[];
  canWrite: boolean;
  onUpdateStatus: (leadId: string, newStatus: LeadStatusKey) => void;
  onConvertLead: (lead: LeadSummary) => void;
  onNewLeadInStatus?: (status: LeadStatusKey) => void;
  onOpenColumnsModal?: () => void;
}

export function LeadsKanbanBoard({
  leads,
  statusLabels,
  groups,
  sources,
  users,
  customFields = [],
  canWrite,
  onUpdateStatus,
  onConvertLead,
  onNewLeadInStatus,
  onOpenColumnsModal,
}: LeadsKanbanBoardProps) {
  const usersMap = useMemo(() => new Map(users.map((u) => [u.id, u.name])), [users]);
  const groupsMap = useMemo(() => new Map(groups.map((g) => [g.id, g.name])), [groups]);

  // Persisted hidden status columns
  const [hiddenStatusKeys, setHiddenStatusKeys] = useState<Set<string>>(() => {
    try {
      const stored = window.localStorage.getItem(HIDDEN_STATUSES_STORAGE_KEY);
      if (stored) {
        return new Set(JSON.parse(stored) as string[]);
      }
    } catch {
      // Ignore localStorage read errors
    }
    return new Set<string>();
  });

  const [isColumnDropdownOpen, setIsColumnDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        HIDDEN_STATUSES_STORAGE_KEY,
        JSON.stringify(Array.from(hiddenStatusKeys)),
      );
    } catch {
      // Ignore write errors
    }
  }, [hiddenStatusKeys]);

  useEffect(() => {
    function onPointerDown(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsColumnDropdownOpen(false);
      }
    }
    if (isColumnDropdownOpen) {
      document.addEventListener('pointerdown', onPointerDown);
      return () => document.removeEventListener('pointerdown', onPointerDown);
    }
  }, [isColumnDropdownOpen]);

  const toggleStatusVisibility = (statusKey: string) => {
    setHiddenStatusKeys((prev) => {
      const next = new Set(prev);
      if (next.has(statusKey)) {
        next.delete(statusKey);
      } else {
        // Prevent hiding all columns
        if (next.size + 1 < statusLabels.list.length) {
          next.add(statusKey);
        }
      }
      return next;
    });
  };

  const showAllStatuses = () => {
    setHiddenStatusKeys(new Set());
  };

  const hideStatus = (statusKey: string) => {
    setHiddenStatusKeys((prev) => {
      if (prev.size + 1 >= statusLabels.list.length) {
        alert('At least one status column must remain visible.');
        return prev;
      }
      const next = new Set(prev);
      next.add(statusKey);
      return next;
    });
  };

  // Filter columns to only show non-hidden statuses
  const visibleStatusList = useMemo(() => {
    return statusLabels.list.filter((s) => !hiddenStatusKeys.has(s.status));
  }, [statusLabels.list, hiddenStatusKeys]);

  // Group leads dynamically by their current status
  const leadsByStatus = useMemo(() => {
    const map = new Map<LeadStatusKey, LeadSummary[]>();
    for (const item of statusLabels.list) {
      map.set(item.status, []);
    }
    for (const lead of leads) {
      const list = map.get(lead.status) ?? [];
      list.push(lead);
      map.set(lead.status, list);
    }
    return map;
  }, [leads, statusLabels.list]);

  return (
    <div className="flex flex-col gap-3">
      {/* Board View Sub-Toolbar: Column customization & More fields button */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          {/* Column selector dropdown */}
          <div className="relative" ref={dropdownRef}>
            <button
              type="button"
              onClick={() => setIsColumnDropdownOpen((prev) => !prev)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 font-semibold text-slate-700 shadow-2xs hover:bg-slate-50 transition-colors"
            >
              <span>▦ Columns ({visibleStatusList.length}/{statusLabels.list.length})</span>
              <span className="text-[10px] text-slate-400">▼</span>
            </button>

            {isColumnDropdownOpen && (
              <div className="absolute left-0 top-full z-20 mt-1 w-64 rounded-xl border border-slate-200 bg-white p-2 shadow-lg ring-1 ring-slate-900/5">
                <div className="border-b border-slate-100 pb-2 px-2 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                  Visible Status Columns
                </div>
                <div className="flex flex-col gap-1 py-1 max-h-60 overflow-y-auto custom-scrollbar">
                  {statusLabels.list.map((st) => {
                    const isChecked = !hiddenStatusKeys.has(st.status);
                    return (
                      <label
                        key={st.status}
                        className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-slate-50 cursor-pointer text-xs"
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => toggleStatusVisibility(st.status)}
                          className="rounded border-slate-300 text-teal-600 focus:ring-teal-500"
                        />
                        <span
                          className="h-2 w-2 rounded-full shrink-0"
                          style={{ backgroundColor: st.color || '#0284c7' }}
                        />
                        <span className="font-medium text-slate-800 truncate">{st.label}</span>
                        <span className="ml-auto text-[11px] text-slate-400">
                          {leadsByStatus.get(st.status)?.length ?? 0}
                        </span>
                      </label>
                    );
                  })}
                </div>
                {hiddenStatusKeys.size > 0 && (
                  <div className="border-t border-slate-100 pt-2 px-1">
                    <button
                      type="button"
                      onClick={showAllStatuses}
                      className="w-full rounded-md bg-slate-50 py-1 text-center text-xs font-semibold text-teal-700 hover:bg-teal-50 transition-colors"
                    >
                      Show all columns
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Quick chips to unhide columns if any are hidden */}
          {hiddenStatusKeys.size > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              {statusLabels.list
                .filter((st) => hiddenStatusKeys.has(st.status))
                .map((st) => (
                  <button
                    key={st.status}
                    type="button"
                    onClick={() => toggleStatusVisibility(st.status)}
                    title={`Restore "${st.label}" column`}
                    className="inline-flex items-center gap-1 rounded-full border border-dashed border-slate-300 bg-slate-50/80 px-2.5 py-1 text-[11px] font-medium text-slate-600 hover:border-teal-500 hover:bg-teal-50 hover:text-teal-700 transition-colors"
                  >
                    <span>+ Show "{st.label}"</span>
                  </button>
                ))}
            </div>
          )}
        </div>

        {/* More fields button right from the Board view (matching table footer) */}
        {onOpenColumnsModal && (
          <button
            type="button"
            onClick={onOpenColumnsModal}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 font-bold text-teal-700 shadow-2xs hover:bg-teal-50/60 hover:border-teal-300 transition-colors"
          >
            <span>+ More fields / Custom columns →</span>
          </button>
        )}
      </div>

      {/* Kanban Columns Grid */}
      <div className="flex gap-4 overflow-x-auto pb-6 pt-1 custom-scrollbar min-h-[580px] select-none">
        {visibleStatusList.map((statusItem) => {
          const columnLeads = leadsByStatus.get(statusItem.status) ?? [];
          return (
            <KanbanColumn
              key={statusItem.status}
              statusItem={statusItem}
              statusLabels={statusLabels}
              leads={columnLeads}
              usersMap={usersMap}
              groupsMap={groupsMap}
              customFields={customFields}
              canWrite={canWrite}
              onUpdateStatus={onUpdateStatus}
              onConvertLead={onConvertLead}
              onNewLead={() => onNewLeadInStatus?.(statusItem.status)}
              onHideColumn={() => hideStatus(statusItem.status)}
            />
          );
        })}
      </div>
    </div>
  );
}

function KanbanColumn({
  statusItem,
  statusLabels,
  leads,
  usersMap,
  groupsMap,
  customFields,
  canWrite,
  onUpdateStatus,
  onConvertLead,
  onNewLead,
  onHideColumn,
}: {
  statusItem: StatusLabel;
  statusLabels: LeadStatusVocabulary;
  leads: LeadSummary[];
  usersMap: Map<string, string>;
  groupsMap: Map<string, string>;
  customFields: LeadFieldSummary[];
  canWrite: boolean;
  onUpdateStatus: (leadId: string, newStatus: LeadStatusKey) => void;
  onConvertLead: (lead: LeadSummary) => void;
  onNewLead: () => void;
  onHideColumn: () => void;
}) {
  const [isDragOver, setIsDragOver] = useState(false);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (!isDragOver) setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDragOver(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const leadId = e.dataTransfer.getData('text/plain');
    if (leadId && statusItem.isSettable) {
      onUpdateStatus(leadId, statusItem.status);
    }
  };

  return (
    <div
      data-testid={`column-${statusItem.status}`}
      aria-label={`${statusItem.label} status column`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`group/col flex w-[320px] flex-shrink-0 flex-col rounded-2xl border transition-all duration-150 ${
        isDragOver
          ? 'border-teal-500 bg-teal-50/40 shadow-md ring-2 ring-teal-400/30'
          : 'border-slate-200/90 bg-slate-50/70 shadow-2xs'
      }`}
    >
      {/* Column Header: Colored status dot, Status name, Lead count pill, +, and Hide button */}
      <div className="flex items-center justify-between gap-2 border-b border-slate-200/80 px-3.5 py-3 bg-white/80 rounded-t-2xl">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className="h-2.5 w-2.5 rounded-full shrink-0 shadow-xs"
            style={{ backgroundColor: statusItem.color || '#0284c7' }}
            aria-hidden="true"
          />
          <h2 className="font-bold text-slate-800 text-sm truncate tracking-tight">
            {statusItem.label}
          </h2>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600 border border-slate-200/60">
            {leads.length} {leads.length === 1 ? 'Lead' : 'Leads'}
          </span>
          {canWrite && (
            <button
              type="button"
              onClick={onNewLead}
              title={`Add lead to ${statusItem.label}`}
              aria-label={`Add lead to ${statusItem.label}`}
              className="flex h-6 w-6 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition-colors text-sm font-bold"
            >
              +
            </button>
          )}
          <button
            type="button"
            onClick={onHideColumn}
            title={`Hide "${statusItem.label}" column from board`}
            aria-label={`Hide ${statusItem.label} column`}
            className="flex h-6 w-6 items-center justify-center rounded-md text-slate-300 hover:bg-slate-100 hover:text-slate-600 transition-colors text-xs font-bold"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Cards Container */}
      <div className="flex flex-col gap-3 p-3 flex-1 overflow-y-auto max-h-[calc(100vh-280px)] custom-scrollbar">
        {leads.length === 0 ? (
          <div
            className={`flex flex-col items-center justify-center rounded-xl border border-dashed py-10 px-4 text-center transition-colors ${
              isDragOver
                ? 'border-teal-400 bg-teal-50/60 text-teal-700'
                : 'border-slate-200/80 bg-white/40 text-slate-400'
            }`}
          >
            <p className="text-xs font-medium">
              {isDragOver ? 'Drop lead here' : 'No leads in this stage'}
            </p>
          </div>
        ) : (
          leads.map((lead) => (
            <KanbanLeadCard
              key={lead.id}
              lead={lead}
              statusItem={statusItem}
              statusLabels={statusLabels}
              usersMap={usersMap}
              groupsMap={groupsMap}
              customFields={customFields}
              canWrite={canWrite}
              onUpdateStatus={onUpdateStatus}
              onConvertLead={onConvertLead}
            />
          ))
        )}
      </div>
    </div>
  );
}

function KanbanLeadCard({
  lead,
  statusItem,
  statusLabels,
  usersMap,
  groupsMap,
  customFields,
  canWrite,
  onUpdateStatus,
  onConvertLead,
}: {
  lead: LeadSummary;
  statusItem: StatusLabel;
  statusLabels: LeadStatusVocabulary;
  usersMap: Map<string, string>;
  groupsMap: Map<string, string>;
  customFields: LeadFieldSummary[];
  canWrite: boolean;
  onUpdateStatus: (leadId: string, newStatus: LeadStatusKey) => void;
  onConvertLead: (lead: LeadSummary) => void;
}) {
  const [isDragging, setIsDragging] = useState(false);
  const avatarPalette = getAvatarPalette(lead.name || lead.email || 'Lead');
  const initials = getInitials(lead.name);
  const timestamp = formatLeadTimestamp(lead);
  const groupName = lead.groupId ? groupsMap.get(lead.groupId) : undefined;
  const ownerName = lead.assignedToUserId ? usersMap.get(lead.assignedToUserId) : undefined;

  // Extract all non-empty custom field values on this lead
  const cardCustomFields = useMemo(() => {
    const list: Array<{ key: string; label: string; value: string; isUrl: boolean; icon: string }> = [];
    const values = lead.customValues ?? {};

    // 1. First process registered custom fields
    for (const field of customFields) {
      const val = values[field.key];
      if (val !== undefined && val !== null && String(val).trim() !== '') {
        const valStr = String(val).trim();
        list.push({
          key: field.key,
          label: field.label,
          value: valStr,
          isUrl: isUrl(valStr),
          icon: getFieldIcon(field.key, field.label),
        });
      }
    }

    // 2. Also check any additional keys in customValues (e.g. fb_link, facebook, etc.)
    for (const [k, v] of Object.entries(values)) {
      if (v !== undefined && v !== null && String(v).trim() !== '') {
        const alreadyAdded = list.some((item) => item.key === k);
        if (!alreadyAdded) {
          const valStr = String(v).trim();
          let label = k;
          if (/^fb_link|facebook/i.test(k)) label = 'Facebook';
          else if (/^linkedin/i.test(k)) label = 'LinkedIn';
          else if (/^twitter/i.test(k)) label = 'Twitter';
          else if (/^instagram/i.test(k)) label = 'Instagram';
          else if (k === 'location') label = 'Location';
          else if (k === 'title') label = 'Title';
          else if (k === 'type') label = 'Type';
          else if (k === 'comments') label = 'Comments';

          list.push({
            key: k,
            label,
            value: valStr,
            isUrl: isUrl(valStr),
            icon: getFieldIcon(k, label),
          });
        }
      }
    }

    return list;
  }, [lead.customValues, customFields]);

  const handleDragStart = (e: React.DragEvent) => {
    setIsDragging(true);
    e.dataTransfer.setData('text/plain', lead.id);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragEnd = () => {
    setIsDragging(false);
  };

  return (
    <div
      draggable={canWrite}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      className={`group relative flex flex-col gap-2.5 rounded-xl border border-slate-200/90 bg-white p-3.5 shadow-2xs transition-all duration-150 hover:shadow-sm hover:border-slate-300 ${
        canWrite ? 'cursor-grab active:cursor-grabbing' : ''
      } ${isDragging ? 'opacity-40 scale-95' : 'opacity-100'}`}
    >
      {/* Top row: Avatar + Name + Timestamp (Matching Screenshot 3) */}
      <div className="flex items-start gap-3">
        {/* Initials / Avatar Circle */}
        <div
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-xs font-bold border ${avatarPalette.bg}`}
          title={lead.name}
        >
          {initials}
        </div>

        {/* Lead Name & Timestamp */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-1">
            <button
              type="button"
              onClick={() => navigate(leadWorkspacePath(lead.id))}
              className="text-left font-bold text-slate-900 hover:text-teal-700 hover:underline text-sm truncate leading-snug"
              title={`Open ${lead.name}`}
            >
              {lead.name}
            </button>

            <button
              type="button"
              onClick={() => navigate(leadWorkspacePath(lead.id))}
              title="Open lead details"
              aria-label={`Open ${lead.name}`}
              className="rounded p-1 text-slate-300 hover:text-slate-600 hover:bg-slate-100 opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            </button>
          </div>

          {/* Timestamp with clock icon */}
          <div className="flex items-center gap-1.5 text-[11px] text-slate-400 mt-0.5">
            <svg className="h-3 w-3 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="truncate">{timestamp}</span>
          </div>
        </div>
      </div>

      {/* Middle row: Email & Phone Contact Details */}
      <div className="flex flex-col gap-1 text-xs text-slate-600 pt-1 border-t border-slate-100/80">
        {lead.email ? (
          <a
            href={`mailto:${lead.email}`}
            onClick={(e) => e.stopPropagation()}
            className="flex items-center gap-2 text-slate-600 hover:text-teal-700 transition-colors truncate group/link"
            title={lead.email}
          >
            <span className="text-slate-400 text-xs shrink-0">✉</span>
            <span className="truncate">{lead.email}</span>
          </a>
        ) : (
          <div className="flex items-center gap-2 text-slate-300 text-xs italic">
            <span className="text-slate-300 text-xs shrink-0">✉</span>
            <span>No email</span>
          </div>
        )}

        {lead.phone ? (
          <a
            href={`tel:${lead.phone}`}
            onClick={(e) => e.stopPropagation()}
            className="flex items-center gap-2 text-slate-600 hover:text-teal-700 transition-colors truncate"
            title={lead.phone}
          >
            <span className="text-slate-400 text-xs shrink-0">📞</span>
            <span className="truncate font-mono">{lead.phone}</span>
          </a>
        ) : (
          <div className="flex items-center gap-2 text-slate-300 text-xs italic">
            <span className="text-slate-300 text-xs shrink-0">📞</span>
            <span>No phone</span>
          </div>
        )}
      </div>

      {/* Custom Fields (e.g. Facebook Page Link, Location, Title, Custom Fields) */}
      {cardCustomFields.length > 0 && (
        <div className="flex flex-col gap-1 pt-1 border-t border-slate-100/80">
          {cardCustomFields.map((field) =>
            field.isUrl ? (
              <a
                key={field.key}
                href={toHref(field.value)}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                title={`${field.label}: ${field.value}`}
                className="flex items-center gap-1.5 rounded-md border border-sky-100 bg-sky-50/60 px-2 py-1 text-[11px] font-medium text-sky-800 transition-colors hover:border-sky-300 hover:bg-sky-100 hover:text-sky-950 truncate"
              >
                <span className="shrink-0 text-sky-600 text-xs">{field.icon}</span>
                <span className="truncate">{shortenUrl(field.value)}</span>
              </a>
            ) : (
              <div
                key={field.key}
                title={`${field.label}: ${field.value}`}
                className="flex items-center gap-1.5 rounded-md border border-slate-100 bg-slate-50/70 px-2 py-0.5 text-[11px] text-slate-600 truncate"
              >
                <span className="shrink-0 text-slate-400 text-xs">{field.icon}</span>
                <span className="font-medium text-slate-400 truncate">{field.label}:</span>
                <span className="font-semibold text-slate-700 truncate">{field.value}</span>
              </div>
            ),
          )}
        </div>
      )}

      {/* Card Footer: Badges (Group / Industry tag, Owner, Move to Contacts) */}
      <div className="flex flex-wrap items-center justify-between gap-1.5 pt-2 border-t border-slate-100">
        <div className="flex flex-wrap items-center gap-1.5">
          {groupName && (
            <span className="inline-flex items-center rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600 border border-slate-200/60 truncate max-w-[120px]">
              {groupName}
            </span>
          )}

          {ownerName ? (
            <span
              className="inline-flex items-center gap-1 rounded-md bg-teal-50 px-1.5 py-0.5 text-[11px] font-medium text-teal-700 border border-teal-200/50 truncate max-w-[110px]"
              title={`Assigned to ${ownerName}`}
            >
              <span className="h-1.5 w-1.5 rounded-full bg-teal-500 shrink-0" />
              <span className="truncate">{ownerName}</span>
            </span>
          ) : (
            <span className="text-[11px] text-slate-400 italic">Unassigned</span>
          )}
        </div>

        {/* Move to Contacts action */}
        {lead.partyId ? (
          <button
            type="button"
            onClick={() => navigate('/crm/contacts')}
            title="View Contact on Contacts board"
            className="inline-flex items-center gap-1 rounded-md border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-700 transition-colors hover:bg-emerald-100 shadow-2xs"
          >
            Contact created ↗
          </button>
        ) : (
          <button
            type="button"
            onClick={() => onConvertLead(lead)}
            className="rounded-md border border-emerald-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-emerald-800 transition-colors hover:border-emerald-700 hover:bg-emerald-700 hover:text-white"
          >
            Move to Contacts
          </button>
        )}
      </div>
    </div>
  );
}
