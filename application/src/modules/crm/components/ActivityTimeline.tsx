import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ACTIVITY_PATHS,
  ACTIVITY_TYPES,
  type ActivityListResponse,
  type ActivityResponse,
  type ActivityType,
  type CreateActivityRequest,
} from '@erp/shared';
import { Field, FormError, Select } from '@erp/shared/ui';
import { ApiFailure, api } from '../../../api/client';
import { useSession } from '../../../session/SessionProvider';
import { hasPermission } from '../../../session/permissions';

export type ParentKind = 'lead' | 'deal' | 'party';

const TYPE_LABELS: Record<ActivityType, string> = {
  call: 'Phone Call',
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

export function ActivityTimeline({
  parentKind,
  parentId,
}: {
  parentKind: ParentKind;
  parentId: string;
}) {
  const { session } = useSession();
  const canWrite = hasPermission(session, 'crm:activities:write');
  const canRead = hasPermission(session, 'crm:activities:read');
  const queryClient = useQueryClient();

  const [filterType, setFilterType] = useState<string>('all');
  const [showLogForm, setShowLogForm] = useState(false);

  const queryKey = ['crm', 'activities', parentKind, parentId];

  const getPath = () => {
    if (parentKind === 'lead') return ACTIVITY_PATHS.leadActivities(parentId);
    if (parentKind === 'deal') return ACTIVITY_PATHS.dealActivities(parentId);
    return ACTIVITY_PATHS.partyActivities(parentId);
  };

  const { data, isPending, error } = useQuery({
    queryKey,
    queryFn: () => api.get<ActivityListResponse>(getPath()),
    enabled: canRead && Boolean(parentId),
  });

  const completeMutation = useMutation({
    mutationFn: ({ id, completed }: { id: string; completed: boolean }) =>
      api.post<ActivityResponse>(
        completed ? ACTIVITY_PATHS.reopenTask(id) : ACTIVITY_PATHS.completeTask(id),
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
    },
  });

  const logMutation = useMutation({
    mutationFn: (body: CreateActivityRequest) =>
      api.post<ActivityResponse>(ACTIVITY_PATHS.activities, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      setShowLogForm(false);
    },
  });

  const failure = logMutation.error instanceof ApiFailure ? logMutation.error : undefined;
  const fields = failure?.fields ?? {};

  const activities = data?.items ?? [];
  const filteredActivities =
    filterType === 'all' ? activities : activities.filter((a) => a.type === filterType);

  if (!canRead) return null;

  return (
    <section
      aria-labelledby="activity-timeline-heading"
      className="flex flex-col gap-4 border-t border-slate-200 pt-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h3 id="activity-timeline-heading" className="text-base font-semibold text-slate-900">
            Activity Timeline
          </h3>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
            {activities.length}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <Select
            id="activity-filter-type"
            label="Filter"
            value={filterType}
            options={[
              { value: 'all', label: 'All Activities' },
              ...ACTIVITY_TYPES.map((type) => ({ value: type, label: TYPE_LABELS[type] })),
            ]}
            onChange={setFilterType}
          />

          {canWrite && !showLogForm && (
            <button
              type="button"
              onClick={() => setShowLogForm(true)}
              className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700"
            >
              + Log Activity
            </button>
          )}
        </div>
      </div>

      {showLogForm && (
        <LogActivityForm
          parentKind={parentKind}
          parentId={parentId}
          fields={fields}
          failureMessage={failure?.message}
          pending={logMutation.isPending}
          onSubmit={(req) => logMutation.mutate(req)}
          onCancel={() => setShowLogForm(false)}
        />
      )}

      {isPending && (
        <p role="status" className="text-sm text-slate-500">
          Loading activities…
        </p>
      )}

      {error && (
        <p role="alert" className="text-sm text-red-600">
          Failed to load activities.
        </p>
      )}

      {!isPending && !error && filteredActivities.length === 0 && (
        <p className="py-4 text-center text-sm text-slate-500">
          {filterType === 'all'
            ? 'No activities logged yet.'
            : `No ${TYPE_LABELS[filterType as ActivityType]} activities found.`}
        </p>
      )}

      <ul className="flex flex-col gap-3">
        {filteredActivities.map((act) => (
          <ActivityCard
            key={act.id}
            activity={act}
            canWrite={canWrite}
            onToggleComplete={() =>
              completeMutation.mutate({ id: act.id, completed: Boolean(act.completedAt) })
            }
          />
        ))}
      </ul>
    </section>
  );
}

function LogActivityForm({
  parentKind,
  parentId,
  fields,
  failureMessage,
  pending,
  onSubmit,
  onCancel,
}: {
  parentKind: ParentKind;
  parentId: string;
  fields: Record<string, string>;
  failureMessage?: string;
  pending: boolean;
  onSubmit: (req: CreateActivityRequest) => void;
  onCancel: () => void;
}) {
  const [type, setType] = useState<ActivityType>('call');
  const [notes, setNotes] = useState('');
  const [occurredAt, setOccurredAt] = useState('');
  const [dueAt, setDueAt] = useState('');

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const req: CreateActivityRequest = {
      type,
      notes,
      ...(occurredAt ? { occurredAt: new Date(occurredAt).toISOString() } : {}),
      ...(type === 'task' && dueAt ? { dueAt: new Date(dueAt).toISOString() } : {}),
      ...(parentKind === 'lead' ? { leadId: parentId } : {}),
      ...(parentKind === 'deal' ? { dealId: parentId } : {}),
      ...(parentKind === 'party' ? { partyId: parentId } : {}),
    };
    onSubmit(req);
  };

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      className="flex flex-col gap-3 rounded-md border border-slate-200 bg-slate-50 p-4"
    >
      <h4 className="text-sm font-semibold text-slate-900">Log New Activity</h4>

      {failureMessage && <FormError>{failureMessage}</FormError>}

      <div className="flex flex-wrap gap-3">
        <div className="min-w-44 flex-1">
          <Select
            id="activity-type-input"
            label="Activity Type"
            value={type}
            error={fields.type}
            options={ACTIVITY_TYPES.map((t) => ({ value: t, label: TYPE_LABELS[t] }))}
            onChange={(val) => setType(val as ActivityType)}
          />
        </div>

        <div className="min-w-44 flex-1">
          <Field
            id="activity-occurred-at-input"
            label="Occurred At (Optional)"
            type="date"
            value={occurredAt}
            error={fields.occurredAt}
            onChange={setOccurredAt}
          />
        </div>

        {type === 'task' && (
          <div className="min-w-44 flex-1">
            <Field
              id="activity-due-at-input"
              label="Due Date (Optional)"
              type="date"
              value={dueAt}
              error={fields.dueAt}
              onChange={setDueAt}
            />
          </div>
        )}
      </div>

      <div>
        <label htmlFor="activity-notes-input" className="block text-xs font-medium text-slate-700">
          Notes / Details
        </label>
        <textarea
          id="activity-notes-input"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          className="mt-1 block w-full rounded-md border border-slate-300 p-2 text-sm text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none"
          placeholder="Record notes, conversation summary, or task description…"
        />
        {fields.notes && <p className="mt-1 text-xs text-red-600">{fields.notes}</p>}
      </div>

      <div className="flex gap-2 justify-end">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-white"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={pending || !notes.trim()}
          className="rounded-md bg-slate-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
        >
          Save Activity
        </button>
      </div>
    </form>
  );
}

function ActivityCard({
  activity,
  canWrite,
  onToggleComplete,
}: {
  activity: ActivityResponse;
  canWrite: boolean;
  onToggleComplete: () => void;
}) {
  const isTask = activity.type === 'task';
  const isCompleted = Boolean(activity.completedAt);
  const isSystemAudit = /^(⚙️|📎|👤|🚀|📥|📝)/.test(activity.notes);

  const formattedOccurred = new Date(activity.occurredAt).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  const formattedDue = activity.dueAt
    ? new Date(activity.dueAt).toLocaleString(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
      })
    : null;

  return (
    <li
      className={`flex flex-col gap-2 rounded-xl border p-4 shadow-2xs transition ${
        isSystemAudit
          ? 'border-slate-200 bg-slate-50/70'
          : 'border-slate-200 bg-white hover:border-slate-300'
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span
            className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${
              isSystemAudit
                ? 'bg-slate-200 text-slate-800 border-slate-300'
                : TYPE_BADGE_CLASSES[activity.type] || 'bg-slate-100 text-slate-800 border-slate-200'
            }`}
          >
            {isSystemAudit ? 'System Log' : TYPE_LABELS[activity.type] || 'Activity'}
          </span>

          {isTask && (
            <span
              className={`text-xs font-semibold ${
                isCompleted ? 'text-emerald-700' : 'text-amber-700'
              }`}
            >
              {isCompleted ? '✓ Completed' : '⏳ Pending Task'}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 text-xs text-slate-500 font-medium">
          <span>{formattedOccurred}</span>
          <span>·</span>
          <span className="font-semibold text-slate-700">By {activity.createdByName}</span>
        </div>
      </div>

      <p className="text-xs text-slate-800 whitespace-pre-wrap leading-relaxed pt-1">
        {activity.notes}
      </p>

      {isTask && (
        <div className="flex flex-wrap items-center justify-between border-t border-slate-100 pt-2 text-xs">
          {formattedDue && (
            <span className="text-slate-600">
              <strong className="font-semibold text-slate-700">Due:</strong> {formattedDue}
            </span>
          )}

          {canWrite && (
            <label className="flex items-center gap-2 font-medium text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={isCompleted}
                onChange={onToggleComplete}
                className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-500"
              />
              Mark {isCompleted ? 'Complete' : 'Task Done'}
            </label>
          )}
        </div>
      )}
    </li>
  );
}
