import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ACTIVITY_PATHS,
  describeAudit,
  describeSentEmail,
  isSystemAudit,
  type ActivityListResponse,
  type ActivityResponse,
  type ActivityType,
  type AuditEvent,
  type CreateActivityRequest,
} from '@erp/shared';
import { ApiFailure, api } from '../../../api/client';
import { useSession } from '../../../session/SessionProvider';
import { hasPermission } from '../../../session/permissions';
import {
  CalendarIcon,
  ChecklistIcon,
  ClockIcon,
  EyeIcon,
  ImageIcon,
  MailIcon,
  NoteIcon,
  PaperclipIcon,
  PhoneIcon,
  SendIcon,
} from '../icons';

/**
 * The Timeline as one filterable feed, labelled **Activity** because that is what users call it.
 *
 * It reads the one endpoint that already interleaves the two kinds of entry the glossary keeps
 * apart — person-authored **Activities** (a note, call, meeting, task) and system-recorded
 * **Audit events** (status changed, file attached, survey received), the latter tagged with a
 * leading emoji by the backend. No separate audit-log endpoint exists, and none is wanted: the
 * whole point of the workspace is that everything that happened to a lead is in one place.
 *
 * Entries are taken apart rather than printed. `describeAudit` and `describeSentEmail` turn the
 * wire format back into fields, so an email open can be rendered as what it is — a soft signal
 * with a count and a caveat — instead of as a line of text with an emoji at the front. Anything
 * the parsers do not recognise falls back to the text exactly as written, so a format this
 * version has not met still reads.
 */

const TYPE_LABELS: Record<ActivityType, string> = {
  call: 'Call',
  email: 'Email',
  meeting: 'Meeting',
  note: 'Note',
  task: 'Task',
};

/** The kinds a person may log straight from the feed. Email goes out through Send email, not here. */
const COMPOSER_TYPES: { type: ActivityType; icon: React.ReactNode }[] = [
  { type: 'note', icon: <NoteIcon size={14} /> },
  { type: 'call', icon: <PhoneIcon size={14} /> },
  { type: 'email', icon: <MailIcon size={14} /> },
  { type: 'meeting', icon: <CalendarIcon size={14} /> },
  { type: 'task', icon: <ChecklistIcon size={14} /> },
];

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
  leadName,
  composerType,
  onComposerTypeChange,
  composerFocusSignal = 0,
}: {
  leadId: string;
  /** So an email open can say who probably opened it, rather than "the lead". */
  leadName: string;
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
          className="flex flex-col rounded-2xl border border-slate-200 bg-white shadow-2xs"
        >
          <div className="flex flex-wrap items-center gap-1 border-b border-slate-100 p-2">
            {COMPOSER_TYPES.map(({ type, icon }) => {
              const active = composerType === type;
              return (
                <button
                  key={type}
                  type="button"
                  aria-pressed={active}
                  onClick={() => onComposerTypeChange(type)}
                  className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-bold transition ${
                    active
                      ? 'bg-teal-50 text-teal-700 ring-1 ring-teal-200'
                      : 'text-slate-500 hover:bg-slate-50 hover:text-slate-800'
                  }`}
                >
                  <span className={active ? 'text-teal-600' : 'text-slate-400'}>{icon}</span>
                  {TYPE_LABELS[type]}
                </button>
              );
            })}
          </div>

          <textarea
            ref={notesRef}
            aria-label="Activity notes"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            rows={3}
            placeholder="Log a note, or record what happened on the call…"
            className="w-full resize-none border-0 bg-transparent p-4 text-xs leading-relaxed text-slate-900 placeholder:text-slate-400 focus:outline-none"
          />

          {failure && (
            <p role="alert" className="px-4 pb-2 text-xs font-semibold text-rose-600">
              {failure.fields.notes ?? failure.message}
            </p>
          )}

          <div className="flex items-center justify-between gap-2 border-t border-slate-100 p-2.5">
            {/* Attaching from the composer belongs to the Files tab, which owns the upload; these
                say where it lives rather than opening a second way to do it. */}
            <div className="flex items-center gap-1 pl-1 text-slate-300">
              <span title="Attach files from the Files tab">
                <PaperclipIcon size={15} />
              </span>
              <span title="Images are attached from the Files tab">
                <ImageIcon size={15} />
              </span>
            </div>

            <button
              type="submit"
              disabled={!notes.trim() || log.isPending}
              className="flex items-center gap-1.5 rounded-lg bg-teal-700 px-4 py-2 text-xs font-bold text-white transition hover:bg-teal-800 disabled:opacity-50"
            >
              <SendIcon size={14} />
              {log.isPending ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      )}

      <div className="flex items-center justify-between gap-2">
        <h3
          id="lead-activity-heading"
          className="text-[10px] font-bold uppercase tracking-wider text-slate-400"
        >
          Activity
        </h3>
        <div
          role="tablist"
          aria-label="Filter activity"
          className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white p-0.5"
        >
          {FEED_FILTERS.map((option) => (
            <button
              key={option}
              type="button"
              role="tab"
              aria-selected={filter === option}
              onClick={() => setFilter(option)}
              className={`rounded-md px-3 py-1 text-xs font-semibold transition ${
                filter === option ? 'bg-slate-100 text-slate-900' : 'text-slate-500 hover:text-slate-800'
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
        <p className="rounded-2xl border border-dashed border-slate-200 bg-white py-8 text-center text-xs text-slate-500">
          {filter === 'all'
            ? 'Nothing has happened with this lead yet.'
            : `No ${FILTER_LABELS[filter].toLowerCase()} entries.`}
        </p>
      )}

      {/* The spine: one rail down the left with an icon per entry, so the eye can run the
          history by kind without reading every card. */}
      <ul className="flex flex-col">
        {shown.map((activity, index) => (
          <FeedEntry
            key={activity.id}
            activity={activity}
            leadName={leadName}
            canWrite={canWrite}
            isLast={index === shown.length - 1}
            onToggleComplete={() => complete.mutate({ id: activity.id, completed: Boolean(activity.completedAt) })}
          />
        ))}
      </ul>
    </section>
  );
}

/** What the spine shows for an entry, and the tone the card carries. */
function presentation(
  activity: ActivityResponse,
  audit: AuditEvent | undefined,
): { icon: React.ReactNode; ring: string; tag: string } {
  if (audit) {
    switch (audit.kind) {
      case 'email-opened':
        return { icon: <EyeIcon size={14} />, ring: 'bg-teal-50 text-teal-700', tag: 'Email opened' };
      case 'file-attached':
        return { icon: <PaperclipIcon size={14} />, ring: 'bg-slate-100 text-slate-600', tag: 'File' };
      case 'survey-received':
        return { icon: <ChecklistIcon size={14} />, ring: 'bg-violet-50 text-violet-700', tag: 'Survey' };
      default:
        return { icon: <ClockIcon size={14} />, ring: 'bg-slate-100 text-slate-500', tag: 'Audit' };
    }
  }

  switch (activity.type) {
    case 'email':
      return { icon: <MailIcon size={14} />, ring: 'bg-blue-50 text-blue-700', tag: 'Email' };
    case 'call':
      return { icon: <PhoneIcon size={14} />, ring: 'bg-indigo-50 text-indigo-700', tag: 'Call' };
    case 'meeting':
      return { icon: <CalendarIcon size={14} />, ring: 'bg-purple-50 text-purple-700', tag: 'Meeting' };
    case 'task':
      return { icon: <ChecklistIcon size={14} />, ring: 'bg-emerald-50 text-emerald-700', tag: 'Task' };
    default:
      return { icon: <NoteIcon size={14} />, ring: 'bg-amber-50 text-amber-700', tag: 'Note' };
  }
}

function FeedEntry({
  activity,
  leadName,
  canWrite,
  isLast,
  onToggleComplete,
}: {
  activity: ActivityResponse;
  leadName: string;
  canWrite: boolean;
  isLast: boolean;
  onToggleComplete: () => void;
}) {
  const audit = describeAudit(activity.notes);
  const sentEmail = !audit && activity.type === 'email' ? describeSentEmail(activity.notes) : undefined;
  const { icon, ring, tag } = presentation(activity, audit);

  const isTask = activity.type === 'task' && !audit;
  const isCompleted = Boolean(activity.completedAt);
  const when = new Date(activity.occurredAt).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  return (
    <li className="flex gap-3">
      <div className="flex shrink-0 flex-col items-center">
        <span className={`flex h-8 w-8 items-center justify-center rounded-full ${ring}`}>{icon}</span>
        {!isLast && <span aria-hidden="true" className="w-px flex-1 bg-slate-200" />}
      </div>

      <div className={`min-w-0 flex-1 ${isLast ? '' : 'pb-3'}`}>
        <div className="flex flex-col gap-1.5 rounded-2xl border border-slate-200 bg-white p-3.5 shadow-2xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{tag}</span>
              <EntryHeadline activity={activity} audit={audit} sentEmail={sentEmail} leadName={leadName} />
            </div>
            <span className="shrink-0 text-[11px] font-medium text-slate-400">{when}</span>
          </div>

          <EntryBody activity={activity} audit={audit} sentEmail={sentEmail} />

          {!audit && (
            <p className="text-[11px] text-slate-400">
              by <span className="font-semibold text-slate-500">{activity.createdByName}</span>
            </p>
          )}

          {isTask && canWrite && (
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
        </div>
      </div>
    </li>
  );
}

function EntryHeadline({
  activity,
  audit,
  sentEmail,
  leadName,
}: {
  activity: ActivityResponse;
  audit: AuditEvent | undefined;
  sentEmail: { subject: string; preview: string } | undefined;
  leadName: string;
}) {
  if (audit?.kind === 'email-opened') {
    return (
      <span className="text-xs font-bold text-slate-900">
        {leadName} likely opened “{audit.subject}”
      </span>
    );
  }
  if (audit?.kind === 'status-changed') {
    return (
      <span className="text-xs font-bold text-slate-900">
        Status changed from {audit.from} to {audit.to}
      </span>
    );
  }
  if (audit?.kind === 'file-attached') {
    return <span className="text-xs font-bold text-slate-900">Attached {audit.filename}</span>;
  }
  if (audit?.kind === 'survey-received') {
    return <span className="text-xs font-bold text-slate-900">Answered {audit.formName}</span>;
  }
  if (audit?.kind === 'lead-assigned') {
    return <span className="text-xs font-bold text-slate-900">Lead assigned</span>;
  }
  if (sentEmail) {
    return <span className="text-xs font-bold text-slate-900">Sent “{sentEmail.subject}”</span>;
  }
  if (activity.type === 'task') {
    return (
      <span className={`text-[11px] font-semibold ${activity.completedAt ? 'text-emerald-700' : 'text-amber-700'}`}>
        {activity.completedAt ? 'Done' : 'Pending'}
      </span>
    );
  }
  return null;
}

function EntryBody({
  activity,
  audit,
  sentEmail,
}: {
  activity: ActivityResponse;
  audit: AuditEvent | undefined;
  sentEmail: { subject: string; preview: string } | undefined;
}) {
  if (audit?.kind === 'email-opened') {
    return (
      <p className="text-xs leading-relaxed text-slate-600">
        {audit.openCount > 1 ? (
          <>
            Opened <strong className="font-bold text-slate-800">{audit.openCount}×</strong> since sending.{' '}
          </>
        ) : (
          'Opened once since sending. '
        )}
        {/* Never "read" or "confirmed": image-blocking hides a real read, and Apple Mail
            Privacy Protection's pre-fetch invents one that never happened. */}
        <strong className="font-bold text-slate-800">Probably seen</strong> — open tracking is a soft
        signal, not proof. You were notified.
      </p>
    );
  }

  if (sentEmail) {
    return (
      <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
        <p className="text-xs font-bold text-slate-800">{sentEmail.subject}</p>
        {sentEmail.preview && (
          <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-xs leading-relaxed text-slate-600">
            {sentEmail.preview}
          </p>
        )}
      </div>
    );
  }

  if (audit && audit.kind !== 'other') return null;

  return (
    <p className="whitespace-pre-wrap text-xs leading-relaxed text-slate-700">
      {audit?.kind === 'other' ? audit.text : activity.notes}
    </p>
  );
}
