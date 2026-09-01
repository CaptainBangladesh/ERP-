import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ACTIVITY_PATHS,
  IDENTITY_PATHS,
  LEAD_PATHS,
  listPath,
  type ActivityListResponse,
  type ActivityResponse,
  type ActivityType,
  type LeadCustomValues,
  type LeadFieldSummary,
  type LeadListResponse,
  type LeadResponse,
  type LeadSummary,
  type UserListResponse,
  type UserSummary,
} from '@erp/shared';
import { ApiFailure, api } from '../../../api/client';
import { navigate, useLocationPath } from '../../../app/location';
import { useSession } from '../../../session/SessionProvider';
import { hasPermission } from '../../../session/permissions';
import { LeadActivityFeed } from '../components/LeadActivityFeed';
import { ConvertLeadModal } from '../components/ConvertLeadModal';
import { MailboxesModal } from '../components/MailboxesModal';
import { SendEmailModal } from '../components/SendEmailModal';
import { useLeadFields, useLeadSources, useLeadStatusLabels, type StatusLabel } from '../vocabulary';

/**
 * The Lead Workspace: one full page to work a single lead, at its own route.
 *
 * It replaces the cramped modal the board used to open. Everything about a lead lives together
 * here — a worklist to move lead-to-lead down the left, the Status pipeline stepper across the
 * top, the unified Activity feed in the centre, and a Next-step rail on the right — beside the
 * module-nav rail the app shell already provides. The route carries the lead id so the page is
 * deep-linkable and the browser's back/forward move between leads.
 */

/** The frontend route pattern. Resolved for any concrete `/crm/leads/<id>` by the registry. */
export const CRM_LEAD_WORKSPACE_ROUTE = '/crm/leads/:id';

/** Where the board sends a click on a lead, and what a worklist card links to. */
export function leadWorkspacePath(id: string): string {
  return `/crm/leads/${id}`;
}

function useLeadIdFromPath(): string {
  const path = useLocationPath();
  const match = /^\/crm\/leads\/([^/]+)$/.exec(path);
  return match ? decodeURIComponent(match[1]!) : '';
}

export function LeadWorkspace() {
  const leadId = useLeadIdFromPath();
  const { session } = useSession();
  const canWrite = hasPermission(session, 'crm:leads:write');
  const canReadUsers = hasPermission(session, 'identity:users:read');
  const queryClient = useQueryClient();

  const [tab, setTab] = useState<'activity' | 'details'>('activity');
  const [worklistOpen, setWorklistOpen] = useState(true);
  const [converting, setConverting] = useState(false);
  const [sendEmailOpen, setSendEmailOpen] = useState(false);
  const [mailboxesOpen, setMailboxesOpen] = useState(false);
  const [composerType, setComposerType] = useState<ActivityType>('note');
  const [composerFocusSignal, setComposerFocusSignal] = useState(0);

  const statusLabels = useLeadStatusLabels();
  const { sources } = useLeadSources();
  const { all: customFields } = useLeadFields();

  const lead = useQuery({
    queryKey: ['crm', 'leads', 'detail', leadId],
    queryFn: () => api.get<LeadResponse>(LEAD_PATHS.lead(leadId)),
    enabled: Boolean(leadId),
  });

  const worklist = useQuery({
    queryKey: ['crm', 'leads', 'list', 'worklist'],
    queryFn: () => api.get<LeadListResponse>(listPath(LEAD_PATHS.leads, { pageSize: 100 })),
  });

  const users = useQuery({
    queryKey: ['identity', 'users', 'all'],
    queryFn: () => api.get<UserListResponse>(listPath(IDENTITY_PATHS.users, { pageSize: 200 })),
    enabled: canReadUsers,
  });

  const change = useMutation({
    mutationFn: (act: () => Promise<LeadResponse>) => act(),
    onSuccess: (updated) => {
      queryClient.setQueryData(['crm', 'leads', 'detail', leadId], updated);
      void queryClient.invalidateQueries({ queryKey: ['crm', 'leads'] });
      void queryClient.invalidateQueries({ queryKey: ['crm', 'activities', 'lead', leadId] });
    },
  });

  const detail = lead.data;
  const changeFailure = change.error instanceof ApiFailure ? change.error : undefined;

  function openComposer(type: ActivityType) {
    setComposerType(type);
    setTab('activity');
    setComposerFocusSignal((signal) => signal + 1);
  }

  if (lead.isPending) {
    return (
      <p role="status" className="p-8 text-sm font-semibold text-slate-600">
        Loading lead…
      </p>
    );
  }

  if (!detail) {
    return (
      <section className="mx-auto mt-12 flex max-w-md flex-col items-center gap-4 rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-2xs">
        <h1 className="text-base font-bold text-slate-900">That lead could not be found.</h1>
        <p className="text-sm text-slate-500">
          It may have been removed, or it belongs to another company.
        </p>
        <button
          type="button"
          onClick={() => navigate('/crm/leads')}
          className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-bold text-white transition hover:bg-slate-700"
        >
          Back to Leads
        </button>
      </section>
    );
  }

  const owner = users.data?.items.find((user) => user.id === detail.assignedToUserId);

  return (
    <section
      aria-label={detail.name}
      className="flex min-h-[calc(100vh-8rem)] gap-4"
    >
      <Worklist
        open={worklistOpen}
        onToggle={() => setWorklistOpen((open) => !open)}
        leads={worklist.data?.items ?? []}
        activeId={leadId}
        statusOf={statusLabels.of}
      />

      <div className="flex min-w-0 flex-1 flex-col gap-4">
        <header className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-2xs">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-bold tracking-tight text-slate-900">{detail.name}</h1>
              <PriorityBadge value={priorityOf(detail.customValues)} />
              {detail.organisationName && (
                <span className="text-sm font-medium text-slate-500">{detail.organisationName}</span>
              )}
            </div>

            {canWrite && (
              <div className="flex items-center gap-1.5">
                <QuickAction label="Send email" glyph="✉️" onClick={() => setSendEmailOpen(true)} />
                <QuickAction label="Log a call" glyph="📞" onClick={() => openComposer('call')} />
                <QuickAction label="Log a note" glyph="📝" onClick={() => openComposer('note')} />
                <QuickAction label="Log a task" glyph="✅" onClick={() => openComposer('task')} />
              </div>
            )}
          </div>

          <StatusStepper
            status={detail.status}
            settable={statusLabels.settable}
            canWrite={canWrite}
            pending={change.isPending}
            onSet={(status) =>
              change.mutate(() => api.patch<LeadResponse>(LEAD_PATHS.lead(leadId), { status }))
            }
            onQualify={() => setConverting(true)}
            onDisqualify={() => change.mutate(() => api.post<LeadResponse>(LEAD_PATHS.disqualify(leadId)))}
            onReopen={() => change.mutate(() => api.post<LeadResponse>(LEAD_PATHS.reopen(leadId)))}
          />

          {changeFailure && (
            <p role="alert" className="text-xs font-semibold text-rose-600">
              {changeFailure.message}
            </p>
          )}
        </header>

        <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-100/70 p-1 text-xs font-semibold self-start">
          <TabButton active={tab === 'activity'} onClick={() => setTab('activity')}>
            Activity
          </TabButton>
          <TabButton active={tab === 'details'} onClick={() => setTab('details')}>
            Details
          </TabButton>
        </div>

        <div className="min-h-0 flex-1">
          {tab === 'activity' ? (
            <LeadActivityFeed
              leadId={leadId}
              composerType={composerType}
              onComposerTypeChange={setComposerType}
              composerFocusSignal={composerFocusSignal}
            />
          ) : (
            <DetailsPanel
              detail={detail}
              sourceLabel={sourceLabelOf(detail, sources)}
              owner={owner}
              canReadUsers={canReadUsers}
              customFields={customFields}
            />
          )}
        </div>
      </div>

      <NextStepRail
        leadId={leadId}
        detail={detail}
        sourceLabel={sourceLabelOf(detail, sources)}
        canWrite={canWrite}
        pending={change.isPending}
        onQualify={() => setConverting(true)}
        onReopen={() => change.mutate(() => api.post<LeadResponse>(LEAD_PATHS.reopen(leadId)))}
      />

      {converting && (
        <ConvertLeadModal
          lead={detail}
          onClose={() => setConverting(false)}
          onConverted={() => {
            setConverting(false);
            void queryClient.invalidateQueries({ queryKey: ['crm', 'leads'] });
          }}
        />
      )}

      {sendEmailOpen && (
        <SendEmailModal
          isOpen={sendEmailOpen}
          leadId={leadId}
          leadName={detail.name}
          leadEmail={detail.email}
          onClose={() => setSendEmailOpen(false)}
          onSuccess={() => {
            void queryClient.invalidateQueries({ queryKey: ['crm', 'activities', 'lead', leadId] });
            void queryClient.invalidateQueries({ queryKey: ['crm', 'leads', 'detail', leadId] });
          }}
          onOpenMailboxesModal={() => setMailboxesOpen(true)}
        />
      )}

      {mailboxesOpen && <MailboxesModal isOpen={mailboxesOpen} onClose={() => setMailboxesOpen(false)} />}
    </section>
  );
}

// ─── worklist ─────────────────────────────────────────────────────────────────────────

function Worklist({
  open,
  onToggle,
  leads,
  activeId,
  statusOf,
}: {
  open: boolean;
  onToggle: () => void;
  leads: LeadSummary[];
  activeId: string;
  statusOf: (status: LeadSummary['status']) => StatusLabel;
}) {
  const [search, setSearch] = useState('');

  const shown = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return leads;
    return leads.filter((lead) => lead.name.toLowerCase().includes(term));
  }, [leads, search]);

  if (!open) {
    return (
      <div className="shrink-0">
        <button
          type="button"
          onClick={onToggle}
          aria-label="Expand worklist"
          className="rounded-lg border border-slate-200 bg-white px-2 py-2 text-xs font-bold text-slate-500 shadow-2xs hover:bg-slate-50"
        >
          ☰
        </button>
      </div>
    );
  }

  return (
    <aside aria-label="Worklist" className="flex w-64 shrink-0 flex-col gap-2 rounded-2xl border border-slate-200 bg-white p-3 shadow-2xs">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xs font-bold uppercase tracking-wide text-slate-500">Worklist</h2>
        <button
          type="button"
          onClick={onToggle}
          aria-label="Collapse worklist"
          className="rounded p-1 text-xs font-bold text-slate-400 hover:bg-slate-100 hover:text-slate-700"
        >
          ⟨
        </button>
      </div>

      <input
        type="search"
        aria-label="Search the worklist"
        placeholder="Search by name…"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900 placeholder:text-slate-400 focus:border-teal-500 focus:outline-none"
      />

      <ul className="flex flex-col gap-1.5 overflow-y-auto">
        {shown.map((lead) => {
          const label = statusOf(lead.status);
          const isActive = lead.id === activeId;
          return (
            <li key={lead.id}>
              <button
                type="button"
                aria-current={isActive ? 'page' : undefined}
                onClick={() => navigate(leadWorkspacePath(lead.id))}
                className={`flex w-full flex-col gap-1.5 rounded-xl border p-2.5 text-left transition ${
                  isActive
                    ? 'border-teal-300 bg-teal-50/70'
                    : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
                }`}
              >
                <span className="truncate text-xs font-bold text-slate-900">{lead.name}</span>
                {lead.organisationName && (
                  <span className="truncate text-[11px] text-slate-500">{lead.organisationName}</span>
                )}
                <span className="flex items-center gap-1.5">
                  <span
                    className="inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-bold text-white"
                    style={{ backgroundColor: label.color }}
                  >
                    {label.label}
                  </span>
                  <PriorityBadge value={priorityOf(lead.customValues)} compact />
                </span>
              </button>
            </li>
          );
        })}

        {shown.length === 0 && (
          <li className="px-1 py-3 text-center text-[11px] text-slate-400">No leads match “{search}”.</li>
        )}
      </ul>
    </aside>
  );
}

// ─── status stepper ───────────────────────────────────────────────────────────────────

function StatusStepper({
  status,
  settable,
  canWrite,
  pending,
  onSet,
  onQualify,
  onDisqualify,
  onReopen,
}: {
  status: LeadSummary['status'];
  settable: StatusLabel[];
  canWrite: boolean;
  pending: boolean;
  onSet: (status: string) => void;
  onQualify: () => void;
  onDisqualify: () => void;
  onReopen: () => void;
}) {
  const isDisqualified = status === 'disqualified';
  const isQualified = status === 'qualified';

  return (
    <div role="group" aria-label="Status pipeline" className="flex flex-wrap items-center gap-2">
      <ol className="flex flex-1 flex-wrap items-center gap-2">
        {settable.map((step) => {
          const isCurrent = step.status === status;
          return (
            <li key={step.status}>
              <button
                type="button"
                aria-current={isCurrent ? 'step' : undefined}
                disabled={!canWrite || pending || isCurrent}
                onClick={() => onSet(step.status)}
                className={`rounded-lg border px-3.5 py-2 text-xs font-bold transition disabled:cursor-default ${
                  isCurrent ? 'border-transparent text-white shadow-xs' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                }`}
                style={isCurrent ? { backgroundColor: step.color } : undefined}
              >
                {step.label}
              </button>
            </li>
          );
        })}
      </ol>

      {/* Terminal actions — one-way and side-effecting, so set visibly apart from the steps. */}
      <div className="flex items-center gap-2 border-l border-slate-200 pl-2">
        {isDisqualified ? (
          <button
            type="button"
            disabled={!canWrite || pending}
            onClick={onReopen}
            className="rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-bold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
          >
            Reopen
          </button>
        ) : (
          <>
            <button
              type="button"
              aria-current={isQualified ? 'step' : undefined}
              disabled={!canWrite || pending || isQualified}
              onClick={onQualify}
              className={`rounded-lg px-3.5 py-2 text-xs font-bold text-white transition disabled:opacity-50 ${
                isQualified ? 'bg-emerald-800' : 'bg-emerald-700 hover:bg-emerald-800'
              }`}
            >
              {isQualified ? 'Qualified' : 'Qualify'}
            </button>
            <button
              type="button"
              disabled={!canWrite || pending}
              onClick={onDisqualify}
              className="rounded-lg bg-rose-600 px-3.5 py-2 text-xs font-bold text-white transition hover:bg-rose-700 disabled:opacity-50"
            >
              Disqualify
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ─── next-step rail ───────────────────────────────────────────────────────────────────

function NextStepRail({
  leadId,
  detail,
  sourceLabel,
  canWrite,
  pending,
  onQualify,
  onReopen,
}: {
  leadId: string;
  detail: LeadResponse;
  sourceLabel: string;
  canWrite: boolean;
  pending: boolean;
  onQualify: () => void;
  onReopen: () => void;
}) {
  const { session } = useSession();
  const canReadActivities = hasPermission(session, 'crm:activities:read');
  const queryClient = useQueryClient();

  const activities = useQuery({
    queryKey: ['crm', 'activities', 'lead', leadId],
    queryFn: () => api.get<ActivityListResponse>(ACTIVITY_PATHS.leadActivities(leadId)),
    enabled: canReadActivities && Boolean(leadId),
  });

  const completeTask = useMutation({
    mutationFn: (id: string) => api.post<ActivityResponse>(ACTIVITY_PATHS.completeTask(id)),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['crm', 'activities', 'lead', leadId] }),
  });

  const pendingTask = (activities.data?.items ?? []).find(
    (activity) => activity.type === 'task' && !activity.completedAt,
  );

  return (
    <aside aria-label="Next step" className="hidden w-64 shrink-0 flex-col gap-4 lg:flex">
      <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-2xs">
        <h2 className="text-xs font-bold uppercase tracking-wide text-slate-500">Next step</h2>

        {detail.status === 'disqualified' ? (
          <div className="flex flex-col gap-2">
            <p className="text-xs text-slate-500">This lead was disqualified.</p>
            {canWrite && (
              <button
                type="button"
                disabled={pending}
                onClick={onReopen}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
              >
                Reopen this lead
              </button>
            )}
          </div>
        ) : pendingTask ? (
          <div className="flex flex-col gap-2">
            <p className="text-xs font-semibold text-slate-800">{pendingTask.notes}</p>
            {pendingTask.dueAt && (
              <p className="text-[11px] text-slate-500">
                Due {new Date(pendingTask.dueAt).toLocaleDateString(undefined, { dateStyle: 'medium' })}
              </p>
            )}
            {canWrite && (
              <button
                type="button"
                disabled={completeTask.isPending}
                onClick={() => completeTask.mutate(pendingTask.id)}
                className="rounded-lg bg-teal-700 px-3 py-2 text-xs font-bold text-white transition hover:bg-teal-800 disabled:opacity-50"
              >
                Mark done
              </button>
            )}
          </div>
        ) : detail.status !== 'qualified' ? (
          <div className="flex flex-col gap-2">
            <p className="text-xs text-slate-500">Ready to become a contact?</p>
            {canWrite && (
              <button
                type="button"
                disabled={pending}
                onClick={onQualify}
                className="rounded-lg bg-emerald-700 px-3 py-2 text-xs font-bold text-white transition hover:bg-emerald-800 disabled:opacity-50"
              >
                Qualify
              </button>
            )}
          </div>
        ) : (
          <p className="text-xs font-semibold text-emerald-700">✓ This lead is qualified.</p>
        )}
      </div>

      <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-2xs">
        <h2 className="text-xs font-bold uppercase tracking-wide text-slate-500">What we know</h2>
        <WhatWeKnowRow label="Source" value={sourceLabel} />
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] font-semibold text-slate-500">Priority</span>
          <PriorityBadge value={priorityOf(detail.customValues)} fallback="—" />
        </div>
      </div>
    </aside>
  );
}

function WhatWeKnowRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[11px] font-semibold text-slate-500">{label}</span>
      <span className="truncate text-xs font-semibold text-slate-800">{value || '—'}</span>
    </div>
  );
}

// ─── details ──────────────────────────────────────────────────────────────────────────

function DetailsPanel({
  detail,
  sourceLabel,
  owner,
  canReadUsers,
  customFields,
}: {
  detail: LeadResponse;
  sourceLabel: string;
  owner: UserSummary | undefined;
  canReadUsers: boolean;
  customFields: LeadFieldSummary[];
}) {
  const ownerLabel = detail.assignedToUserId
    ? owner?.name ?? (canReadUsers ? 'Someone no longer in this company' : 'Assigned')
    : 'Unassigned';

  const customRows = customFields
    .filter((field) => !isBlank(detail.customValues?.[field.key]))
    .map((field) => ({
      key: field.key,
      label: field.label,
      value: renderCustomValue(detail.customValues?.[field.key]),
    }));

  return (
    <section aria-label="Lead details" className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-2xs">
      <h3 className="text-sm font-bold text-slate-900">Details</h3>
      <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
        <DetailRow label="Name" value={detail.name} />
        <DetailRow label="Organisation" value={detail.organisationName ?? '—'} />
        <DetailRow label="Email" value={detail.email ?? '—'} />
        <DetailRow label="Phone" value={detail.phone ?? '—'} />
        <DetailRow label="Source" value={sourceLabel || '—'} />
        <DetailRow label="Owner" value={ownerLabel} />
        {customRows.map((row) => (
          <DetailRow key={row.key} label={row.label} value={row.value} />
        ))}
      </dl>
    </section>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className="text-xs font-semibold text-slate-800 break-words">{value}</dd>
    </div>
  );
}

// ─── shared bits ──────────────────────────────────────────────────────────────────────

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={`rounded-md px-3.5 py-1 transition ${
        active ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-600 hover:text-slate-900'
      }`}
    >
      {children}
    </button>
  );
}

function QuickAction({ label, glyph, onClick }: { label: string; glyph: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm shadow-2xs transition hover:bg-slate-50"
    >
      <span aria-hidden="true">{glyph}</span>
    </button>
  );
}

/**
 * The triage badge. Priority is a display-only custom field per ADR 0010 — it never sorts or
 * filters, it only tells a salesperson at a glance how hot a lead is. Each company names its own
 * scheme, so this maps the common vocabularies (hot/warm/cold and high/medium/low) onto one set
 * of colours and shows anything else verbatim.
 */
function PriorityBadge({
  value,
  compact = false,
  fallback,
}: {
  value: string | null;
  compact?: boolean;
  fallback?: string;
}) {
  const priority = value ? classifyPriority(value) : null;
  if (!priority) {
    return fallback ? <span className="text-xs font-semibold text-slate-400">{fallback}</span> : null;
  }

  const size = compact ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-0.5 text-[11px]';
  return (
    <span className={`inline-flex items-center rounded-full border font-bold ${size} ${priority.classes}`}>
      {priority.label}
    </span>
  );
}

function classifyPriority(raw: string): { label: string; classes: string } | null {
  const value = raw.trim().toLowerCase();
  if (!value) return null;
  if (['hot', 'high', 'urgent'].includes(value)) {
    return { label: 'Hot', classes: 'border-rose-200 bg-rose-50 text-rose-700' };
  }
  if (['warm', 'medium', 'med'].includes(value)) {
    return { label: 'Warm', classes: 'border-amber-200 bg-amber-50 text-amber-700' };
  }
  if (['cold', 'low'].includes(value)) {
    return { label: 'Cold', classes: 'border-sky-200 bg-sky-50 text-sky-700' };
  }
  return { label: raw.trim(), classes: 'border-slate-200 bg-slate-50 text-slate-600' };
}

function priorityOf(customValues: LeadCustomValues | undefined): string | null {
  const value = customValues?.priority;
  return typeof value === 'string' && value.trim() ? value : null;
}

function sourceLabelOf(detail: LeadResponse, sources: { id: string; name: string }[]): string {
  if (detail.sourceName) return detail.sourceName;
  if (detail.sourceId) return sources.find((source) => source.id === detail.sourceId)?.name ?? '';
  return detail.source ?? '';
}

function isBlank(value: unknown): boolean {
  if (value === undefined || value === null || value === '') return true;
  return Array.isArray(value) && value.length === 0;
}

function renderCustomValue(value: unknown): string {
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (value === null || value === undefined) return '—';
  return String(value);
}
