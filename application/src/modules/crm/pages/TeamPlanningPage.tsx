import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ACTIVITY_PATHS,
  IDENTITY_PATHS,
  PLANNING_PATHS,
  listPath,
  type AssignTaskRequest,
  type PlanningCoordinationResponse,
  type PlanningCoordinationRow,
  type PlanningHeatmapResponse,
  type PlanningScheduleResponse,
  type PlanningScheduleTask,
  type UserListResponse,
  type UserSummary,
} from '@erp/shared';
import { api } from '../../../api/client';
import { useSession } from '../../../session/SessionProvider';
import { hasPermission } from '../../../session/permissions';

/**
 * The Sales Enablement & Planning workspace — the team-and-time side of the enablement layer, in
 * one place: a forward scheduling calendar, a backward activity heatmap, and a who-owns-what
 * coordination view. All three read the ticket-01 task assignee and are gated by `crm:team:read`;
 * a rep sees their own slice by filtering to themselves, a manager sees the team.
 *
 * Every view is keyed by plain user ids the server never names — this page joins those ids to
 * names (and folds in teammates who own nothing) against identity's user list, the way every
 * assignment in CRM is displayed.
 */

type View = 'calendar' | 'heatmap' | 'coordination';

const VIEW_LABELS: Record<View, string> = {
  calendar: 'Calendar',
  heatmap: 'Activity heatmap',
  coordination: 'Who owns what',
};

/** A small set of distinguishable hues, assigned to reps by their position in the sorted set. */
const REP_COLORS = [
  '#0d9488',
  '#4f46e5',
  '#db2777',
  '#ea580c',
  '#0891b2',
  '#7c3aed',
  '#65a30d',
  '#dc2626',
  '#0369a1',
  '#c026d3',
];

export function TeamPlanningPage() {
  const { session } = useSession();
  const canRead = hasPermission(session, 'crm:team:read');
  const canManageTeam = hasPermission(session, 'crm:team:manage');
  const canReadUsers = hasPermission(session, 'identity:users:read');
  const currentUserId = session?.user.id;
  const [view, setView] = useState<View>('calendar');

  const usersQuery = useQuery({
    queryKey: ['identity', 'users', 'list'],
    queryFn: () => api.get<UserListResponse>(listPath(IDENTITY_PATHS.users, { pageSize: 100 })),
    enabled: canRead && canReadUsers,
  });
  const users = useMemo(() => usersQuery.data?.items ?? [], [usersQuery.data]);

  // A stable colour and label per rep. Sorted by name so the assignment does not shuffle between
  // renders, and so idle teammates (present in the user list, absent from every crm row) still get
  // a lane in every view.
  const repMeta = useMemo(() => {
    const sorted = [...users].sort((a, b) => a.name.localeCompare(b.name));
    const map = new Map<string, { name: string; color: string }>();
    sorted.forEach((user, index) => {
      map.set(user.id, { name: user.name, color: REP_COLORS[index % REP_COLORS.length]! });
    });
    return map;
  }, [users]);

  const nameFor = (userId: string | null): string =>
    userId ? repMeta.get(userId)?.name ?? 'A teammate' : 'Unassigned';
  const colorFor = (userId: string | null): string =>
    (userId && repMeta.get(userId)?.color) || '#94a3b8';

  if (!canRead) {
    return (
      <section className="mx-auto mt-12 max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-2xs">
        <h1 className="text-base font-bold text-slate-900">You cannot see team planning.</h1>
        <p className="mt-2 text-sm text-slate-500">
          Ask an administrator for the “Team: read” permission.
        </p>
      </section>
    );
  }

  return (
    <section aria-label="Team planning" className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Planning</h1>
          <p className="text-sm text-slate-500">
            The whole team’s schedule and workload — plan the week, read who’s active, balance the load.
          </p>
        </div>
        <div role="tablist" aria-label="Planning view" className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white p-0.5">
          {(['calendar', 'heatmap', 'coordination'] as View[]).map((option) => (
            <button
              key={option}
              type="button"
              role="tab"
              aria-selected={view === option}
              onClick={() => setView(option)}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                view === option ? 'bg-slate-100 text-slate-900' : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              {VIEW_LABELS[option]}
            </button>
          ))}
        </div>
      </header>

      {view === 'calendar' && (
        <ScheduleCalendar
          repMeta={repMeta}
          nameFor={nameFor}
          colorFor={colorFor}
          canManageTeam={canManageTeam}
          currentUserId={currentUserId}
          users={users}
        />
      )}
      {view === 'heatmap' && <ActivityHeatmap repMeta={repMeta} currentUserId={currentUserId} />}
      {view === 'coordination' && (
        <CoordinationView users={users} repMeta={repMeta} colorFor={colorFor} currentUserId={currentUserId} />
      )}
    </section>
  );
}

// ─── the scheduling calendar ──────────────────────────────────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000;

function ScheduleCalendar({
  repMeta,
  nameFor,
  colorFor,
  canManageTeam,
  currentUserId,
  users,
}: {
  repMeta: Map<string, { name: string; color: string }>;
  nameFor: (userId: string | null) => string;
  colorFor: (userId: string | null) => string;
  canManageTeam: boolean;
  currentUserId: string | undefined;
  users: UserSummary[];
}) {
  const queryClient = useQueryClient();
  const [weekOffset, setWeekOffset] = useState(0);
  const [onlyMine, setOnlyMine] = useState(false);

  const schedule = useQuery({
    queryKey: ['crm', 'planning', 'schedule'],
    queryFn: () => api.get<PlanningScheduleResponse>(PLANNING_PATHS.schedule),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['crm', 'planning'] });
    void queryClient.invalidateQueries({ queryKey: ['crm', 'activities'] });
  };

  const complete = useMutation({
    mutationFn: ({ id, completed }: { id: string; completed: boolean }) =>
      api.post(completed ? ACTIVITY_PATHS.reopenTask(id) : ACTIVITY_PATHS.completeTask(id)),
    onSuccess: invalidate,
  });
  const reassign = useMutation({
    mutationFn: ({ id, assignedToUserId }: { id: string; assignedToUserId: string | null }) =>
      api.post(ACTIVITY_PATHS.assignTask(id), { assignedToUserId } satisfies AssignTaskRequest),
    onSuccess: invalidate,
  });

  // The seven days of the shown week, from the start of today plus the offset.
  const weekStart = useMemo(() => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return new Date(start.getTime() + weekOffset * 7 * DAY_MS);
  }, [weekOffset]);

  const days = useMemo(
    () => Array.from({ length: 7 }, (_, index) => new Date(weekStart.getTime() + index * DAY_MS)),
    [weekStart],
  );

  const tasks = useMemo(() => {
    const items = schedule.data?.items ?? [];
    return onlyMine && currentUserId
      ? items.filter((task) => task.assignedToUserId === currentUserId)
      : items;
  }, [schedule.data, onlyMine, currentUserId]);

  const tasksByDay = useMemo(() => {
    const grouped = new Map<string, PlanningScheduleTask[]>();
    for (const task of tasks) {
      const key = dayKeyLocal(new Date(task.dueAt));
      const list = grouped.get(key) ?? [];
      list.push(task);
      grouped.set(key, list);
    }
    return grouped;
  }, [tasks]);

  const shownReps = useMemo(() => {
    const ids = new Set(tasks.map((task) => task.assignedToUserId).filter((id): id is string => Boolean(id)));
    return [...ids];
  }, [tasks]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setWeekOffset((offset) => Math.max(0, offset - 1))}
            disabled={weekOffset === 0}
            className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-40"
          >
            ← Earlier
          </button>
          <span className="text-xs font-semibold text-slate-500">
            {weekOffset === 0 ? 'This week' : 'Next week'}
          </span>
          <button
            type="button"
            onClick={() => setWeekOffset((offset) => Math.min(1, offset + 1))}
            disabled={weekOffset >= 1}
            className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-40"
          >
            Later →
          </button>
        </div>
        <label className="flex items-center gap-2 text-xs font-semibold text-slate-600">
          <input
            type="checkbox"
            checked={onlyMine}
            onChange={(event) => setOnlyMine(event.target.checked)}
            className="h-3.5 w-3.5 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
          />
          Only my tasks
        </label>
      </div>

      {shownReps.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {shownReps.map((repId) => (
            <span key={repId} className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-600">
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: colorFor(repId) }} />
              {nameFor(repId)}
            </span>
          ))}
        </div>
      )}

      {schedule.isPending && <p className="text-xs text-slate-500">Loading the schedule…</p>}
      {schedule.error && <p className="text-xs text-rose-600">The schedule could not be loaded.</p>}

      {!schedule.isPending && !schedule.error && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-7">
          {days.map((day) => {
            const list = (tasksByDay.get(dayKeyLocal(day)) ?? []).sort(
              (a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime(),
            );
            const isToday = dayKeyLocal(day) === dayKeyLocal(new Date());
            return (
              <div
                key={dayKeyLocal(day)}
                className={`flex min-h-24 flex-col gap-1.5 rounded-xl border p-2 ${
                  isToday ? 'border-teal-300 bg-teal-50/40' : 'border-slate-200 bg-white'
                }`}
              >
                <div className="flex items-baseline justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    {day.toLocaleDateString(undefined, { weekday: 'short' })}
                  </span>
                  <span className={`text-xs font-bold ${isToday ? 'text-teal-700' : 'text-slate-500'}`}>
                    {day.getDate()}
                  </span>
                </div>
                {list.length === 0 && <span className="text-[10px] text-slate-300">—</span>}
                {list.map((task) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    color={colorFor(task.assignedToUserId)}
                    ownerName={nameFor(task.assignedToUserId)}
                    canManageTeam={canManageTeam}
                    currentUserId={currentUserId}
                    users={users}
                    busy={complete.isPending || reassign.isPending}
                    onToggle={() => complete.mutate({ id: task.id, completed: Boolean(task.completedAt) })}
                    onReassign={(assignedToUserId) => reassign.mutate({ id: task.id, assignedToUserId })}
                  />
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function TaskCard({
  task,
  color,
  ownerName,
  canManageTeam,
  currentUserId,
  users,
  busy,
  onToggle,
  onReassign,
}: {
  task: PlanningScheduleTask;
  color: string;
  ownerName: string;
  canManageTeam: boolean;
  currentUserId: string | undefined;
  users: UserSummary[];
  busy: boolean;
  onToggle: () => void;
  onReassign: (assignedToUserId: string | null) => void;
}) {
  const done = Boolean(task.completedAt);
  const overdue = !done && new Date(task.dueAt).getTime() < Date.now();
  return (
    <div
      className="flex flex-col gap-1 rounded-lg border border-slate-200 bg-white p-2 shadow-2xs"
      style={{ borderLeftColor: color, borderLeftWidth: 3 }}
    >
      <p className={`text-[11px] font-semibold leading-snug ${done ? 'text-slate-400 line-through' : 'text-slate-800'}`}>
        {task.notes}
      </p>
      {task.parentName && (
        <span className="truncate text-[10px] text-slate-400">{task.parentName}</span>
      )}
      <div className="flex items-center justify-between gap-1">
        <span className="truncate text-[10px] font-semibold" style={{ color }}>
          {ownerName}
        </span>
        {overdue && <span className="text-[9px] font-bold uppercase text-rose-600">Overdue</span>}
      </div>
      <div className="flex items-center justify-between gap-1">
        <label className="flex items-center gap-1 text-[10px] font-semibold text-slate-600">
          <input
            type="checkbox"
            checked={done}
            disabled={busy}
            onChange={onToggle}
            className="h-3 w-3 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
          />
          {done ? 'Done' : 'Do'}
        </label>
        {canManageTeam && (
          <select
            aria-label="Reassign task"
            value={task.assignedToUserId ?? ''}
            disabled={busy}
            onChange={(event) => onReassign(event.target.value || null)}
            className="max-w-[6rem] rounded border border-slate-200 bg-white px-1 py-0.5 text-[10px] font-semibold text-slate-700 focus:border-teal-400 focus:outline-none disabled:opacity-50"
          >
            <option value="">Unassigned</option>
            {users.map((user) => (
              <option key={user.id} value={user.id}>
                {user.name}
              </option>
            ))}
          </select>
        )}
        {!canManageTeam && currentUserId && task.assignedToUserId !== currentUserId && (
          <button
            type="button"
            disabled={busy}
            onClick={() => onReassign(currentUserId)}
            className="rounded border border-slate-200 px-1.5 py-0.5 text-[10px] font-bold text-teal-700 hover:bg-teal-50 disabled:opacity-50"
          >
            Take
          </button>
        )}
      </div>
    </div>
  );
}

// ─── the activity heatmap ─────────────────────────────────────────────────────────────

/**
 * Contributions-style colour ramp: a single teal hue deepening with volume, so the scale reads by
 * lightness alone (colour-blind safe) rather than by hue. Fixed thresholds, not quartiles — a
 * handful of activity a day is a busy day whatever the busiest rep managed, and quartiles would
 * relabel that as quiet the moment one person had a huge week.
 */
function heatColor(count: number): string {
  if (count <= 0) return '#f1f5f9';
  if (count <= 2) return '#99f6e4';
  if (count <= 4) return '#2dd4bf';
  if (count <= 7) return '#0d9488';
  return '#115e59';
}

function ActivityHeatmap({
  repMeta,
  currentUserId,
}: {
  repMeta: Map<string, { name: string; color: string }>;
  currentUserId: string | undefined;
}) {
  const heatmap = useQuery({
    queryKey: ['crm', 'planning', 'heatmap'],
    queryFn: () => api.get<PlanningHeatmapResponse>(`${PLANNING_PATHS.heatmap}?weeks=12`),
  });

  const { dates, byRep, repIds } = useMemo(() => {
    const data = heatmap.data;
    if (!data) return { dates: [] as string[], byRep: new Map<string, Map<string, number>>(), repIds: [] as string[] };

    const dateList = daysBetween(data.from, data.to);
    const map = new Map<string, Map<string, number>>();
    for (const cell of data.cells) {
      const row = map.get(cell.userId) ?? new Map<string, number>();
      row.set(cell.date, cell.count);
      map.set(cell.userId, row);
    }
    // Reps who actually did something, current user first, then by name.
    const ids = [...map.keys()].sort((a, b) => {
      if (a === currentUserId) return -1;
      if (b === currentUserId) return 1;
      return (repMeta.get(a)?.name ?? a).localeCompare(repMeta.get(b)?.name ?? b);
    });
    return { dates: dateList, byRep: map, repIds: ids };
  }, [heatmap.data, repMeta, currentUserId]);

  if (heatmap.isPending) return <p className="text-xs text-slate-500">Loading the heatmap…</p>;
  if (heatmap.error) return <p className="text-xs text-rose-600">The heatmap could not be loaded.</p>;
  if (repIds.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed border-slate-200 bg-white py-8 text-center text-xs text-slate-500">
        No activity logged in the last twelve weeks yet.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400">
          Activity over the last 12 weeks
        </h2>
        <div className="flex items-center gap-1.5 text-[10px] font-semibold text-slate-400">
          Less
          {[0, 1, 3, 5, 8].map((count) => (
            <span
              key={count}
              className="h-3 w-3 rounded-sm"
              style={{ backgroundColor: heatColor(count) }}
            />
          ))}
          More
        </div>
      </div>

      <div className="overflow-x-auto">
        <div className="flex flex-col gap-1.5">
          {repIds.map((repId) => {
            const row = byRep.get(repId) ?? new Map<string, number>();
            const total = [...row.values()].reduce((sum, count) => sum + count, 0);
            return (
              <div key={repId} className="flex items-center gap-3">
                <span
                  className="w-32 shrink-0 truncate text-right text-[11px] font-semibold text-slate-600"
                  title={repMeta.get(repId)?.name}
                >
                  {repId === currentUserId ? 'You' : repMeta.get(repId)?.name ?? 'A teammate'}
                </span>
                <div className="flex gap-0.5">
                  {dates.map((date) => {
                    const count = row.get(date) ?? 0;
                    return (
                      <span
                        key={date}
                        title={`${date}: ${count} ${count === 1 ? 'activity' : 'activities'}`}
                        className="h-3 w-3 rounded-[2px]"
                        style={{ backgroundColor: heatColor(count) }}
                      />
                    );
                  })}
                </div>
                <span className="w-10 shrink-0 text-[11px] font-bold text-slate-500">{total}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── the coordination view ────────────────────────────────────────────────────────────

function CoordinationView({
  users,
  repMeta,
  colorFor,
  currentUserId,
}: {
  users: UserSummary[];
  repMeta: Map<string, { name: string; color: string }>;
  colorFor: (userId: string | null) => string;
  currentUserId: string | undefined;
}) {
  const coordination = useQuery({
    queryKey: ['crm', 'planning', 'coordination'],
    queryFn: () => api.get<PlanningCoordinationResponse>(PLANNING_PATHS.coordination),
  });

  const rows = useMemo(() => {
    const byUser = new Map<string, PlanningCoordinationRow>();
    for (const row of coordination.data?.items ?? []) byUser.set(row.userId, row);

    // Every teammate gets a row, even those who own nothing — that a rep is idle is exactly what a
    // coordination view is for. Users the list knows about, plus any assignee id not among them.
    const ids = new Set<string>([...users.map((user) => user.id), ...byUser.keys()]);
    const merged = [...ids].map((userId) => {
      const counts =
        byUser.get(userId) ?? { userId, leadCount: 0, openDealCount: 0, openTaskCount: 0, overdueTaskCount: 0 };
      return { ...counts, name: repMeta.get(userId)?.name ?? 'A teammate' };
    });
    // Busiest first, by open work; a tie broken by overdue then name.
    merged.sort((a, b) => {
      const load = b.openTaskCount + b.openDealCount - (a.openTaskCount + a.openDealCount);
      if (load !== 0) return load;
      if (b.overdueTaskCount !== a.overdueTaskCount) return b.overdueTaskCount - a.overdueTaskCount;
      return a.name.localeCompare(b.name);
    });
    return merged;
  }, [coordination.data, users, repMeta]);

  if (coordination.isPending) return <p className="text-xs text-slate-500">Loading workloads…</p>;
  if (coordination.error) return <p className="text-xs text-rose-600">The coordination view could not be loaded.</p>;

  return (
    <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
      <table className="w-full min-w-[32rem] text-sm">
        <thead>
          <tr className="border-b border-slate-100 text-left text-[10px] font-bold uppercase tracking-wider text-slate-400">
            <th className="px-4 py-2.5">Rep</th>
            <th className="px-4 py-2.5 text-right">Leads</th>
            <th className="px-4 py-2.5 text-right">Open deals</th>
            <th className="px-4 py-2.5 text-right">Open tasks</th>
            <th className="px-4 py-2.5 text-right">Overdue</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.userId} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60">
              <td className="px-4 py-2.5">
                <span className="flex items-center gap-2 font-semibold text-slate-800">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: colorFor(row.userId) }} />
                  {row.userId === currentUserId ? 'You' : row.name}
                </span>
              </td>
              <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">{row.leadCount}</td>
              <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">{row.openDealCount}</td>
              <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">{row.openTaskCount}</td>
              <td className="px-4 py-2.5 text-right tabular-nums">
                {row.overdueTaskCount > 0 ? (
                  <span className="rounded-md bg-rose-50 px-2 py-0.5 font-bold text-rose-700">
                    {row.overdueTaskCount}
                  </span>
                ) : (
                  <span className="text-slate-300">0</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── date helpers ─────────────────────────────────────────────────────────────────────

/** A local-time day key, so a task's due date lands in the column the reader sees it under. */
function dayKeyLocal(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** Every `YYYY-MM-DD` from `from` to `to` inclusive — the heatmap's column axis. */
function daysBetween(from: string, to: string): string[] {
  const days: string[] = [];
  const start = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  for (let time = start.getTime(); time <= end.getTime(); time += DAY_MS) {
    days.push(new Date(time).toISOString().slice(0, 10));
  }
  return days;
}
