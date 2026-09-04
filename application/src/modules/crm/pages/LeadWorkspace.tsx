import { useEffect, useMemo, useRef, useState } from 'react';
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
  ArrowDownIcon,
  ArrowUpIcon,
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
  PlusIcon,
  RotateCcwIcon,
  SearchIcon,
  SlidersIcon,
  StarIcon,
  TrashIcon,
  XIcon,
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
  const [worklistGroupFilter, setWorklistGroupFilter] = useState('');
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
    queryKey: ['identity', 'users', 'list'],
    queryFn: () => api.get<UserListResponse>(listPath(IDENTITY_PATHS.users, { pageSize: 100 })),
  });

  const userMap = useMemo(() => {
    const map = new Map<string, UserSummary>();
    if (session?.user) {
      map.set(session.user.id, {
        id: session.user.id,
        name: session.user.name,
        email: session.user.email,
        isOwner: session.user.isOwner,
        roles: [],
      });
    }
    for (const u of users.data?.items ?? []) {
      map.set(u.id, u);
    }
    return map;
  }, [session?.user, users.data?.items]);

  const allAvailableUsers = useMemo(() => {
    const map = new Map<string, UserSummary>();
    if (session?.user) {
      map.set(session.user.id, {
        id: session.user.id,
        name: session.user.name,
        email: session.user.email,
        isOwner: session.user.isOwner,
        roles: [],
      });
    }
    for (const u of users.data?.items ?? []) {
      map.set(u.id, u);
    }
    return Array.from(map.values());
  }, [session?.user, users.data?.items]);

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

  const allAssigneeIds =
    detail.assigneeUserIds && detail.assigneeUserIds.length > 0
      ? detail.assigneeUserIds
      : detail.assignedToUserId
        ? [detail.assignedToUserId]
        : [];

  const owner = detail.assignedToUserId ? userMap.get(detail.assignedToUserId) : undefined;
  // Everyone on the lead, primary first, resolved to the people we can name. A lead may now be
  // shared, so the Owner rail lists the set rather than the single primary.
  const assignees = allAssigneeIds.map((id) => {
    const found = userMap.get(id);
    if (found) return found;
    if (id === session?.user?.id) {
      return {
        id: session.user.id,
        name: session.user.name,
        email: session.user.email,
        isOwner: session.user.isOwner,
        roles: [],
      };
    }
    return { id, name: 'Teammate', email: '', isOwner: false, roles: [] };
  });
  const status = statusLabels.of(detail.status);

  return (
    <section aria-label={detail.name} className="flex min-w-0 min-h-[calc(100vh-8rem)] gap-4">
      <Worklist
        open={worklistOpen}
        onToggle={() => setWorklistOpen((open) => !open)}
        leads={worklist.data?.items ?? []}
        activeId={leadId}
        statusOf={statusLabels.of}
        statusList={statusLabels.list}
        currentUserId={session?.user.id}
        lens={worklistLens}
        onLensChange={setWorklistLens}
        search={worklistSearch}
        onSearchChange={setWorklistSearch}
        groupFilter={worklistGroupFilter}
        onGroupFilterChange={setWorklistGroupFilter}
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
              assignees={assignees}
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
        availableUsers={allAvailableUsers}
        currentUserId={session?.user?.id}
        canWrite={canWrite}
        pending={change.isPending}
        customFields={customFields}
        submissions={submissions.data?.items ?? []}
        onAssign={(assigneeUserIds) =>
          change.mutate(() => api.patch<LeadResponse>(LEAD_PATHS.lead(leadId), { assigneeUserIds }))
        }
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
type WorklistLens = string;

export interface WorklistTab {
  id: string;
  label: string;
  dotColor: string;
  filterType: 'status' | 'mine' | 'unassigned' | 'group' | 'source' | 'all';
  filterValue?: string;
}

export const WORKLIST_COLOR_OPTIONS = [
  { label: 'Sky', value: 'bg-sky-500', hex: '#0ea5e9' },
  { label: 'Pink', value: 'bg-pink-500', hex: '#ec4899' },
  { label: 'Violet', value: 'bg-violet-500', hex: '#8b5cf6' },
  { label: 'Teal', value: 'bg-teal-500', hex: '#14b8a6' },
  { label: 'Emerald', value: 'bg-emerald-500', hex: '#10b981' },
  { label: 'Amber', value: 'bg-amber-500', hex: '#f59e0b' },
  { label: 'Orange', value: 'bg-orange-500', hex: '#f97316' },
  { label: 'Rose', value: 'bg-rose-500', hex: '#f43f5e' },
  { label: 'Indigo', value: 'bg-indigo-500', hex: '#6366f1' },
  { label: 'Slate', value: 'bg-slate-500', hex: '#64748b' },
];

export const DEFAULT_WORKLIST_TABS: WorklistTab[] = [
  {
    id: 'new',
    label: 'New leads',
    dotColor: 'bg-sky-500',
    filterType: 'status',
    filterValue: 'new',
  },
  {
    id: 'in_progress',
    label: 'In progress',
    dotColor: 'bg-pink-500',
    filterType: 'status',
    filterValue: 'in_progress',
  },
  {
    id: 'contacted',
    label: 'Contacted',
    dotColor: 'bg-violet-500',
    filterType: 'status',
    filterValue: 'contacted',
  },
  {
    id: 'mine',
    label: 'Assigned to me',
    dotColor: 'bg-teal-500',
    filterType: 'mine',
  },
];

const WORKLIST_TABS_STORAGE_KEY = 'crm_worklist_tabs_';

function loadStoredWorklistTabs(userId?: string): WorklistTab[] {
  if (typeof window === 'undefined') return DEFAULT_WORKLIST_TABS;
  try {
    const raw = localStorage.getItem(`${WORKLIST_TABS_STORAGE_KEY}${userId || 'default'}`);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    }
  } catch {
    // fallback
  }
  return DEFAULT_WORKLIST_TABS;
}

function saveStoredWorklistTabs(userId: string | undefined, tabs: WorklistTab[]) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(`${WORKLIST_TABS_STORAGE_KEY}${userId || 'default'}`, JSON.stringify(tabs));
  } catch {
    // ignore
  }
}

function leadMatchesTab(
  tab: WorklistTab,
  lead: LeadSummary,
  currentUserId?: string,
  statusOf?: (status: LeadSummary['status']) => StatusLabel,
): boolean {
  if (tab.filterType === 'all') return true;

  if (tab.filterType === 'mine') {
    if (!currentUserId) return false;
    const ids = lead.assigneeUserIds ?? (lead.assignedToUserId ? [lead.assignedToUserId] : []);
    return ids.includes(currentUserId);
  }

  if (tab.filterType === 'unassigned') {
    const ids = lead.assigneeUserIds ?? (lead.assignedToUserId ? [lead.assignedToUserId] : []);
    return ids.length === 0;
  }

  if (tab.filterType === 'group') {
    return (lead.groupName || '').toLowerCase() === (tab.filterValue || '').toLowerCase();
  }

  if (tab.filterType === 'source') {
    const src = (lead.sourceName || lead.source || '').toLowerCase();
    return src === (tab.filterValue || '').toLowerCase();
  }

  if (tab.filterType === 'status') {
    const target = (tab.filterValue || tab.id).toLowerCase();
    const statusKey = lead.status.toLowerCase();
    const lbl = statusOf ? statusOf(lead.status).label.toLowerCase() : '';

    if (target === 'new') {
      return statusKey === 'new' || lbl.includes('new');
    }
    if (target === 'in_progress' || target === 'in-progress') {
      return (
        lbl.includes('progress') ||
        statusKey === 'in_progress' ||
        statusKey === 'in-progress'
      );
    }
    if (target === 'contacted' || target === 'contracted') {
      if (lbl.includes('progress') || statusKey === 'in_progress' || statusKey === 'in-progress') {
        return false;
      }
      return (
        statusKey === 'contacted' ||
        statusKey === 'contracted' ||
        lbl.includes('contact') ||
        lbl.includes('contract')
      );
    }
    return statusKey === target || lbl === target || lbl.includes(target);
  }

  return true;
}

function Worklist({
  open,
  onToggle,
  leads,
  activeId,
  statusOf,
  statusList,
  currentUserId,
  lens,
  onLensChange,
  search,
  onSearchChange,
  groupFilter,
  onGroupFilterChange,
}: {
  open: boolean;
  onToggle: () => void;
  leads: LeadSummary[];
  activeId: string;
  statusOf: (status: LeadSummary['status']) => StatusLabel;
  statusList?: StatusLabel[];
  currentUserId: string | undefined;
  // Lifted to the parent so the chosen filter and search survive lead-to-lead navigation — the
  // detail query re-pends on each click and its loading gate briefly unmounts this component.
  lens: string | undefined;
  onLensChange: (lens: string | undefined) => void;
  search: string;
  onSearchChange: (search: string) => void;
  groupFilter: string;
  onGroupFilterChange: (group: string) => void;
}) {
  const [tabs, setTabs] = useState<WorklistTab[]>(() => loadStoredWorklistTabs(currentUserId));
  const [manageTabsOpen, setManageTabsOpen] = useState(false);

  useEffect(() => {
    setTabs(loadStoredWorklistTabs(currentUserId));
  }, [currentUserId]);

  const updateTabs = (newTabs: WorklistTab[]) => {
    setTabs(newTabs);
    saveStoredWorklistTabs(currentUserId, newTabs);
  };

  const availableGroups = useMemo(() => {
    const set = new Set<string>();
    for (const lead of leads) {
      if (lead.groupName) set.add(lead.groupName);
    }
    return Array.from(set).sort();
  }, [leads]);

  const availableSources = useMemo(() => {
    const set = new Set<string>();
    for (const lead of leads) {
      const src = lead.sourceName || lead.source;
      if (src) set.add(src);
    }
    return Array.from(set).sort();
  }, [leads]);

  const activeTab = useMemo(() => tabs.find((t) => t.id === lens), [tabs, lens]);

  const shown = useMemo(() => {
    const term = search.trim().toLowerCase();
    return leads
      .filter((lead) => (activeTab ? leadMatchesTab(activeTab, lead, currentUserId, statusOf) : true))
      .filter((lead) => (groupFilter ? lead.groupName === groupFilter : true))
      .filter((lead) => (term ? lead.name.toLowerCase().includes(term) : true));
  }, [leads, search, activeTab, groupFilter, currentUserId, statusOf]);

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
      <div className="shrink-0 sticky top-20">
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
    <>
      <aside
        aria-label="Worklist"
        className="sticky top-20 flex w-[320px] shrink-0 flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-3.5 shadow-2xs h-[calc(100vh-6.5rem)] max-h-[calc(100vh-6.5rem)] overflow-hidden self-start"
      >
        <div className="flex items-center justify-between gap-2 shrink-0 pb-1 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-teal-50 text-teal-600">
              <ListIcon size={15} />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-900 leading-tight">Worklist</h2>
              <span className="text-[10px] text-slate-400 font-medium">{shown.length} {shown.length === 1 ? 'lead' : 'leads'}</span>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setManageTabsOpen(true)}
              aria-label="Customize tabs"
              title="Add or rearrange tabs"
              className="flex items-center justify-center h-7 w-7 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition"
            >
              <SlidersIcon size={14} />
            </button>
            <button
              type="button"
              onClick={onToggle}
              aria-label="Collapse worklist"
              title="Collapse worklist"
              className="flex items-center justify-center h-7 w-7 rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
            >
              <ChevronLeftIcon size={15} />
            </button>
          </div>
        </div>

        <div className="flex flex-col gap-1.5 shrink-0">
          <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto pr-0.5">
            {tabs.map((tab) => {
              const count = leads.filter((l) => leadMatchesTab(tab, l, currentUserId, statusOf)).length;
              const isActive = lens === tab.id;
              return (
                <StatTile
                  key={tab.id}
                  label={tab.label}
                  dotClass={tab.dotColor}
                  count={count}
                  active={isActive}
                  onClick={() => onLensChange(isActive ? undefined : tab.id)}
                />
              );
            })}
          </div>
          <button
            type="button"
            onClick={() => setManageTabsOpen(true)}
            className="flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-slate-200/90 py-1 text-[11px] font-semibold text-slate-500 hover:border-teal-300 hover:bg-teal-50/30 hover:text-teal-700 transition cursor-pointer"
          >
            <PlusIcon size={12} />
            <span>Add / Arrange tabs</span>
          </button>
        </div>

        <div className="flex flex-col gap-2 shrink-0">
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
              className="w-full rounded-lg border border-slate-200 bg-slate-50/40 py-1.5 pl-8 pr-7 text-xs text-slate-900 placeholder:text-slate-400 focus:bg-white focus:border-teal-500 focus:ring-2 focus:ring-teal-100 focus:outline-none transition"
            />
            {search && (
              <button
                type="button"
                onClick={() => onSearchChange('')}
                aria-label="Clear search"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition p-0.5"
              >
                <XIcon size={12} />
              </button>
            )}
          </div>

          {availableGroups.length > 0 && (
            <select
              aria-label="Filter by group"
              value={groupFilter}
              onChange={(event) => onGroupFilterChange(event.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-slate-50/40 py-1.5 px-2.5 text-xs font-semibold text-slate-700 focus:bg-white focus:border-teal-500 focus:ring-2 focus:ring-teal-100 focus:outline-none cursor-pointer transition"
            >
              <option value="">All Groups ({availableGroups.length})</option>
              {availableGroups.map((group) => (
                <option key={group} value={group}>
                  {group}
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="flex flex-col gap-3.5 overflow-y-auto min-h-0 flex-1 pr-1 overscroll-contain">
          {groups.map(([sourceName, entries]) => (
            <div key={sourceName} className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between px-1 py-0.5">
                <h3 className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  {sourceName} · {entries.length}
                </h3>
              </div>
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
            <div className="px-2 py-8 text-center">
              <p className="text-xs font-semibold text-slate-500">No leads found</p>
              <p className="text-[11px] text-slate-400 mt-0.5">Try adjusting your search or tab filter.</p>
            </div>
          )}
        </div>
      </aside>

      {manageTabsOpen && (
        <ManageWorklistTabsModal
          isOpen={manageTabsOpen}
          onClose={() => setManageTabsOpen(false)}
          tabs={tabs}
          onUpdateTabs={updateTabs}
          availableGroups={availableGroups}
          availableSources={availableSources}
          statusList={statusList}
        />
      )}
    </>
  );
}

function ManageWorklistTabsModal({
  isOpen,
  onClose,
  tabs,
  onUpdateTabs,
  availableGroups,
  availableSources,
  statusList,
}: {
  isOpen: boolean;
  onClose: () => void;
  tabs: WorklistTab[];
  onUpdateTabs: (tabs: WorklistTab[]) => void;
  availableGroups: string[];
  availableSources: string[];
  statusList?: StatusLabel[];
}) {
  const [currentTabs, setCurrentTabs] = useState<WorklistTab[]>(tabs);
  const [newTabLabel, setNewTabLabel] = useState('');
  const [newTabFilterType, setNewTabFilterType] = useState<WorklistTab['filterType']>('status');
  const [newTabFilterValue, setNewTabFilterValue] = useState('');
  const [newTabColor, setNewTabColor] = useState(WORKLIST_COLOR_OPTIONS[4]?.value ?? 'bg-emerald-500');
  const [errorMsg, setErrorMsg] = useState('');

  if (!isOpen) return null;

  const moveUp = (index: number) => {
    if (index <= 0 || index >= currentTabs.length) return;
    const next = [...currentTabs];
    const prevItem = next[index - 1];
    const currItem = next[index];
    if (prevItem && currItem) {
      next[index] = prevItem;
      next[index - 1] = currItem;
      setCurrentTabs(next);
      onUpdateTabs(next);
    }
  };

  const moveDown = (index: number) => {
    if (index < 0 || index >= currentTabs.length - 1) return;
    const next = [...currentTabs];
    const nextItem = next[index + 1];
    const currItem = next[index];
    if (nextItem && currItem) {
      next[index] = nextItem;
      next[index + 1] = currItem;
      setCurrentTabs(next);
      onUpdateTabs(next);
    }
  };

  const removeTab = (id: string) => {
    if (currentTabs.length <= 1) {
      setErrorMsg('You must have at least one tab.');
      return;
    }
    const next = currentTabs.filter((t) => t.id !== id);
    setCurrentTabs(next);
    onUpdateTabs(next);
    setErrorMsg('');
  };

  const resetToDefaults = () => {
    setCurrentTabs(DEFAULT_WORKLIST_TABS);
    onUpdateTabs(DEFAULT_WORKLIST_TABS);
    setErrorMsg('');
  };

  const addPreset = (label: string, filterType: WorklistTab['filterType'], filterValue: string, dotColor: string) => {
    const id = `tab_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const newTab: WorklistTab = {
      id,
      label,
      filterType,
      filterValue,
      dotColor,
    };
    const next = [...currentTabs, newTab];
    setCurrentTabs(next);
    onUpdateTabs(next);
    setErrorMsg('');
  };

  const handleAddCustomTab = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newTabLabel.trim();
    if (!trimmed) {
      setErrorMsg('Please enter a tab label.');
      return;
    }

    const id = `tab_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const newTab: WorklistTab = {
      id,
      label: trimmed,
      filterType: newTabFilterType,
      filterValue: newTabFilterValue,
      dotColor: newTabColor,
    };

    const next = [...currentTabs, newTab];
    setCurrentTabs(next);
    onUpdateTabs(next);
    setNewTabLabel('');
    setNewTabFilterValue('');
    setErrorMsg('');
  };

  const presets: { label: string; filterType: WorklistTab['filterType']; filterValue: string; dotColor: string }[] = [
    { label: 'Qualified', filterType: 'status', filterValue: 'qualified', dotColor: 'bg-emerald-500' },
    { label: 'Disqualified', filterType: 'status', filterValue: 'disqualified', dotColor: 'bg-rose-500' },
    { label: 'Unassigned', filterType: 'unassigned', filterValue: '', dotColor: 'bg-amber-500' },
  ];

  if (statusList) {
    for (const s of statusList) {
      if (!['new', 'in_progress', 'contacted', 'qualified', 'disqualified'].includes(s.status)) {
        presets.push({
          label: s.label,
          filterType: 'status',
          filterValue: s.status,
          dotColor: 'bg-indigo-500',
        });
      }
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="manage-tabs-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4"
    >
      <div className="flex flex-col w-full max-w-lg rounded-2xl bg-white shadow-xl border border-slate-200 max-h-[90vh] overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <div>
            <h3 id="manage-tabs-title" className="text-base font-bold text-slate-900">
              Manage Worklist Tabs
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Rearrange your tabs or add new filtered views to your worklist.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition"
          >
            <XIcon size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {errorMsg && (
            <div className="rounded-lg bg-rose-50 border border-rose-200 px-3 py-2 text-xs font-semibold text-rose-700">
              {errorMsg}
            </div>
          )}

          <div>
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                Active Tabs ({currentTabs.length})
              </h4>
              <button
                type="button"
                onClick={resetToDefaults}
                className="flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-teal-600 transition"
              >
                <RotateCcwIcon size={12} />
                <span>Reset to defaults</span>
              </button>
            </div>

            <div className="space-y-1.5">
              {currentTabs.map((tab, idx) => (
                <div
                  key={tab.id}
                  className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50/50 px-3 py-2 text-sm"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${tab.dotColor}`} />
                    <span className="font-semibold text-slate-900 truncate text-xs">{tab.label}</span>
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">
                      {tab.filterType === 'status'
                        ? `status: ${tab.filterValue || tab.id}`
                        : tab.filterType === 'mine'
                        ? 'assigned to me'
                        : tab.filterType === 'unassigned'
                        ? 'unassigned'
                        : tab.filterType}
                    </span>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => moveUp(idx)}
                      disabled={idx === 0}
                      aria-label={`Move ${tab.label} up`}
                      className="rounded p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-700 disabled:opacity-30 disabled:pointer-events-none transition"
                    >
                      <ArrowUpIcon size={14} />
                    </button>
                    <button
                      type="button"
                      onClick={() => moveDown(idx)}
                      disabled={idx === currentTabs.length - 1}
                      aria-label={`Move ${tab.label} down`}
                      className="rounded p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-700 disabled:opacity-30 disabled:pointer-events-none transition"
                    >
                      <ArrowDownIcon size={14} />
                    </button>
                    <button
                      type="button"
                      onClick={() => removeTab(tab.id)}
                      disabled={currentTabs.length <= 1}
                      aria-label={`Remove ${tab.label}`}
                      className="rounded p-1 text-slate-400 hover:bg-rose-100 hover:text-rose-600 disabled:opacity-30 disabled:pointer-events-none transition ml-1"
                    >
                      <TrashIcon size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {presets.filter((p) => !currentTabs.some((t) => t.label.toLowerCase() === p.label.toLowerCase())).length > 0 && (
            <div>
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">
                Quick Presets
              </h4>
              <div className="flex flex-wrap gap-2">
                {presets
                  .filter((p) => !currentTabs.some((t) => t.label.toLowerCase() === p.label.toLowerCase()))
                  .map((preset) => (
                    <button
                      key={preset.label}
                      type="button"
                      onClick={() => addPreset(preset.label, preset.filterType, preset.filterValue, preset.dotColor)}
                      className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:border-teal-400 hover:bg-teal-50/50 hover:text-teal-700 transition"
                    >
                      <PlusIcon size={12} />
                      <span className={`inline-block h-2 w-2 rounded-full ${preset.dotColor}`} />
                      <span>{preset.label}</span>
                    </button>
                  ))}
              </div>
            </div>
          )}

          <form onSubmit={handleAddCustomTab} className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700">
              Add Custom Tab
            </h4>

            <div>
              <label htmlFor="custom-tab-label" className="block text-xs font-semibold text-slate-600 mb-1">
                Tab Name
              </label>
              <input
                id="custom-tab-label"
                type="text"
                value={newTabLabel}
                onChange={(e) => setNewTabLabel(e.target.value)}
                placeholder="e.g. VIP Leads, High Priority, Follow-up"
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-teal-500 focus:outline-none"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="custom-tab-filter-type" className="block text-xs font-semibold text-slate-600 mb-1">
                  Filter Condition
                </label>
                <select
                  id="custom-tab-filter-type"
                  value={newTabFilterType}
                  onChange={(e) => {
                    const val = e.target.value as WorklistTab['filterType'];
                    setNewTabFilterType(val);
                    if (val === 'mine' || val === 'unassigned' || val === 'all') {
                      setNewTabFilterValue('');
                    }
                  }}
                  className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs font-medium text-slate-700 focus:border-teal-500 focus:outline-none cursor-pointer"
                >
                  <option value="status">By Status</option>
                  <option value="mine">Assigned to me</option>
                  <option value="unassigned">Unassigned</option>
                  <option value="group">By Group</option>
                  <option value="source">By Source</option>
                  <option value="all">All Leads</option>
                </select>
              </div>

              {newTabFilterType === 'status' && (
                <div>
                  <label htmlFor="custom-tab-status-val" className="block text-xs font-semibold text-slate-600 mb-1">
                    Select Status
                  </label>
                  <select
                    id="custom-tab-status-val"
                    value={newTabFilterValue}
                    onChange={(e) => setNewTabFilterValue(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs font-medium text-slate-700 focus:border-teal-500 focus:outline-none cursor-pointer"
                  >
                    <option value="">Choose status...</option>
                    <option value="new">New</option>
                    <option value="in_progress">In Progress</option>
                    <option value="contacted">Contacted</option>
                    <option value="qualified">Qualified</option>
                    <option value="disqualified">Disqualified</option>
                    {statusList?.filter((s) => !['new', 'in_progress', 'contacted', 'qualified', 'disqualified'].includes(s.status)).map((s) => (
                      <option key={s.status} value={s.status}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {newTabFilterType === 'group' && (
                <div>
                  <label htmlFor="custom-tab-group-val" className="block text-xs font-semibold text-slate-600 mb-1">
                    Select Group
                  </label>
                  <select
                    id="custom-tab-group-val"
                    value={newTabFilterValue}
                    onChange={(e) => setNewTabFilterValue(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs font-medium text-slate-700 focus:border-teal-500 focus:outline-none cursor-pointer"
                  >
                    <option value="">Choose group...</option>
                    {availableGroups.map((g) => (
                      <option key={g} value={g}>
                        {g}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {newTabFilterType === 'source' && (
                <div>
                  <label htmlFor="custom-tab-source-val" className="block text-xs font-semibold text-slate-600 mb-1">
                    Select Source
                  </label>
                  <select
                    id="custom-tab-source-val"
                    value={newTabFilterValue}
                    onChange={(e) => setNewTabFilterValue(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs font-medium text-slate-700 focus:border-teal-500 focus:outline-none cursor-pointer"
                  >
                    <option value="">Choose source...</option>
                    {availableSources.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1.5">
                Dot Color
              </label>
              <div className="flex flex-wrap items-center gap-2">
                {WORKLIST_COLOR_OPTIONS.map((c) => (
                  <button
                    key={c.value}
                    type="button"
                    title={c.label}
                    onClick={() => setNewTabColor(c.value)}
                    className={`h-6 w-6 rounded-full ${c.value} transition cursor-pointer ${
                      newTabColor === c.value ? 'ring-2 ring-slate-900 ring-offset-2 scale-110' : 'hover:scale-105'
                    }`}
                  />
                ))}
              </div>
            </div>

            <button
              type="submit"
              className="w-full rounded-lg bg-slate-900 py-2 text-xs font-bold text-white hover:bg-slate-800 transition mt-2 cursor-pointer"
            >
              + Add Tab to Worklist
            </button>
          </form>
        </div>

        <div className="border-t border-slate-100 px-6 py-3 bg-slate-50/50 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-teal-600 px-4 py-2 text-xs font-bold text-white hover:bg-teal-500 transition shadow-xs cursor-pointer"
          >
            Done
          </button>
        </div>
      </div>
    </div>
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
      className={`group relative flex flex-col justify-between rounded-xl border p-2 text-left transition-all duration-150 cursor-pointer ${
        active
          ? 'border-teal-500 bg-teal-50/80 shadow-2xs ring-1 ring-teal-400/30'
          : 'border-slate-200/80 bg-slate-50/50 hover:border-slate-300 hover:bg-white'
      }`}
    >
      <div className="flex items-center justify-between w-full">
        <span className={`text-base font-extrabold tracking-tight leading-none ${active ? 'text-teal-950' : 'text-slate-900'}`}>
          {count}
        </span>
        <span aria-hidden="true" className={`inline-block h-2 w-2 shrink-0 rounded-full ${dotClass} shadow-2xs`} />
      </div>
      <span className={`mt-1 truncate text-[11px] font-semibold leading-tight ${active ? 'text-teal-900' : 'text-slate-500'}`}>
        {label}
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
      className={`group relative flex w-full items-start gap-2.5 rounded-xl border p-2.5 text-left transition-all duration-150 cursor-pointer ${
        active
          ? 'border-teal-500 bg-teal-50/80 ring-1 ring-teal-400/40 shadow-xs'
          : 'border-slate-200/80 bg-white hover:border-slate-300 hover:bg-slate-50/70 shadow-2xs'
      }`}
    >
      {/* Active left indicator */}
      {active && (
        <span
          aria-hidden="true"
          className="absolute left-0 top-2 bottom-2 w-1 rounded-r-full bg-teal-600"
        />
      )}

      {/* Avatar */}
      <span
        aria-hidden="true"
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg font-bold text-white text-[11px] shadow-2xs transition-transform group-hover:scale-105 ${avatarColour(lead.name)}`}
      >
        {initialsOf(lead.name)}
      </span>

      {/* Lead info */}
      <span className="flex min-w-0 flex-1 flex-col justify-center">
        <span
          className={`truncate text-xs font-bold leading-snug ${active ? 'text-teal-950' : 'text-slate-900'}`}
          title={lead.name}
        >
          {lead.name}
        </span>
        {lead.organisationName && (
          <span
            className="truncate text-[11px] text-slate-500 font-medium leading-tight mt-0.5"
            title={lead.organisationName}
          >
            {lead.organisationName}
          </span>
        )}
        <span className="mt-1.5 flex items-center gap-1.5 min-w-0 flex-wrap">
          <StatusPill label={label} compact />
          {lead.groupName && (
            <span
              className="inline-flex items-center rounded-md bg-slate-100/90 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600 max-w-[125px] truncate shrink-0"
              title={lead.groupName}
            >
              {lead.groupName}
            </span>
          )}
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
  availableUsers,
  currentUserId,
  canWrite,
  pending,
  customFields,
  submissions,
  onAssign,
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
  availableUsers: UserSummary[];
  currentUserId?: string;
  canWrite: boolean;
  pending: boolean;
  customFields: LeadFieldSummary[];
  submissions: LeadSubmissionListResponse['items'];
  onAssign: (userIds: string[]) => void;
  onQualify: () => void;
  onReopen: () => void;
  onOpenSurvey: () => void;
}) {
  const { session } = useSession();
  const canReadActivities = hasPermission(session, 'crm:activities:read');
  const queryClient = useQueryClient();
  const [isAssigning, setIsAssigning] = useState(false);

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

        <RailField label="Group">
          {detail.groupName ? (
            <span className="inline-flex items-center rounded-md bg-teal-50 px-2 py-0.5 text-[11px] font-bold text-teal-800 border border-teal-200">
              {detail.groupName}
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
        <div className="flex items-center justify-between">
          <h2 className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
            {assignees.length > 1 ? `Assigned Team (${assignees.length})` : 'Owner & Team'}
          </h2>
          {canWrite && (
            <button
              type="button"
              onClick={() => setIsAssigning(true)}
              className="text-[11px] font-bold text-teal-700 hover:text-teal-900 transition flex items-center gap-1 cursor-pointer"
            >
              <span>+</span> Manage
            </button>
          )}
        </div>

        {assignees.length > 0 ? (
          <div className="flex flex-col gap-2.5">
            {assignees.map((person, idx) => (
              <div key={person.id || idx} className="flex items-center justify-between gap-2.5">
                <div className="flex items-center gap-2.5 min-w-0">
                  <Avatar name={person.name} />
                  <div className="flex flex-col min-w-0">
                    <span className="truncate text-xs font-bold text-slate-800">
                      {person.name}
                      {person.id === currentUserId && (
                        <span className="ml-1.5 text-[10px] font-semibold text-teal-700 bg-teal-50 px-1.5 py-0.5 rounded border border-teal-200">
                          You
                        </span>
                      )}
                    </span>
                    {person.email && (
                      <span className="truncate text-[10px] text-slate-400">{person.email}</span>
                    )}
                  </div>
                </div>
                {person.id === detail.assignedToUserId && (
                  <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">
                    Primary
                  </span>
                )}
              </div>
            ))}
          </div>
        ) : detail.assignedToUserId ? (
          // A primary is set but no one on it resolves to a current member.
          <div className="flex items-center gap-2.5">
            <Avatar name={owner?.name ?? 'Unknown'} />
            <span className="min-w-0 truncate text-xs font-bold text-slate-800">
              {owner?.name ?? 'Assigned teammate'}
            </span>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2 py-2 text-center">
            <p className="text-xs text-slate-400">Unassigned</p>
            {canWrite && (
              <button
                type="button"
                onClick={() => setIsAssigning(true)}
                className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-100 transition cursor-pointer"
              >
                + Assign Teammates
              </button>
            )}
          </div>
        )}
      </div>

      {isAssigning && (
        <AssignTeammatesModal
          leadName={detail.name}
          assignedUserIds={assignees.map((a) => a.id)}
          availableUsers={availableUsers}
          currentUserId={currentUserId}
          isPending={pending}
          onSave={(userIds) => {
            onAssign(userIds);
            setIsAssigning(false);
          }}
          onClose={() => setIsAssigning(false)}
        />
      )}
    </aside>
  );
}

function AssignTeammatesModal({
  leadName,
  assignedUserIds,
  availableUsers,
  currentUserId,
  onSave,
  onClose,
  isPending,
}: {
  leadName: string;
  assignedUserIds: string[];
  availableUsers: UserSummary[];
  currentUserId?: string;
  onSave: (userIds: string[]) => void;
  onClose: () => void;
  isPending: boolean;
}) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set(assignedUserIds));

  function toggle(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Manage Assigned Team"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 animate-in fade-in duration-150"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex w-full max-w-md flex-col rounded-2xl bg-white shadow-2xl overflow-hidden border border-slate-200">
        <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-5 py-3.5">
          <div>
            <h2 className="text-sm font-bold text-slate-900">Manage Assigned Team</h2>
            <p className="text-xs text-slate-500 truncate">For {leadName}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition cursor-pointer"
          >
            ✕
          </button>
        </div>

        <div className="flex flex-col gap-2 p-5 max-h-[50vh] overflow-y-auto">
          {availableUsers.length === 0 && (
            <p className="py-4 text-center text-xs text-slate-500">No team members found.</p>
          )}
          {availableUsers.map((user) => {
            const isSelected = selectedIds.has(user.id);
            return (
              <label
                key={user.id}
                className={`flex items-center justify-between gap-3 p-2.5 rounded-xl border cursor-pointer transition ${
                  isSelected
                    ? 'border-teal-300 bg-teal-50/70'
                    : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                }`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <Avatar name={user.name} />
                  <div className="flex flex-col min-w-0">
                    <span className="truncate text-xs font-bold text-slate-800">
                      {user.name} {user.id === currentUserId && '(You)'}
                    </span>
                    {user.email && (
                      <span className="truncate text-[10px] text-slate-400">{user.email}</span>
                    )}
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => toggle(user.id)}
                  className="rounded border-slate-300 text-teal-600 focus:ring-teal-500 h-4 w-4 cursor-pointer"
                />
              </label>
            );
          })}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-300 bg-white px-3.5 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50 transition cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={isPending}
            onClick={() => onSave(Array.from(selectedIds))}
            className="rounded-lg bg-teal-700 px-4 py-1.5 text-xs font-bold text-white shadow-2xs hover:bg-teal-800 transition disabled:opacity-50 cursor-pointer"
          >
            {isPending ? 'Saving…' : 'Save Team'}
          </button>
        </div>
      </div>
    </div>
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
  assignees = [],
  canReadUsers,
  customFields,
}: {
  detail: LeadResponse;
  sourceLabel: string;
  owner: UserSummary | undefined;
  assignees?: UserSummary[];
  canReadUsers: boolean;
  customFields: LeadFieldSummary[];
}) {
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
        <DetailRow label="Group" value={detail.groupName ?? '—'} />
        <DetailRow label="Team / Assignees">
          {assignees.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {assignees.map((person) => (
                <span
                  key={person.id}
                  className="inline-flex items-center gap-1.5 rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-700"
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-teal-500" />
                  {person.name}
                  {person.id === detail.assignedToUserId && (
                    <span className="text-[10px] text-slate-500 font-normal">(Primary)</span>
                  )}
                </span>
              ))}
            </div>
          ) : (
            <span className="text-xs text-slate-400 italic">Unassigned</span>
          )}
        </DetailRow>
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
      className={`inline-flex items-center gap-1.5 rounded-full font-bold whitespace-nowrap shrink-0 ${
        compact ? 'px-2 py-0.5 text-[10px]' : 'px-2.5 py-0.5 text-[11px]'
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
    <span className={`inline-flex items-center gap-1 rounded-full border font-bold whitespace-nowrap shrink-0 ${size} ${priority.classes}`}>
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
