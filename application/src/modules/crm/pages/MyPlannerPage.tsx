import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ACTIVITY_PATHS,
  PLANNER_NOTE_PATHS,
  type ActivityFeedItem,
  type ActivityFeedResponse,
  type PlannerNoteResponse,
} from '@erp/shared';
import { ApiFailure, api } from '../../../api/client';
import { navigate } from '../../../app/location';
import { useSession } from '../../../session/SessionProvider';
import { leadWorkspacePath } from './LeadWorkspace';

/**
 * The rep's personal planning home: their own open tasks across every lead, and a free-notes
 * day/week plan private to them. "My tasks" is not a new endpoint — it reads the shared activities
 * feed filtered to the rep's own assigned tasks, the same aggregate the team calendar reads.
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

function MyTasks({ userId }: { userId: string | undefined }) {
  const tasks = useQuery({
    queryKey: ['crm', 'planner', 'my-tasks', userId],
    enabled: Boolean(userId),
    queryFn: () =>
      api.get<ActivityFeedResponse>(
        `${ACTIVITY_PATHS.activities}?filter.assignedToUserId=${userId}&filter.type=task`,
      ),
  });

  const open = (tasks.data?.items ?? []).filter((t) => t.completedAt === null);

  return (
    <section className="flex min-w-0 flex-col gap-3">
      <h2 className="text-lg font-semibold text-slate-900">My open tasks</h2>
      {tasks.isLoading && <p className="text-sm text-slate-500">Loading your tasks…</p>}
      {tasks.data && open.length === 0 && (
        <p className="text-sm text-slate-500">No open tasks assigned to you. Nice — you're clear.</p>
      )}
      <ul className="flex flex-col gap-2">
        {open.map((task) => (
          <TaskRow key={task.id} task={task} />
        ))}
      </ul>
    </section>
  );
}

function TaskRow({ task }: { task: ActivityFeedItem }) {
  const due = task.dueAt ? new Date(task.dueAt) : null;
  const overdue = due !== null && due.getTime() < Date.now();
  return (
    <li className="flex flex-col gap-1 rounded-lg border border-slate-200 bg-white p-3">
      <p className="whitespace-pre-wrap text-sm text-slate-800">{task.notes}</p>
      <div className="flex flex-wrap items-center gap-3 text-xs">
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
    </li>
  );
}

function MyNotes() {
  const queryClient = useQueryClient();
  const notes = useQuery({
    queryKey: ['crm', 'planner', 'my-notes'],
    queryFn: () => api.get<PlannerNoteResponse>(PLANNER_NOTE_PATHS.myNotes),
  });

  const [body, setBody] = useState('');
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (notes.data && !dirty) setBody(notes.data.body);
  }, [notes.data, dirty]);

  const save = useMutation({
    mutationFn: () => api.put<PlannerNoteResponse>(PLANNER_NOTE_PATHS.myNotes, { body }),
    onSuccess: (saved) => {
      setDirty(false);
      queryClient.setQueryData(['crm', 'planner', 'my-notes'], saved);
    },
  });

  const failure = save.error instanceof ApiFailure ? save.error : undefined;
  const lastSaved = notes.data?.updatedAt ? new Date(notes.data.updatedAt) : null;

  return (
    <section className="flex min-w-0 flex-col gap-3">
      <h2 className="text-lg font-semibold text-slate-900">My notes</h2>
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
          onClick={() => save.mutate()}
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
