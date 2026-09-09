import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ACTIVITY_PATHS,
  IDENTITY_PATHS,
  PLANNER_NOTE_PATHS,
  listPath,
  type ActivityFeedItem,
  type ActivityFeedResponse,
  type PlannerNoteResponse,
  type UserListResponse,
} from '@erp/shared';
import { ApiFailure, api } from '../../../api/client';
import { navigate } from '../../../app/location';
import { useSession } from '../../../session/SessionProvider';
import { ScheduleActivityModal } from '../components/ScheduleActivityModal';
import { leadWorkspacePath } from '../lead-routes';

/**
 * The rep's personal planning home: their own open tasks across every lead, and a free-notes
 * day/week plan private to them. "My tasks" reads the shared activities feed filtered to the rep's
 * own assigned tasks, the same aggregate the team calendar reads.
 */
export function MyPlannerPage() {
  const { session } = useSession();
  const userId = session?.user?.id;

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-slate-900">My planner</h1>
        <p className="text-sm text-slate-600">
          Your open tasks across every lead, and your own notes. Personal to you — nobody else sees
          your planner notes.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        <MyTasks userId={userId} />
        <MyNotes />
      </div>
    </div>
  );
}

export function MyTasks({ userId }: { userId: string | undefined }) {
  const [showModal, setShowModal] = useState(false);
  const tasks = useQuery({
    queryKey: ['crm', 'planner', 'my-tasks', userId],
    enabled: Boolean(userId),
    queryFn: () =>
      api.get<ActivityFeedResponse>(
        `${ACTIVITY_PATHS.activities}?filter.assignedToUserId=${userId}&filter.type=task`,
      ),
  });

  const usersQuery = useQuery({
    queryKey: ['identity', 'users', 'list'],
    queryFn: () => api.get<UserListResponse>(listPath(IDENTITY_PATHS.users, { pageSize: 100 })),
  });
  const users = usersQuery.data?.items ?? [];

  const open = (tasks.data?.items ?? []).filter((t) => t.completedAt === null);

  return (
    <section className="flex min-w-0 flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-900">My open tasks</h2>
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-slate-500">
            {open.length} {open.length === 1 ? 'task' : 'tasks'} pending
          </span>
          <button
            type="button"
            onClick={() => setShowModal(true)}
            className="flex items-center gap-1 rounded-lg bg-teal-600 px-2.5 py-1 text-xs font-semibold text-white shadow-2xs hover:bg-teal-700 transition"
          >
            <span>+</span> Add Task
          </button>
        </div>
      </div>
      {tasks.isLoading && <p className="text-sm text-slate-500">Loading your tasks…</p>}
      {tasks.data && open.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 p-8 text-center">
          <p className="text-sm font-medium text-slate-700">No open tasks assigned to you</p>
          <p className="mt-1 text-xs text-slate-400">Add tasks or reminders to plan your daily agenda.</p>
          <button
            type="button"
            onClick={() => setShowModal(true)}
            className="mt-3 rounded-lg bg-teal-600 px-3 py-1.5 text-xs font-semibold text-white shadow-2xs hover:bg-teal-700 transition"
          >
            + Create a task now
          </button>
        </div>
      )}
      <ul className="flex flex-col gap-2">
        {open.map((task) => (
          <TaskRow key={task.id} task={task} />
        ))}
      </ul>

      {showModal && (
        <ScheduleActivityModal
          users={users}
          currentUserId={userId}
          onClose={() => setShowModal(false)}
          onSuccess={() => setShowModal(false)}
        />
      )}
    </section>
  );
}

export function TaskRow({ task }: { task: ActivityFeedItem }) {
  const queryClient = useQueryClient();
  const due = task.dueAt ? new Date(task.dueAt) : null;
  const overdue = due !== null && due.getTime() < Date.now();

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['crm', 'planner'] });
    void queryClient.invalidateQueries({ queryKey: ['crm', 'planning'] });
    void queryClient.invalidateQueries({ queryKey: ['crm', 'activities'] });
  };

  const completeMutation = useMutation({
    mutationFn: () => api.post(ACTIVITY_PATHS.completeTask(task.id)),
    onSuccess: invalidate,
  });

  const snoozeMutation = useMutation({
    mutationFn: (days: number) => api.post(ACTIVITY_PATHS.snoozeTask(task.id), { days }),
    onSuccess: invalidate,
  });

  return (
    <li className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-white p-3 shadow-2xs transition hover:border-slate-300">
      <div className="flex items-start gap-3">
        <button
          type="button"
          aria-label={`Mark task as completed: ${task.notes}`}
          onClick={() => completeMutation.mutate()}
          disabled={completeMutation.isPending}
          className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border border-slate-300 bg-white hover:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500 disabled:opacity-50"
        >
          {completeMutation.isPending && (
            <span className="h-2 w-2 animate-spin rounded-full border-1 border-teal-600 border-t-transparent" />
          )}
        </button>

        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <p className="whitespace-pre-wrap text-sm text-slate-800">{task.notes}</p>
          <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-xs">
            <div className="flex flex-wrap items-center gap-3">
              {task.parentKind === 'lead' && task.leadId ? (
                <button
                  type="button"
                  onClick={() => navigate(leadWorkspacePath(task.leadId!))}
                  className="font-medium text-teal-700 hover:text-teal-900"
                >
                  {task.parentName ?? 'Lead'}
                </button>
              ) : (
                task.parentName && <span className="text-slate-500">{task.parentName}</span>
              )}
              {due && (
                <span className={overdue ? 'font-semibold text-rose-600' : 'text-slate-500'}>
                  Due {due.toLocaleDateString()}
                  {overdue ? ' · overdue' : ''}
                </span>
              )}
            </div>

            <div className="flex items-center gap-1.5" aria-label="Snooze task options">
              <span className="text-[11px] text-slate-400">Snooze:</span>
              <button
                type="button"
                onClick={() => snoozeMutation.mutate(1)}
                disabled={snoozeMutation.isPending}
                className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600 hover:bg-slate-100 active:bg-slate-200 disabled:opacity-50"
                title="Postpone by 1 day"
              >
                +1d
              </button>
              <button
                type="button"
                onClick={() => snoozeMutation.mutate(3)}
                disabled={snoozeMutation.isPending}
                className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600 hover:bg-slate-100 active:bg-slate-200 disabled:opacity-50"
                title="Postpone by 3 days"
              >
                +3d
              </button>
              <button
                type="button"
                onClick={() => snoozeMutation.mutate(7)}
                disabled={snoozeMutation.isPending}
                className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600 hover:bg-slate-100 active:bg-slate-200 disabled:opacity-50"
                title="Postpone by 1 week"
              >
                +1w
              </button>
            </div>
          </div>
        </div>
      </div>
    </li>
  );
}

export function MyNotes() {
  const queryClient = useQueryClient();
  const notes = useQuery({
    queryKey: ['crm', 'planner', 'my-notes'],
    queryFn: () => api.get<PlannerNoteResponse>(PLANNER_NOTE_PATHS.myNotes),
  });

  const [body, setBody] = useState('');
  const [dirty, setDirty] = useState(false);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (notes.data && !dirty) setBody(notes.data.body);
  }, [notes.data, dirty]);

  const save = useMutation({
    mutationFn: (newBody: string) =>
      api.put<PlannerNoteResponse>(PLANNER_NOTE_PATHS.myNotes, { body: newBody }),
    onSuccess: (saved) => {
      setDirty(false);
      queryClient.setQueryData(['crm', 'planner', 'my-notes'], saved);
    },
  });

  // Debounced auto-save: 1000ms after user stops typing
  useEffect(() => {
    if (!dirty) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      save.mutate(body);
    }, 1000);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [body, dirty]);

  const failure = save.error instanceof ApiFailure ? save.error : undefined;
  const lastSaved = notes.data?.updatedAt ? new Date(notes.data.updatedAt) : null;

  return (
    <section className="flex min-w-0 flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-900">My notes</h2>
        <div className="text-xs">
          {save.isPending ? (
            <span className="text-teal-600">Auto-saving…</span>
          ) : dirty ? (
            <span className="text-amber-600">Unsaved edits…</span>
          ) : lastSaved ? (
            <span className="text-slate-400">Saved {lastSaved.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
          ) : null}
        </div>
      </div>
      <textarea
        aria-label="My planner notes"
        rows={12}
        value={body}
        onChange={(e) => {
          setBody(e.target.value);
          setDirty(true);
        }}
        placeholder="Your day/week plan, reminders, anything…"
        className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
      />
      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={!dirty || save.isPending}
          onClick={() => save.mutate(body)}
          className="rounded-md bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {save.isPending ? 'Saving…' : 'Save notes'}
        </button>
        {dirty && <span className="text-xs text-amber-600">Unsaved changes</span>}
        {!dirty && lastSaved && (
          <span className="text-xs text-slate-400">Last saved {lastSaved.toLocaleString()}</span>
        )}
      </div>
      {failure && (
        <p role="alert" className="text-xs font-semibold text-rose-600">
          {failure.message}
        </p>
      )}
    </section>
  );
}
