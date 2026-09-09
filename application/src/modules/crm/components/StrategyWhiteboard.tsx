import { useMemo, useState, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ACTIVITY_PATHS,
  APPROACH_PLAN_PATHS,
  LEAD_PATHS,
  listPath,
  type ActivityResponse,
  type ApproachPlanResponse,
  type CreateActivityRequest,
  type LeadListResponse,
  type LeadSummary,
  type SaveApproachPlanRequest,
  type UserSummary,
} from '@erp/shared';
import { api } from '../../../api/client';
import { navigate } from '../../../app/location';
import { leadWorkspacePath } from '../lead-routes';
import { useSession } from '../../../session/SessionProvider';
import { useLeadStatusLabels, type StatusLabel } from '../vocabulary';

/**
 * Everyone on a lead, primary first — falling back to the legacy single owner for a payload
 * that predates the join table. The board, the workspace and this whiteboard all have to agree
 * on who is on an account, so they all read `assigneeUserIds` and only degrade to
 * `assignedToUserId` when it is absent.
 */
function assigneesOf(lead: LeadSummary): string[] {
  return lead.assigneeUserIds ?? (lead.assignedToUserId ? [lead.assignedToUserId] : []);
}

export interface StrategyWhiteboardProps {
  users?: UserSummary[];
  currentUserId?: string;
  nameForUser?: (id: string | null) => string;
}

export function StrategyWhiteboard({
  users = [],
  currentUserId,
  nameForUser,
}: StrategyWhiteboardProps) {
  const { session } = useSession();
  const effectiveUserId = currentUserId ?? session?.user.id;
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [repFilter, setRepFilter] = useState<string>('all');
  const statusVocabulary = useLeadStatusLabels();

  const leadsQuery = useQuery({
    queryKey: ['crm', 'leads', 'whiteboard-list'],
    queryFn: () => api.get<LeadListResponse>(listPath(LEAD_PATHS.leads, { pageSize: 100 })),
  });

  const leads = useMemo(() => leadsQuery.data?.items ?? [], [leadsQuery.data]);

  const filteredLeads = useMemo(() => {
    return leads.filter((lead) => {
      if (statusFilter !== 'all' && lead.status !== statusFilter) {
        return false;
      }
      if (repFilter !== 'all') {
        // Match on the whole assignee list: filtering by the cached primary alone hid every
        // account where the chosen person is a second owner.
        const assignees = assigneesOf(lead);
        if (repFilter === 'unassigned' && assignees.length > 0) return false;
        if (repFilter !== 'unassigned' && !assignees.includes(repFilter)) return false;
      }
      if (searchTerm.trim()) {
        const term = searchTerm.toLowerCase();
        const matchName = lead.name.toLowerCase().includes(term);
        const matchOrg = (lead.organisationName ?? '').toLowerCase().includes(term);
        if (!matchName && !matchOrg) return false;
      }
      return true;
    });
  }, [leads, statusFilter, repFilter, searchTerm]);

  return (
    <div className="flex flex-col gap-6">
      {/* Board Controls & Filters */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-[220px]">
            <input
              type="search"
              aria-label="Search strategy cards"
              placeholder="Search leads or accounts…"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-slate-50 py-1.5 pl-8 pr-3 text-xs text-slate-800 placeholder-slate-400 focus:border-teal-500 focus:bg-white focus:outline-none focus:ring-1 focus:ring-teal-500"
            />
            <span className="pointer-events-none absolute left-2.5 top-2 text-slate-400">
              <svg aria-hidden="true" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="8" />
                <path d="m21 21-4.3-4.3" />
              </svg>
            </span>
          </div>

          <select
            aria-label="Filter by Status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
          >
            <option value="all">All statuses</option>
            {statusVocabulary.list.map((item) => (
              <option key={item.status} value={item.status}>
                {item.label}
              </option>
            ))}
          </select>

          {users.length > 0 && (
            <select
              aria-label="Filter by Representative"
              value={repFilter}
              onChange={(e) => setRepFilter(e.target.value)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
            >
              <option value="all">All team members</option>
              <option value="unassigned">Unassigned</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="flex items-center gap-2 text-xs font-medium text-slate-500">
          <span className="inline-flex h-2 w-2 rounded-full bg-emerald-500" />
          <span>Showing {filteredLeads.length} of {leads.length} accounts</span>
        </div>
      </div>

      {/* Sticky Note Wall Canvas */}
      {leadsQuery.isLoading ? (
        <div className="flex min-h-[320px] items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50/50">
          <p className="text-sm font-medium text-slate-500">Loading strategy whiteboard…</p>
        </div>
      ) : filteredLeads.length === 0 ? (
        <div className="flex min-h-[320px] flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-slate-300 bg-slate-50/50 p-8 text-center">
          <div className="rounded-full bg-amber-100 p-3 text-amber-700">
            <svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect width="18" height="18" x="3" y="3" rx="2" />
              <path d="M8 7h8M8 11h8M8 15h5" />
            </svg>
          </div>
          <h3 className="text-sm font-bold text-slate-800">No strategy cards match your filter</h3>
          <p className="max-w-sm text-xs text-slate-500">
            Adjust your search or status filters to view team approach plans, or add leads from the CRM board.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          {filteredLeads.map((lead) => (
            <StrategyLeadCard
              key={lead.id}
              lead={lead}
              currentUserId={effectiveUserId}
              statusLabel={statusVocabulary.of(lead.status)}
              assigneeNames={
                nameForUser ? assigneesOf(lead).map((id) => nameForUser(id)) : []
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface StrategyLeadCardProps {
  lead: LeadSummary;
  currentUserId?: string;
  /** What the company calls the status this lead is actually holding, and the colour it wears. */
  statusLabel: StatusLabel;
  /** Everyone on the account, primary first. */
  assigneeNames: string[];
}

function StrategyLeadCard({
  lead,
  currentUserId,
  statusLabel,
  assigneeNames,
}: StrategyLeadCardProps) {
  const queryClient = useQueryClient();
  const [taskCreated, setTaskCreated] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');

  const planQuery = useQuery({
    queryKey: ['crm', 'approach-plan', lead.id],
    queryFn: () => api.get<ApproachPlanResponse>(APPROACH_PLAN_PATHS.byLead(lead.id)),
  });

  const [angle, setAngle] = useState('');
  const [objections, setObjections] = useState('');
  const [nextSteps, setNextSteps] = useState('');
  const [isDirty, setIsDirty] = useState(false);

  useEffect(() => {
    if (planQuery.data && !isDirty) {
      setAngle(planQuery.data.angle ?? '');
      setObjections(planQuery.data.objections ?? '');
      setNextSteps(planQuery.data.nextSteps ?? '');
    }
  }, [planQuery.data, isDirty]);

  const saveMutation = useMutation({
    mutationFn: (request: SaveApproachPlanRequest) =>
      api.put<ApproachPlanResponse>(APPROACH_PLAN_PATHS.byLead(lead.id), request),
    onSuccess: (saved) => {
      setIsDirty(false);
      setSaveStatus('saved');
      queryClient.setQueryData(['crm', 'approach-plan', lead.id], saved);
      setTimeout(() => setSaveStatus('idle'), 2000);
    },
    onError: () => {
      setSaveStatus('idle');
    },
  });

  const handleSave = () => {
    setSaveStatus('saving');
    saveMutation.mutate({
      angle: angle.trim() || null,
      objections: objections.trim() || null,
      nextSteps: nextSteps.trim() || null,
    });
  };

  const createTaskMutation = useMutation({
    mutationFn: () => {
      const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
      tomorrow.setHours(10, 0, 0, 0);
      const actionNotes =
        nextSteps.trim() ||
        (angle.trim() ? `Follow up on hook: ${angle.trim()}` : `Strategy follow-up with ${lead.name}`);

      return api.post<ActivityResponse>(ACTIVITY_PATHS.activities, {
        type: 'task',
        notes: actionNotes,
        dueAt: tomorrow.toISOString(),
        assignedToUserId: lead.assignedToUserId ?? currentUserId,
        leadId: lead.id,
      } satisfies CreateActivityRequest);
    },
    onSuccess: () => {
      setTaskCreated(true);
      void queryClient.invalidateQueries({ queryKey: ['crm', 'planning'] });
      void queryClient.invalidateQueries({ queryKey: ['crm', 'activities'] });
      void queryClient.invalidateQueries({ queryKey: ['crm', 'planner'] });
      setTimeout(() => setTaskCreated(false), 3000);
    },
  });

  return (
    <article
      aria-label={`Strategy whiteboard for ${lead.name}`}
      className="flex flex-col gap-4 rounded-2xl border border-slate-200/90 bg-white p-5 shadow-xs transition hover:shadow-md"
    >
      {/* Lead Header */}
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
        <div className="flex flex-col">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => navigate(leadWorkspacePath(lead.id))}
              className="text-sm font-bold tracking-tight text-slate-900 transition hover:text-teal-700"
            >
              {lead.name}
            </button>
            <span
              style={{ backgroundColor: statusLabel.color }}
              className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold text-white"
            >
              {statusLabel.label}
            </span>
          </div>
          {lead.organisationName && (
            <p className="text-xs font-medium text-slate-500">{lead.organisationName}</p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {assigneeNames.length === 0 ? (
            <span className="rounded-md bg-slate-100 px-2 py-1 text-[11px] font-medium text-slate-600">
              👤 Unassigned
            </span>
          ) : (
            assigneeNames.map((name, index) => (
              <span
                key={`${name}-${index}`}
                title={index === 0 ? `${name} (primary)` : name}
                className="rounded-md bg-slate-100 px-2 py-1 text-[11px] font-medium text-slate-600"
              >
                👤 {name}
              </span>
            ))
          )}
          <button
            type="button"
            onClick={() => navigate(leadWorkspacePath(lead.id))}
            className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 hover:text-slate-900"
          >
            Workspace →
          </button>
        </div>
      </header>

      {/* 3 Physical Sticky-Note Cards */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {/* Yellow Sticky Note: The Angle / Hook */}
        <div className="flex flex-col rounded-xl border border-amber-300 bg-amber-50/80 p-3.5 shadow-2xs transition hover:bg-amber-50">
          <div className="mb-2 flex items-center justify-between text-xs font-bold text-amber-900">
            <span className="flex items-center gap-1.5">
              <span>🟨</span>
              <span>The Angle / Hook</span>
            </span>
          </div>
          <textarea
            aria-label={`Angle for ${lead.name}`}
            rows={4}
            value={angle}
            placeholder="Wedge, pain point, or reason to buy now…"
            onChange={(e) => {
              setAngle(e.target.value);
              setIsDirty(true);
            }}
            onBlur={handleSave}
            className="w-full resize-none rounded-md border border-amber-200/80 bg-white/80 p-2 text-xs text-amber-950 placeholder-amber-700/50 focus:border-amber-400 focus:bg-white focus:outline-none focus:ring-1 focus:ring-amber-400"
          />
        </div>

        {/* Red Sticky Note: Objections & Rebuttals */}
        <div className="flex flex-col rounded-xl border border-rose-300 bg-rose-50/80 p-3.5 shadow-2xs transition hover:bg-rose-50">
          <div className="mb-2 flex items-center justify-between text-xs font-bold text-rose-900">
            <span className="flex items-center gap-1.5">
              <span>🟥</span>
              <span>Objections &amp; Fix</span>
            </span>
          </div>
          <textarea
            aria-label={`Objections for ${lead.name}`}
            rows={4}
            value={objections}
            placeholder="Pushbacks expected and counter-strategy…"
            onChange={(e) => {
              setObjections(e.target.value);
              setIsDirty(true);
            }}
            onBlur={handleSave}
            className="w-full resize-none rounded-md border border-rose-200/80 bg-white/80 p-2 text-xs text-rose-950 placeholder-rose-700/50 focus:border-rose-400 focus:bg-white focus:outline-none focus:ring-1 focus:ring-rose-400"
          />
        </div>

        {/* Green Sticky Note: Next Best Action */}
        <div className="flex flex-col rounded-xl border border-emerald-300 bg-emerald-50/80 p-3.5 shadow-2xs transition hover:bg-emerald-50">
          <div className="mb-2 flex items-center justify-between text-xs font-bold text-emerald-900">
            <span className="flex items-center gap-1.5">
              <span>🟩</span>
              <span>Next Best Action</span>
            </span>
          </div>
          <textarea
            aria-label={`Next action for ${lead.name}`}
            rows={4}
            value={nextSteps}
            placeholder="Immediate concrete move planned…"
            onChange={(e) => {
              setNextSteps(e.target.value);
              setIsDirty(true);
            }}
            onBlur={handleSave}
            className="w-full resize-none rounded-md border border-emerald-200/80 bg-white/80 p-2 text-xs text-emerald-950 placeholder-emerald-700/50 focus:border-emerald-400 focus:bg-white focus:outline-none focus:ring-1 focus:ring-emerald-400"
          />
        </div>
      </div>

      {/* Card Actions Footer */}
      <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3">
        <div className="flex items-center gap-2">
          {isDirty && (
            <button
              type="button"
              onClick={handleSave}
              disabled={saveMutation.isPending}
              className="rounded-md bg-slate-900 px-3 py-1 text-xs font-semibold text-white shadow-2xs hover:bg-slate-800 disabled:opacity-50"
            >
              {saveMutation.isPending ? 'Saving notes…' : 'Save Notes'}
            </button>
          )}
          {saveStatus === 'saved' && (
            <span className="text-[11px] font-semibold text-emerald-600">✓ Notes saved</span>
          )}
          {saveStatus === 'saving' && (
            <span className="text-[11px] font-semibold text-slate-400">Saving…</span>
          )}
        </div>

        <button
          type="button"
          onClick={() => createTaskMutation.mutate()}
          disabled={createTaskMutation.isPending || taskCreated}
          className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition shadow-2xs ${
            taskCreated
              ? 'bg-emerald-600 text-white'
              : 'bg-emerald-50 text-emerald-800 border border-emerald-300 hover:bg-emerald-100 active:bg-emerald-200'
          } disabled:cursor-not-allowed disabled:opacity-75`}
        >
          {taskCreated ? (
            <>
              <span>✓</span>
              <span>Task Scheduled for Tomorrow!</span>
            </>
          ) : (
            <>
              <span>⚡</span>
              <span>Turn into Task</span>
            </>
          )}
        </button>
      </footer>
    </article>
  );
}
