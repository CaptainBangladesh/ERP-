import { useMemo, useRef, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ACTIVITY_PATHS,
  IDENTITY_PATHS,
  LEAD_PATHS,
  LEAD_SUBMISSION_PATHS,
  listPath,
  type ActivityListResponse,
  type ActivityResponse,
  type ActivityType,
  type LeadAttachmentListResponse,
  type LeadCustomValues,
  type LeadFieldSummary,
  type LeadListResponse,
  type LeadResponse,
  type LeadSubmissionListResponse,
  type LeadSummary,
  type UserListResponse,
  type UserSummary,
} from '@erp/shared';
import { ApiFailure, api } from '../../../api/client';
import { navigate, useLocationPath } from '../../../app/location';
import { useSession } from '../../../session/SessionProvider';
import { hasPermission } from '../../../session/permissions';
import { AnswerValue } from '../components/AnswerValue';
import { MerchantSnapshot } from '../components/MerchantProfileCard';
import { LeadActivityFeed } from '../components/LeadActivityFeed';
import { LeadFilesTab } from '../components/LeadFilesTab';
import { LeadSurveyTab } from '../components/LeadSurveyTab';
import { ConvertLeadModal } from '../components/ConvertLeadModal';
import { MailboxesModal } from '../components/MailboxesModal';
import { SendEmailModal } from '../components/SendEmailModal';
import { useLeadFields, useLeadSources, useLeadStatusLabels, type StatusLabel } from '../vocabulary';
import { avatarColour, hrefFor, initialsOf, isUrl, prettyUrl } from '../survey-answers';
import { buildMerchantProfile } from '../merchant-intel';
import {
  ActivityIcon,
  BoltIcon,
  CalendarIcon,
  CheckIcon,
  ChecklistIcon,
  ChevronLeftIcon,
  FileIcon,
  InfoIcon,
  LinkIcon,
  ListIcon,
  MailIcon,
  PaperclipIcon,
  PencilIcon,
  PhoneIcon,
  SearchIcon,
  StarIcon,
} from '../icons';

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

type WorkspaceTab = 'activity' | 'files' | 'survey' | 'details';

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
  const canReadActivities = hasPermission(session, 'crm:activities:read');
  const queryClient = useQueryClient();

  /**
   * Activity is the centre of the workspace; the other three are thin find-it tabs beside it,
   * for retrieving one artifact without scrolling the whole history.
   */
  const [tab, setTab] = useState<WorkspaceTab>('activity');
  const [worklistOpen, setWorklistOpen] = useState(true);
  // The worklist's chosen filter and search live here, not inside `Worklist`, so they persist as
  // the user moves lead-to-lead — the detail query re-pends on each click.
  const [worklistLens, setWorklistLens] = useState<WorklistLens | undefined>();
  const [worklistSearch, setWorklistSearch] = useState('');
  const [converting, setConverting] = useState(false);
  const [sendEmailOpen, setSendEmailOpen] = useState(false);
  const [mailboxesOpen, setMailboxesOpen] = useState(false);
  const [composerType, setComposerType] = useState<ActivityType>('note');
  const [composerFocusSignal, setComposerFocusSignal] = useState(0);
  // The rail's "All survey answers" switches the centre tab, which happens off-screen when the
  // reader is down in the rail — so it also brings the workspace column back into view, or the
  // click reads as doing nothing.
  const workspaceColumnRef = useRef<HTMLDivElement>(null);

  const statusLabels = useLeadStatusLabels();
  const { sources } = useLeadSources();
  const { all: customFields } = useLeadFields();

  const lead = useQuery({
    queryKey: ['crm', 'leads', 'detail', leadId],
    queryFn: () => api.get<LeadResponse>(LEAD_PATHS.lead(leadId)),
    enabled: Boolean(leadId),
    // Keep the last lead on screen while the next one loads, so moving lead-to-lead down the
    // worklist doesn't blank the whole page (and unmount the worklist with its chosen filter).
    placeholderData: keepPreviousData,
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

  /**
   * The three counts on the tabs, read here rather than inside each pane.
   *
   * A find-it tab whose number you can only learn by opening it is not much of a find-it tab —
   * the point of "Files 2" is to save the trip. React Query serves each pane from these same
   * keys, so asking here costs no extra request.
   */
  const activities = useQuery({
    queryKey: ['crm', 'activities', 'lead', leadId],
    queryFn: () => api.get<ActivityListResponse>(ACTIVITY_PATHS.leadActivities(leadId)),
    enabled: canReadActivities && Boolean(leadId),
  });

  const files = useQuery({
    queryKey: ['crm', 'leads', 'files', leadId],
    queryFn: () => api.get<LeadAttachmentListResponse>(LEAD_PATHS.files(leadId)),
    enabled: Boolean(leadId),
  });

  const submissions = useQuery({
    queryKey: ['crm', 'leads', 'submissions', leadId],
    queryFn: () => api.get<LeadSubmissionListResponse>(LEAD_SUBMISSION_PATHS.byLead(leadId)),
    enabled: Boolean(leadId),
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

  function openSurvey() {
    setTab('survey');
    requestAnimationFrame(() => {
      try {
        workspaceColumnRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } catch {
        // jsdom has no layout engine; the tab switch is what matters there.
      }
    });
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
  // Everyone on the lead, primary first, resolved to the people we can name. A lead may now be
  // shared, so the Owner rail lists the set rather than the single primary.
  const assignees = (detail.assigneeUserIds ?? (detail.assignedToUserId ? [detail.assignedToUserId] : []))
    .map((id) => users.data?.items.find((user) => user.id === id))
    .filter((user): user is UserSummary => Boolean(user));
  const status = statusLabels.of(detail.status);

  return (
    <section aria-label={detail.name} className="flex min-w-0 min-h-[calc(100vh-8rem)] gap-4">
      <Worklist
        open={worklistOpen}
        onToggle={() => setWorklistOpen((open) => !open)}
        leads={worklist.data?.items ?? []}
        activeId={leadId}
        statusOf={statusLabels.of}
        currentUserId={session?.user.id}
        lens={worklistLens}
        onLensChange={setWorklistLens}
        search={worklistSearch}
        onSearchChange={setWorklistSearch}
      />

      <div ref={workspaceColumnRef} className="flex min-w-0 flex-1 flex-col gap-4">
        <header className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-2xs">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex min-w-0 items-start gap-3">
              <Avatar name={detail.name} size="lg" />

              <div className="flex min-w-0 flex-col gap-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-xl font-bold tracking-tight text-slate-900">{detail.name}</h1>
                  <StatusPill label={status} />
                  <PriorityBadge value={priorityOf(detail.customValues)} />
                </div>

                <ContactRow detail={detail} />
              </div>
            </div>

            {canWrite && (
              <div className="flex items-center gap-1.5">
                {/* Email is the primary action and is filled to say so; the rest are the
                    same button at rest, so the row reads as one set rather than five. */}
                <QuickAction label="Send email" primary onClick={() => setSendEmailOpen(true)}>
                  <MailIcon size={17} />
                </QuickAction>
                <QuickAction label="Log a call" onClick={() => openComposer('call')}>
                  <PhoneIcon size={17} />
                </QuickAction>
                <QuickAction label="Log a note" onClick={() => openComposer('note')}>
                  <PencilIcon size={17} />
                </QuickAction>
                <QuickAction label="Log a meeting" onClick={() => openComposer('meeting')}>
                  <CalendarIcon size={17} />
                </QuickAction>
                <QuickAction label="Attach a file" onClick={() => setTab('files')}>
                  <PaperclipIcon size={17} />
                </QuickAction>
              </div>
            )}
          </div>

          <nav aria-label="Lead sections" className="flex items-center gap-1 border-b border-slate-200">
            <TabButton active={tab === 'activity'} onClick={() => setTab('activity')} label="Activity" count={activities.data?.items.length}>
              <ActivityIcon size={15} />
            </TabButton>
            <TabButton active={tab === 'files'} onClick={() => setTab('files')} label="Files" count={files.data?.items.length}>
              <FileIcon size={15} />
            </TabButton>
            <TabButton active={tab === 'survey'} onClick={() => setTab('survey')} label="Survey" count={submissions.data?.items.length}>
              <ChecklistIcon size={15} />
            </TabButton>
            <TabButton active={tab === 'details'} onClick={() => setTab('details')} label="Details">
              <InfoIcon size={15} />
            </TabButton>
          </nav>

          <StatusStepper
            status={detail.status}
            settable={statusLabels.settable}
            canWrite={canWrite}
            pending={change.isPending}
            onSet={(next) =>
              change.mutate(() => api.patch<LeadResponse>(LEAD_PATHS.lead(leadId), { status: next }))
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

        <div className="min-h-0 min-w-0 flex-1">
          {tab === 'activity' && (
            <LeadActivityFeed
              leadId={leadId}
              leadName={detail.name}
              composerType={composerType}
              onComposerTypeChange={setComposerType}
              composerFocusSignal={composerFocusSignal}
            />
          )}

          {tab === 'files' && <LeadFilesTab leadId={leadId} canWrite={canWrite} />}

          {tab === 'survey' && (
            <LeadSurveyTab lead={detail} customFieldDefinitions={customFields} canWrite={canWrite} />
          )}

          {tab === 'details' && (
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
        owner={owner}
        assignees={assignees}
        canWrite={canWrite}
        pending={change.isPending}
        customFields={customFields}
        submissions={submissions.data?.items ?? []}
        onQualify={() => setConverting(true)}
        onReopen={() => change.mutate(() => api.post<LeadResponse>(LEAD_PATHS.reopen(leadId)))}
        onOpenSurvey={openSurvey}
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

/** The tiles across the top of the worklist. Each is also a filter — see `Worklist`. */
type WorklistLens = 'new' | 'hot' | 'contacted' | 'mine';

function Worklist({
  open,
  onToggle,
  leads,
  activeId,
  statusOf,
  currentUserId,
  lens,
  onLensChange,
  search,
  onSearchChange,
}: {
  open: boolean;
  onToggle: () => void;
  leads: LeadSummary[];
  activeId: string;
  statusOf: (status: LeadSummary['status']) => StatusLabel;
  currentUserId: string | undefined;
  // Lifted to the parent so the chosen filter and search survive lead-to-lead navigation — the
  // detail query re-pends on each click and its loading gate briefly unmounts this component.
  lens: WorklistLens | undefined;
  onLensChange: (lens: WorklistLens | undefined) => void;
  search: string;
  onSearchChange: (search: string) => void;
}) {
  const matchesLens = useMemo(
    () => ({
      new: (lead: LeadSummary) => lead.status === 'new',
      hot: (lead: LeadSummary) => classifyPriority(priorityOf(lead.customValues) ?? '')?.label === 'Hot',
      contacted: (lead: LeadSummary) => lead.status === 'contacted',
      mine: (lead: LeadSummary) => {
        if (!currentUserId) return false;
        const ids = lead.assigneeUserIds ?? (lead.assignedToUserId ? [lead.assignedToUserId] : []);
        return ids.includes(currentUserId);
      },
    }),
    [currentUserId],
  );

  const shown = useMemo(() => {
    const term = search.trim().toLowerCase();
    return leads
      .filter((lead) => (lens ? matchesLens[lens](lead) : true))
      .filter((lead) => (term ? lead.name.toLowerCase().includes(term) : true));
  }, [leads, search, lens, matchesLens]);

  /**
   * Cards under the source that brought them in.
   *
   * Where a lead came from is the thing a salesperson groups by without being asked — four
   * Facebook Ads leads are one batch to work, and a flat list of every lead in the company
   * hides that. Sources are ordered by size so the busiest channel is at the top.
   */
  const groups = useMemo(() => {
    const bySource = new Map<string, LeadSummary[]>();
    for (const lead of shown) {
      const key = lead.sourceName || lead.source || 'No source';
      const existing = bySource.get(key);
      if (existing) existing.push(lead);
      else bySource.set(key, [lead]);
    }
    return [...bySource.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [shown]);

  if (!open) {
    return (
      <div className="shrink-0">
        <button
          type="button"
          onClick={onToggle}
          aria-label="Expand worklist"
          className="rounded-lg border border-slate-200 bg-white p-2 text-slate-500 shadow-2xs transition hover:bg-slate-50 hover:text-slate-800"
        >
          <ListIcon size={16} />
        </button>
      </div>
    );
  }

  return (
    <aside
      aria-label="Worklist"
      className="flex w-72 shrink-0 flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-3.5 shadow-2xs"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900">
          <span className="text-slate-400">
            <ListIcon size={16} />
          </span>
          Worklist
        </h2>
        <button
          type="button"
          onClick={onToggle}
          aria-label="Collapse worklist"
          className="rounded-md p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
        >
          <ChevronLeftIcon size={15} />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <StatTile
          label="New leads"
          dotClass="bg-sky-500"
          count={leads.filter(matchesLens.new).length}
          active={lens === 'new'}
          onClick={() => onLensChange(lens === 'new' ? undefined : 'new')}
        />
        <StatTile
          label="Hot"
          dotClass="bg-rose-500"
          count={leads.filter(matchesLens.hot).length}
          active={lens === 'hot'}
          onClick={() => onLensChange(lens === 'hot' ? undefined : 'hot')}
        />
        <StatTile
          label="Contacted"
          dotClass="bg-violet-500"
          count={leads.filter(matchesLens.contacted).length}
          active={lens === 'contacted'}
          onClick={() => onLensChange(lens === 'contacted' ? undefined : 'contacted')}
        />
        <StatTile
          label="Assigned to me"
          dotClass="bg-teal-500"
          count={leads.filter(matchesLens.mine).length}
          active={lens === 'mine'}
          onClick={() => onLensChange(lens === 'mine' ? undefined : 'mine')}
        />
      </div>

      <div className="relative">
        <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400">
          <SearchIcon size={14} />
        </span>
        <input
          type="search"
          aria-label="Search the worklist"
          placeholder="Search leads…"
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-8 pr-2.5 text-xs text-slate-900 placeholder:text-slate-400 focus:border-teal-500 focus:outline-none"
        />
      </div>

      <div className="flex flex-col gap-4 overflow-y-auto">
        {groups.map(([sourceName, entries]) => (
          <div key={sourceName} className="flex flex-col gap-1.5">
            <h3 className="px-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">
              {sourceName} · {entries.length}
            </h3>
            <ul className="flex flex-col gap-1.5">
              {entries.map((entry) => (
                <li key={entry.id}>
                  <WorklistCard lead={entry} active={entry.id === activeId} statusOf={statusOf} />
                </li>
              ))}
            </ul>
          </div>
        ))}

        {shown.length === 0 && (
          <p className="px-1 py-4 text-center text-[11px] text-slate-400">
            No leads match what you are looking for.
          </p>
        )}
      </div>
    </aside>
  );
}

/**
 * A count that is also a filter.
 *
 * Named for what it does rather than by what it reads: the count sits in the visible label, and
 * a tile whose accessible name were "6 Hot" would rename itself every time somebody's priority
 * changed — which is no name at all for anything trying to find it again.
 */
function StatTile({
  label,
  count,
  dotClass,
  active,
  onClick,
}: {
  label: string;
  count: number;
  dotClass: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={`Show ${label.toLowerCase()}`}
      className={`flex flex-col gap-0.5 rounded-xl border p-2.5 text-left transition ${
        active ? 'border-teal-300 bg-teal-50/70' : 'border-slate-200 bg-white hover:border-slate-300'
      }`}
    >
      <span className="text-xl font-bold leading-none text-slate-900">{count}</span>
      <span className="flex items-center gap-1.5 text-[10px] font-semibold text-slate-500">
        <span aria-hidden="true" className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${dotClass}`} />
        <span className="truncate">{label}</span>
      </span>
    </button>
  );
}

function WorklistCard({
  lead,
  active,
  statusOf,
}: {
  lead: LeadSummary;
  active: boolean;
  statusOf: (status: LeadSummary['status']) => StatusLabel;
}) {
  const label = statusOf(lead.status);
  return (
    <button
      type="button"
      aria-current={active ? 'page' : undefined}
      onClick={() => navigate(leadWorkspacePath(lead.id))}
      className={`flex w-full items-start gap-2.5 rounded-xl border p-2.5 text-left transition ${
        active
          ? 'border-teal-300 bg-teal-50/60 ring-1 ring-teal-200'
          : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
      }`}
    >
      <Avatar name={lead.name} />
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="truncate text-xs font-bold text-slate-900">{lead.name}</span>
        {lead.organisationName && (
          <span className="truncate text-[11px] text-slate-500">{lead.organisationName}</span>
        )}
        <span className="flex flex-wrap items-center gap-1.5">
          <StatusPill label={label} compact />
          <PriorityBadge value={priorityOf(lead.customValues)} compact />
        </span>
      </span>
    </button>
  );
}

// ─── status stepper ───────────────────────────────────────────────────────────────────

/**
 * The one control that moves a lead along, drawn as the pipeline it is.
 *
 * A connected rail rather than a row of buttons, because the question a salesperson opens a lead
 * with is "where is this one and what comes next" — an answer a set of equal-looking pills does
 * not give. Steps behind the current one are filled and ticked, the current one is filled in its
 * own colour, and the ones ahead are hollow.
 */
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
  const currentIndex = settable.findIndex((step) => step.status === status);

  return (
    <div role="group" aria-label="Status pipeline" className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-3">
      <ol className="flex min-w-0 flex-1 items-center overflow-hidden">
        {settable.map((step, index) => {
          const isCurrent = step.status === status;
          // Qualified sits past every settable step, so when a lead reaches it the whole rail
          // reads as behind — which is what has actually happened.
          const isBehind = isQualified || (currentIndex >= 0 && index < currentIndex);
          const isLast = index === settable.length - 1;

          return (
            <li key={step.status} className={`flex min-w-0 items-center ${isLast ? '' : 'flex-1'}`}>
              {/* min-w-0 + a truncating label lets the steps compress on a narrow column instead of
                  overlapping each other and spilling off the side. */}
              <button
                type="button"
                aria-current={isCurrent ? 'step' : undefined}
                disabled={!canWrite || pending || isCurrent}
                onClick={() => onSet(step.status)}
                title={step.label}
                className="group flex min-w-0 items-center gap-2 rounded-lg py-1 pr-2 text-xs font-bold transition disabled:cursor-default"
              >
                <span
                  aria-hidden="true"
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 text-white transition ${
                    isCurrent || isBehind ? 'border-transparent' : 'border-slate-300 bg-white group-hover:border-slate-400'
                  }`}
                  style={isCurrent || isBehind ? { backgroundColor: step.color } : undefined}
                >
                  {isBehind ? <CheckIcon size={13} /> : null}
                </span>
                <span
                  className={`truncate ${
                    isCurrent ? 'text-slate-900' : isBehind ? 'text-slate-600' : 'text-slate-500'
                  }`}
                >
                  {step.label}
                </span>
              </button>

              {!isLast && (
                <span
                  aria-hidden="true"
                  className={`mx-1 h-0.5 min-w-2 flex-1 rounded-full ${isBehind ? 'bg-teal-500' : 'bg-slate-200'}`}
                />
              )}
            </li>
          );
        })}
      </ol>

      {/* Terminal actions — one-way and side-effecting, so set visibly apart from the steps. */}
      <div className="flex shrink-0 items-center gap-2">
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
              className={`flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-bold text-white transition disabled:opacity-60 ${
                isQualified ? 'bg-emerald-800' : 'bg-emerald-700 hover:bg-emerald-800'
              }`}
            >
              <CheckIcon size={14} />
              {isQualified ? 'Qualified' : 'Qualify'}
            </button>
            <button
              type="button"
              disabled={!canWrite || pending}
              onClick={onDisqualify}
              className="rounded-lg border border-rose-200 bg-white px-3.5 py-2 text-xs font-bold text-rose-600 transition hover:bg-rose-50 disabled:opacity-50"
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
  owner,
  assignees,
  canWrite,
  pending,
  customFields,
  submissions,
  onQualify,
  onReopen,
  onOpenSurvey,
}: {
  leadId: string;
  detail: LeadResponse;
  sourceLabel: string;
  owner: UserSummary | undefined;
  /** Everyone assigned to the lead, primary first — the Owner rail lists them all. */
  assignees: UserSummary[];
  canWrite: boolean;
  pending: boolean;
  customFields: LeadFieldSummary[];
  submissions: LeadSubmissionListResponse['items'];
  onQualify: () => void;
  onReopen: () => void;
  onOpenSurvey: () => void;
}) {
  const { session } = useSession();
  const canReadActivities = hasPermission(session, 'crm:activities:read');
  const queryClient = useQueryClient();

  const activities = useQuery({
    queryKey: ['crm', 'activities', 'lead', leadId],
    queryFn: () => api.get<ActivityListResponse>(ACTIVITY_PATHS.leadActivities(leadId)),
    enabled: canReadActivities && Boolean(leadId),
  });

  const settle = useMutation({
    mutationFn: (act: () => Promise<ActivityResponse>) => act(),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['crm', 'activities', 'lead', leadId] }),
  });

  const items = activities.data?.items ?? [];
  const pendingTask = items.find((activity) => activity.type === 'task' && !activity.completedAt);
  const profile = buildMerchantProfile(submissions, customFields);

  return (
    <aside aria-label="Next step" className="hidden w-72 shrink-0 flex-col gap-4 lg:flex">
      <div className="flex flex-col gap-3 rounded-2xl border-2 border-teal-200 bg-white p-4 shadow-2xs">
        <h2 className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-teal-700">
          <BoltIcon size={13} />
          Next step
        </h2>

        {detail.status === 'disqualified' ? (
          <div className="flex flex-col gap-2">
            <p className="text-sm font-bold text-slate-900">This lead was disqualified.</p>
            <p className="text-xs text-slate-500">Reopen it if something changed.</p>
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
            <p className="text-sm font-bold leading-snug text-slate-900">{pendingTask.notes}</p>
            <p className="text-xs leading-relaxed text-slate-500">{whyNow(pendingTask.dueAt, items)}</p>
            {canWrite && (
              <div className="flex items-center gap-2 pt-0.5">
                <button
                  type="button"
                  disabled={settle.isPending}
                  onClick={() =>
                    settle.mutate(() =>
                      api.post<ActivityResponse>(ACTIVITY_PATHS.completeTask(pendingTask.id)),
                    )
                  }
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-teal-700 px-3 py-2 text-xs font-bold text-white transition hover:bg-teal-800 disabled:opacity-50"
                >
                  <CheckIcon size={14} />
                  Mark done
                </button>
                {/* A rail that can only say "done" makes somebody lie to it to clear the
                    prompt, so deferring is offered beside finishing. */}
                <button
                  type="button"
                  disabled={settle.isPending}
                  onClick={() =>
                    settle.mutate(() =>
                      api.post<ActivityResponse>(ACTIVITY_PATHS.snoozeTask(pendingTask.id), { days: 1 }),
                    )
                  }
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
                >
                  Snooze
                </button>
              </div>
            )}
          </div>
        ) : detail.status !== 'qualified' ? (
          <div className="flex flex-col gap-2">
            <p className="text-sm font-bold text-slate-900">Ready to become a contact?</p>
            <p className="text-xs text-slate-500">
              Nothing is outstanding on this lead. Qualifying moves it to Contacts and opens a deal.
            </p>
            {canWrite && (
              <button
                type="button"
                disabled={pending}
                onClick={onQualify}
                className="flex items-center justify-center gap-1.5 rounded-lg bg-emerald-700 px-3 py-2 text-xs font-bold text-white transition hover:bg-emerald-800 disabled:opacity-50"
              >
                <CheckIcon size={14} />
                Qualify
              </button>
            )}
          </div>
        ) : (
          <p className="text-xs font-semibold text-emerald-700">✓ This lead is qualified.</p>
        )}
      </div>

      <div className="flex min-w-0 flex-col gap-3 overflow-hidden rounded-2xl border border-slate-200 bg-white p-4 shadow-2xs">
        <h2 className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">
          <StarIcon size={13} />
          What we know
        </h2>

        <RailField label="Source">
          {sourceLabel ? (
            <span className="inline-flex items-center rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-700">
              {sourceLabel}
            </span>
          ) : (
            <span className="text-xs font-semibold text-slate-400">—</span>
          )}
        </RailField>

        <RailField label="Priority">
          <PriorityBadge value={priorityOf(detail.customValues)} fallback="—" />
        </RailField>

        {/* The research read that actually says what this lead is — category, site, app, socials —
            which is the reason the rail is worth a glance at all. Source and priority alone are
            filing, not context. The full breakdown, notes and usability grid live on the Survey tab. */}
        <MerchantSnapshot profile={profile} />

        {submissions.length > 0 && (
          <button
            type="button"
            onClick={onOpenSurvey}
            className="self-start text-[11px] font-bold text-teal-700 transition hover:text-teal-900"
          >
            All survey answers →
          </button>
        )}
      </div>

      <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-2xs">
        <h2 className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
          {assignees.length > 1 ? 'Owners' : 'Owner'}
        </h2>
        {assignees.length > 0 ? (
          <div className="flex flex-col gap-2">
            {assignees.map((person) => (
              <div key={person.id} className="flex items-center gap-2.5">
                <Avatar name={person.name} />
                <span className="min-w-0 truncate text-xs font-bold text-slate-800">{person.name}</span>
              </div>
            ))}
          </div>
        ) : detail.assignedToUserId ? (
          // A primary is set but no one on it resolves to a current member.
          <div className="flex items-center gap-2.5">
            <Avatar name={owner?.name ?? 'Unknown'} />
            <span className="min-w-0 truncate text-xs font-bold text-slate-800">
              {owner?.name ?? 'Someone no longer in this company'}
            </span>
          </div>
        ) : (
          <p className="text-xs text-slate-400">Unassigned</p>
        )}
      </div>
    </aside>
  );
}

function RailField({
  label,
  stacked = false,
  children,
}: {
  label: string;
  stacked?: boolean;
  children: React.ReactNode;
}) {
  if (stacked) {
    return (
      <div className="flex flex-col gap-0.5 border-t border-slate-100 pt-2">
        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</span>
        {children}
      </div>
    );
  }
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</span>
      {children}
    </div>
  );
}

/**
 * Why this task is the thing to do now.
 *
 * The rail states an action; a line saying what makes it urgent is what turns it from a to-do
 * into a prompt worth obeying. An email the lead has probably opened is the strongest such
 * reason the feed can offer, so it is preferred over the due date when both are true.
 */
function whyNow(dueAt: string | null, items: ActivityListResponse['items']): string {
  const opened = items.find((item) => item.notes.startsWith('📬'));
  const due = dueAt ? new Date(dueAt) : undefined;
  const overdue = due ? due.getTime() < Date.now() : false;
  const when = due
    ? overdue
      ? 'It is already overdue.'
      : `Due ${due.toLocaleDateString(undefined, { dateStyle: 'medium' })}.`
    : 'No due date set.';

  if (opened) return `They have probably opened your email — call while it is warm. ${when}`;
  return when;
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
  // The primary's name, with a "+N" when the lead is shared, so the compact summary line admits
  // the co-owners the Owner rail spells out in full.
  const extraOwners = Math.max(0, (detail.assigneeUserIds?.length ?? (detail.assignedToUserId ? 1 : 0)) - 1);
  const ownerLabel = detail.assignedToUserId
    ? `${owner?.name ?? (canReadUsers ? 'Someone no longer in this company' : 'Assigned')}${
        extraOwners > 0 ? ` +${extraOwners}` : ''
      }`
    : 'Unassigned';

  const customRows = customFields
    .filter((field) => !isBlank(detail.customValues?.[field.key]))
    .map((field) => ({
      key: field.key,
      label: field.label,
      raw: detail.customValues?.[field.key],
    }));

  return (
    <section
      aria-label="Lead details"
      className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-2xs"
    >
      <h3 className="text-sm font-bold text-slate-900">Details</h3>
      <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
        <DetailRow label="Name" value={detail.name} />
        <DetailRow label="Organisation" value={detail.organisationName ?? '—'} />
        <DetailRow label="Email" value={detail.email ?? '—'} />
        <DetailRow label="Phone" value={detail.phone ?? '—'} />
        <DetailRow label="Source" value={sourceLabel || '—'} />
        <DetailRow label="Owner" value={ownerLabel} />
        {customRows.map((row) => (
          <DetailRow key={row.key} label={row.label}>
            <div className="text-xs font-semibold text-slate-800">
              <AnswerValue value={row.raw} />
            </div>
          </DetailRow>
        ))}
      </dl>
    </section>
  );
}

function DetailRow({
  label,
  value,
  children,
}: {
  label: string;
  value?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className="text-xs font-semibold text-slate-800 break-words">{children ?? value}</dd>
    </div>
  );
}

// ─── shared bits ──────────────────────────────────────────────────────────────────────

/**
 * The lead's contact details on one line, each a live link.
 *
 * They were spread between a header pill and a sidebar before, which meant the two things
 * somebody opens a lead to *do* — mail them, ring them — were never in the same place as their
 * name. A website or social profile is shown when the company has defined a field holding one.
 */
function ContactRow({ detail }: { detail: LeadResponse }) {
  const link = firstUrl(detail.customValues);

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
      {detail.email && (
        <a
          href={`mailto:${detail.email}`}
          className="flex items-center gap-1.5 transition hover:text-slate-900"
        >
          <span className="text-slate-400">
            <MailIcon size={13} />
          </span>
          {detail.email}
        </a>
      )}
      {detail.phone && (
        <a href={`tel:${detail.phone}`} className="flex items-center gap-1.5 transition hover:text-slate-900">
          <span className="text-slate-400">
            <PhoneIcon size={13} />
          </span>
          {detail.phone}
        </a>
      )}
      {link && (
        <a
          href={hrefFor(link)}
          target="_blank"
          rel="noopener noreferrer"
          title={link}
          className="flex min-w-0 items-center gap-1.5 transition hover:text-slate-900"
        >
          <span className="text-slate-400">
            <LinkIcon size={13} />
          </span>
          <span className="truncate">{prettyUrl(link)}</span>
        </a>
      )}
      {!detail.email && !detail.phone && !link && (
        <span className="italic text-slate-400">No contact details yet.</span>
      )}
    </div>
  );
}

function firstUrl(customValues: LeadCustomValues | undefined): string | undefined {
  for (const value of Object.values(customValues ?? {})) {
    if (typeof value === 'string' && isUrl(value.trim())) return value.trim();
  }
  return undefined;
}

function Avatar({ name, size = 'sm' }: { name: string; size?: 'sm' | 'lg' }) {
  const dimensions = size === 'lg' ? 'h-12 w-12 rounded-xl text-base' : 'h-8 w-8 rounded-lg text-[11px]';
  return (
    <span
      aria-hidden="true"
      className={`flex shrink-0 items-center justify-center font-bold text-white ${dimensions} ${avatarColour(name)}`}
    >
      {initialsOf(name)}
    </span>
  );
}

function StatusPill({ label, compact = false }: { label: StatusLabel; compact?: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full font-bold ${
        compact ? 'px-1.5 py-0.5 text-[10px]' : 'px-2.5 py-0.5 text-[11px]'
      }`}
      style={{ backgroundColor: `${label.color}1a`, color: label.color }}
    >
      <span
        aria-hidden="true"
        className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
        style={{ backgroundColor: label.color }}
      />
      {label.label}
    </span>
  );
}

function TabButton({
  active,
  onClick,
  label,
  count,
  children,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      // The visible label carries a count; the accessible name must not, or the tab renames
      // itself every time a file is added.
      aria-label={label}
      aria-current={active ? 'page' : undefined}
      className={`-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-xs font-bold transition ${
        active
          ? 'border-teal-600 text-teal-700'
          : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-800'
      }`}
    >
      <span className={active ? 'text-teal-600' : 'text-slate-400'}>{children}</span>
      <span aria-hidden="true">{label}</span>
      {count !== undefined && count > 0 && (
        <span
          aria-hidden="true"
          className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
            active ? 'bg-teal-100 text-teal-700' : 'bg-slate-100 text-slate-500'
          }`}
        >
          {count}
        </span>
      )}
    </button>
  );
}

function QuickAction({
  label,
  primary = false,
  onClick,
  children,
}: {
  label: string;
  primary?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={`flex h-9 w-9 items-center justify-center rounded-lg border transition ${
        primary
          ? 'border-transparent bg-teal-700 text-white shadow-2xs hover:bg-teal-800'
          : 'border-slate-200 bg-white text-slate-600 shadow-2xs hover:bg-slate-50 hover:text-slate-900'
      }`}
    >
      {children}
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
    <span className={`inline-flex items-center gap-1 rounded-full border font-bold ${size} ${priority.classes}`}>
      <span aria-hidden="true" className={`inline-block h-1.5 w-1.5 rotate-45 ${priority.dotClass}`} />
      {priority.label}
    </span>
  );
}

function classifyPriority(raw: string): { label: string; classes: string; dotClass: string } | null {
  const value = raw.trim().toLowerCase();
  if (!value) return null;
  if (['hot', 'high', 'urgent'].includes(value)) {
    return { label: 'Hot', classes: 'border-rose-200 bg-rose-50 text-rose-700', dotClass: 'bg-rose-500' };
  }
  if (['warm', 'medium', 'med'].includes(value)) {
    return { label: 'Warm', classes: 'border-amber-200 bg-amber-50 text-amber-700', dotClass: 'bg-amber-500' };
  }
  if (['cold', 'low'].includes(value)) {
    return { label: 'Cold', classes: 'border-sky-200 bg-sky-50 text-sky-700', dotClass: 'bg-sky-500' };
  }
  return {
    label: raw.trim(),
    classes: 'border-slate-200 bg-slate-50 text-slate-600',
    dotClass: 'bg-slate-400',
  };
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
