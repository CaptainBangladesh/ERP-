import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ACTIVITY_PATHS,
  type ActivityListResponse,
  type ActivityResponse,
  type ActivityType,
  type CreateActivityRequest,
} from '@erp/shared';
import { ApiFailure, api } from '../../../api/client';
import { useSession } from '../../../session/SessionProvider';
import { hasPermission } from '../../../session/permissions';
import { isSystemAudit } from '../activity-audit';

/**
 * The Timeline as one filterable feed, labelled **Activity** because that is what users call it.
 *
 * It reads the one endpoint that already interleaves the two kinds of entry the glossary keeps
 * apart — person-authored **Activities** (a note, call, meeting, task) and system-recorded
 * **Audit events** (status changed, file attached, survey received), the latter tagged with a
 * leading emoji by the backend. No separate audit-log endpoint exists, and none is wanted: the
 * whole point of the workspace is that everything that happened to a lead is in one place.
 */

const TYPE_LABELS: Record<ActivityType, string> = {
  call: 'Call',
  email: 'Email',
  meeting: 'Meeting',
  note: 'Note',
  task: 'Task',
};

const TYPE_BADGE_CLASSES: Record<ActivityType, string> = {
  call: 'bg-indigo-100 text-indigo-800 border-indigo-200',
  email: 'bg-blue-100 text-blue-800 border-blue-200',
  meeting: 'bg-purple-100 text-purple-800 border-purple-200',
  note: 'bg-amber-100 text-amber-800 border-amber-200',
  task: 'bg-emerald-100 text-emerald-800 border-emerald-200',
};

/** The kinds a person may log straight from the feed. Email goes out through Send email, not here. */
const COMPOSER_TYPES: ActivityType[] = ['note', 'call', 'meeting', 'task'];

/** The four buckets the feed filters by — the glossary's coarse cut, not the five activity types. */
export const FEED_FILTERS = ['all', 'email', 'notes', 'system'] as const;
export type FeedFilter = (typeof FEED_FILTERS)[number];

const FILTER_LABELS: Record<FeedFilter, string> = {
  all: 'All',
  email: 'Email',
  notes: 'Notes',
  system: 'System',
};

function matchesFilter(activity: ActivityResponse, filter: FeedFilter): boolean {
  if (filter === 'all') return true;
  const system = isSystemAudit(activity.notes);
  if (filter === 'system') return system;
  if (system) return false;
  if (filter === 'email') return activity.type === 'email';
  // notes: everything a person logged that is not correspondence — note, call, meeting, task.
  return activity.type !== 'email';
}

export function LeadActivityFeed({
  leadId,
  composerType,
  onComposerTypeChange,
  composerFocusSignal = 0,
}: {
  leadId: string;
  /** Controlled so the header's quick-action icons can preload the composer with a kind. */
  composerType: ActivityType;
  onComposerTypeChange: (type: ActivityType) => void;
  /** Bumped by the parent when a quick action wants the composer focused. */
  composerFocusSignal?: number;
}) {
  const { session } = useSession();
  const canWrite = hasPermission(session, 'crm:activities:write');
  const canRead = hasPermission(session, 'crm:activities:read');
  const queryClient = useQueryClient();

  const [filter, setFilter] = useState<FeedFilter>('all');
  const [notes, setNotes] = useState('');
  const notesRef = useRef<HTMLTextAreaElement>(null);

  const queryKey = ['crm', 'activities', 'lead', leadId];

  const { data, isPending, error } = useQuery({
    queryKey,
    queryFn: () => api.get<ActivityListResponse>(ACTIVITY_PATHS.leadActivities(leadId)),
    enabled: canRead && Boolean(leadId),
  });

  const log = useMutation({
    mutationFn: (body: CreateActivityRequest) => api.post<ActivityResponse>(ACTIVITY_PATHS.activities, body),
    onSuccess: () => {
      setNotes('');
      void queryClient.invalidateQueries({ queryKey });
    },
  });

  const complete = useMutation({
    mutationFn: ({ id, completed }: { id: string; completed: boolean }) =>
      api.post<ActivityResponse>(completed ? ACTIVITY_PATHS.reopenTask(id) : ACTIVITY_PATHS.completeTask(id)),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey }),
  });

  // A quick-action icon in the header preloads the kind and asks for focus; honour it here.
  useEffect(() => {
    if (composerFocusSignal > 0) notesRef.current?.focus();
  }, [composerFocusSignal]);

  const failure = log.error instanceof ApiFailure ? log.error : undefined;

  if (!canRead) return null;

  const activities = data?.items ?? [];
  const shown = activities.filter((activity) => matchesFilter(activity, filter));

  return (
    <section aria-labelledby="lead-activity-heading" className="flex flex-col gap-4">
      {canWrite && (
        <form
          aria-label="Log an activity"
          onSubmit={(event) => {
            event.preventDefault();
            if (!notes.trim() || log.isPending) return;
            log.mutate({ type: composerType, notes: notes.trim(), leadId });
          }}
          className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-3 shadow-2xs"
        >
          <div className="flex items-center gap-2">
            <select
              aria-label="Activity type"
              value={composerType}
              onChange={(event) => onComposerTypeChange(event.target.value as ActivityType)}
              className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 focus:border-teal-500 focus:outline-none"
            >
              {COMPOSER_TYPES.map((type) => (
                <option key={type} value={type}>
                  {TYPE_LABELS[type]}
                </option>
              ))}
            </select>
            <span className="text-xs text-slate-400">Log what just happened with this lead.</span>
          </div>

          <textarea
            ref={notesRef}
            aria-label="Activity notes"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            rows={2}
            placeholder="Add a note, log a call…"
            className="w-full rounded-lg border border-slate-200 p-2.5 text-xs text-slate-900 placeholder:text-slate-400 focus:border-teal-500 focus:outline-none"
          />

          {failure && (
            <p role="alert" className="text-xs font-semibold text-rose-600">
              {failure.fields.notes ?? failure.message}
            </p>
          )}

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={!notes.trim() || log.isPending}
              className="rounded-lg bg-teal-700 px-3.5 py-1.5 text-xs font-bold text-white transition hover:bg-teal-800 disabled:opacity-50"
            >
              {log.isPending ? 'Logging…' : 'Log activity'}
            </button>
          </div>
        </form>
      )}

      <div className="flex items-center justify-between gap-2">
        <h3 id="lead-activity-heading" className="text-sm font-bold text-slate-900">
          Activity
        </h3>
        <div role="tablist" aria-label="Filter activity" className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 p-0.5">
          {FEED_FILTERS.map((option) => (
            <button
              key={option}
              type="button"
              role="tab"
              aria-selected={filter === option}
              onClick={() => setFilter(option)}
              className={`rounded-md px-2.5 py-1 text-xs font-semibold transition ${
                filter === option ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              {FILTER_LABELS[option]}
            </button>
          ))}
        </div>
      </div>

      {isPending && (
        <p role="status" className="text-xs text-slate-500">
          Loading activity…
        </p>
      )}

      {error && (
        <p role="alert" className="text-xs text-rose-600">
          That lead’s activity could not be loaded.
        </p>
      )}

      {!isPending && !error && shown.length === 0 && (
        <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50/60 py-6 text-center text-xs text-slate-500">
          {filter === 'all' ? 'Nothing has happened with this lead yet.' : `No ${FILTER_LABELS[filter].toLowerCase()} entries.`}
        </p>
      )}

      <ul className="flex flex-col gap-2.5">
        {shown.map((activity) => (
          <FeedEntry
            key={activity.id}
            activity={activity}
            canWrite={canWrite}
            onToggleComplete={() => complete.mutate({ id: activity.id, completed: Boolean(activity.completedAt) })}
          />
        ))}
      </ul>
    </section>
  );
}

function FeedEntry({
  activity,
  canWrite,
  onToggleComplete,
}: {
  activity: ActivityResponse;
  canWrite: boolean;
  onToggleComplete: () => void;
}) {
  const system = isSystemAudit(activity.notes);
  const isTask = activity.type === 'task';
  const isCompleted = Boolean(activity.completedAt);
  const when = new Date(activity.occurredAt).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  return (
    <li
      className={`flex flex-col gap-1.5 rounded-xl border p-3.5 shadow-2xs ${
        system ? 'border-slate-200 bg-slate-50/70' : 'border-slate-200 bg-white'
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span
            className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
              system ? 'border-slate-300 bg-slate-200 text-slate-700' : TYPE_BADGE_CLASSES[activity.type]
            }`}
          >
            {system ? 'System' : TYPE_LABELS[activity.type]}
          </span>
          {isTask && !system && (
            <span className={`text-[11px] font-semibold ${isCompleted ? 'text-emerald-700' : 'text-amber-700'}`}>
              {isCompleted ? '✓ Done' : '⏳ Pending'}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 text-[11px] font-medium text-slate-500">
          <span>{when}</span>
          <span aria-hidden="true">·</span>
          <span className="font-semibold text-slate-700">{activity.createdByName}</span>
        </div>
      </div>

      <p className="whitespace-pre-wrap text-xs leading-relaxed text-slate-800">{activity.notes}</p>

      {isTask && !system && canWrite && (
        <label className="flex items-center gap-2 pt-1 text-[11px] font-medium text-slate-700">
          <input
            type="checkbox"
            checked={isCompleted}
            onChange={onToggleComplete}
            className="h-3.5 w-3.5 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
          />
          {isCompleted ? 'Completed' : 'Mark done'}
        </label>
      )}
    </li>
  );
}
