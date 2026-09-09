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
import { currentSearchParams } from '../../../app/location';
import { useSession } from '../../../session/SessionProvider';
import { hasPermission } from '../../../session/permissions';
import { StrategyWhiteboard } from '../components/StrategyWhiteboard';
import { ScheduleActivityModal } from '../components/ScheduleActivityModal';
import { MyNotes, MyTasks } from './MyPlannerPage';
import { PlaybooksSection, ScriptsSection } from './PlaybooksPage';
import { TeamPlanPage } from './TeamPlanPage';

/**
 * The Sales Planning Hub & Enablement workspace — consolidating the team's entire planning slate:
 * 1. 📌 Strategy Whiteboard: tactile sticky-note cards for accounts (Angle, Objections, Next Step, 1-click Task).
 * 2. 📅 My Tasks & Agenda: personal open tasks with 1-click complete & quick-snooze + auto-saving scratchpad.
 * 3. 👥 Team Load & Calendar: forward scheduling calendar (5-day workweek & 7-day views, unbounded stepping),
 *    backward activity heatmap, and who-owns-what coordination view.
 * 4. 📋 Team Plan & Playbooks: shared company strategy document + scripts & playbooks library.
 */

export type MainTab = 'whiteboard' | 'my-tasks' | 'team-load' | 'team-plan';

type View = 'calendar' | 'heatmap' | 'coordination';

const MAIN_TAB_LABELS: Record<MainTab, string> = {
  whiteboard: '📌 Strategy Whiteboard',
  'my-tasks': '📅 My Tasks & Agenda',
  'team-load': '👥 Team Load & Calendar',
  'team-plan': '📋 Team Plan & Playbooks',
};

const VIEW_LABELS: Record<View, string> = {
  calendar: 'Calendar',
  heatmap: 'Activity heatmap',
  coordination: 'Who owns what',
};

/** Distinguishable hues for team members */
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

export function TeamPlanningPage({ initialTab }: { initialTab?: MainTab } = {}) {
  const { session, isRestoring } = useSession();
  const canRead = hasPermission(session, 'crm:team:read');
  const canManageTeam = hasPermission(session, 'crm:team:manage');
  const canReadUsers = hasPermission(session, 'identity:users:read');
  const currentUserId = session?.user.id;

  const [mainTab, setMainTab] = useState<MainTab>(() => {
    if (initialTab) return initialTab;
    if (typeof window !== 'undefined') {
      const search = currentSearchParams();
      const t = search.get('tab') as MainTab;
      if (t && ['whiteboard', 'my-tasks', 'team-load', 'team-plan'].includes(t)) {
        return t;
      }
    }
    return 'whiteboard';
  });

  const [subView, setSubView] = useState<View>('calendar');

  const usersQuery = useQuery({
    queryKey: ['identity', 'users', 'list'],
    queryFn: () => api.get<UserListResponse>(listPath(IDENTITY_PATHS.users, { pageSize: 100 })),
    enabled: canRead && canReadUsers,
  });
  const users = useMemo(() => usersQuery.data?.items ?? [], [usersQuery.data]);

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

  if (isRestoring) {
    return (
      <section className="mx-auto mt-12 max-w-md p-8 text-center text-sm text-slate-500">
        Loading…
      </section>
    );
  }

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
      <header className="flex flex-col gap-4 border-b border-slate-200 pb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Sales Planning Hub</h1>
          <p className="text-sm text-slate-500">
            Account strategy whiteboard, personal agendas, team workload balance, and playbooks in one unified workspace.
          </p>
        </div>

        {/* 4 Dedicated Hub Tabs */}
        <div role="tablist" aria-label="Sales Planning Hub Sections" className="flex flex-wrap items-center gap-2">
          {(['whiteboard', 'my-tasks', 'team-load', 'team-plan'] as MainTab[]).map((tab) => (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={mainTab === tab}
              onClick={() => setMainTab(tab)}
              className={`rounded-lg px-4 py-2 text-xs font-bold transition shadow-2xs ${
                mainTab === tab
                  ? 'bg-slate-900 text-white'
                  : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50 hover:text-slate-900'
              }`}
            >
              {MAIN_TAB_LABELS[tab]}
            </button>
          ))}
        </div>
      </header>

      {/* Tab 1: Strategy Whiteboard */}
      {mainTab === 'whiteboard' && (
        <StrategyWhiteboard
          users={users}
          currentUserId={currentUserId}
          nameForUser={nameFor}
        />
      )}

      {/* Tab 2: My Tasks & Agenda */}
      {mainTab === 'my-tasks' && (
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
          <MyTasks userId={currentUserId} />
          <MyNotes />
        </div>
      )}

      {/* Tab 3: Team Load & Calendar */}
      {mainTab === 'team-load' && (
        <div className="flex flex-col gap-6">
          <div className="flex items-center justify-between">
            <div role="tablist" aria-label="Planning view" className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white p-0.5 shadow-2xs">
              {(['calendar', 'heatmap', 'coordination'] as View[]).map((option) => (
                <button
                  key={option}
                  type="button"
                  role="tab"
                  aria-selected={subView === option}
                  onClick={() => setSubView(option)}
                  className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                    subView === option ? 'bg-slate-100 text-slate-900 font-bold' : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  {VIEW_LABELS[option]}
                </button>
              ))}
            </div>
          </div>

          {subView === 'calendar' && (
            <ScheduleCalendar
              repMeta={repMeta}
              nameFor={nameFor}
              colorFor={colorFor}
              canManageTeam={canManageTeam}
              currentUserId={currentUserId}
              users={users}
            />
          )}
          {subView === 'heatmap' && <ActivityHeatmap repMeta={repMeta} currentUserId={currentUserId} />}
          {subView === 'coordination' && (
            <CoordinationView users={users} repMeta={repMeta} colorFor={colorFor} currentUserId={currentUserId} />
          )}
        </div>
      )}

      {/* Tab 4: Team Plan & Playbooks */}
      {mainTab === 'team-plan' && (
        <div className="flex flex-col gap-10">
          <TeamPlanPage />
          <div className="border-t border-slate-200 pt-8">
            <ScriptsSection />
          </div>
          <div className="border-t border-slate-200 pt-8">
            <PlaybooksSection />
          </div>
        </div>
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
  const [calendarMode, setCalendarMode] = useState<'workweek' | 'full'>('workweek');
  const [calendarLayout, setCalendarLayout] = useState<'timegrid' | 'cards'>('timegrid');
  const [schedulingDate, setSchedulingDate] = useState<string | null>(null);
  const [schedulingTime, setSchedulingTime] = useState<string | undefined>(undefined);

  const schedule = useQuery({
    queryKey: ['crm', 'planning', 'schedule'],
    queryFn: () => api.get<PlanningScheduleResponse>(PLANNING_PATHS.schedule),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['crm', 'planning'] });
    void queryClient.invalidateQueries({ queryKey: ['crm', 'activities'] });
    void queryClient.invalidateQueries({ queryKey: ['crm', 'planner'] });
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

  // Calculate start date of week
  const weekStart = useMemo(() => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return new Date(start.getTime() + weekOffset * 7 * DAY_MS);
  }, [weekOffset]);

  const numDays = calendarMode === 'workweek' ? 5 : 7;

  const days = useMemo(
    () => Array.from({ length: numDays }, (_, index) => new Date(weekStart.getTime() + index * DAY_MS)),
    [weekStart, numDays],
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

  const dateRangeLabel = useMemo(() => {
    if (days.length === 0) return '';
    const first = days[0]!;
    const last = days[days.length - 1]!;
    const options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
    return `${first.toLocaleDateString(undefined, options)} – ${last.toLocaleDateString(undefined, options)}`;
  }, [days]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* Unbounded week navigation + Today shortcut */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1">
            <button
              type="button"
              aria-label="Previous week"
              onClick={() => setWeekOffset((offset) => offset - 1)}
              className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-600 shadow-2xs hover:bg-slate-50"
            >
              ← Earlier
            </button>
            <button
              type="button"
              onClick={() => setWeekOffset(0)}
              className={`rounded-md border border-slate-200 px-2.5 py-1 text-xs font-semibold shadow-2xs transition ${
                weekOffset === 0 ? 'bg-slate-100 text-slate-900 font-bold' : 'bg-white text-slate-600 hover:bg-slate-50'
              }`}
            >
              Today
            </button>
            <button
              type="button"
              aria-label="Next week"
              onClick={() => setWeekOffset((offset) => offset + 1)}
              className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-600 shadow-2xs hover:bg-slate-50"
            >
              Later →
            </button>
          </div>

          <span className="text-xs font-semibold text-slate-600">
            {weekOffset === 0
              ? 'This week'
              : weekOffset === 1
                ? 'Next week'
                : weekOffset === -1
                  ? 'Last week'
                  : `${weekOffset > 0 ? '+' : ''}${weekOffset} weeks`}
            {' · '}
            <span className="text-slate-500">{dateRangeLabel}</span>
          </span>
        </div>

        {/* 5-day / 7-day density toggle, Time View / Cards toggle, user filter & Schedule Task action */}
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => {
              setSchedulingDate(dayKeyLocal(new Date()));
              setSchedulingTime(undefined);
            }}
            className="flex items-center gap-1.5 rounded-lg bg-teal-600 px-3 py-1.5 text-xs font-semibold text-white shadow-2xs hover:bg-teal-700 transition active:scale-95"
          >
            <span className="font-bold">+</span> Schedule Task
          </button>

          {/* Time View vs Cards Toggle */}
          <div className="flex items-center rounded-lg border border-slate-200 bg-slate-100 p-0.5 text-xs font-semibold text-slate-600">
            <button
              type="button"
              onClick={() => setCalendarLayout('timegrid')}
              className={`rounded-md px-2.5 py-1 transition ${
                calendarLayout === 'timegrid'
                  ? 'bg-white text-slate-900 shadow-2xs font-bold'
                  : 'text-slate-500 hover:text-slate-900'
              }`}
            >
              🕒 Time View
            </button>
            <button
              type="button"
              onClick={() => setCalendarLayout('cards')}
              className={`rounded-md px-2.5 py-1 transition ${
                calendarLayout === 'cards'
                  ? 'bg-white text-slate-900 shadow-2xs font-bold'
                  : 'text-slate-500 hover:text-slate-900'
              }`}
            >
              📋 Cards
            </button>
          </div>

          <div className="flex items-center rounded-lg border border-slate-200 bg-slate-100 p-0.5 text-xs font-semibold text-slate-600">
            <button
              type="button"
              onClick={() => setCalendarMode('workweek')}
              className={`rounded-md px-2.5 py-1 transition ${
                calendarMode === 'workweek'
                  ? 'bg-white text-slate-900 shadow-2xs font-bold'
                  : 'text-slate-500 hover:text-slate-900'
              }`}
            >
              5-Day Workweek
            </button>
            <button
              type="button"
              onClick={() => setCalendarMode('full')}
              className={`rounded-md px-2.5 py-1 transition ${
                calendarMode === 'full'
                  ? 'bg-white text-slate-900 shadow-2xs font-bold'
                  : 'text-slate-500 hover:text-slate-900'
              }`}
            >
              7-Day Full
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

      {!schedule.isPending && !schedule.error && calendarLayout === 'timegrid' && (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-2xs">
          <div
            className="grid min-w-[760px]"
            style={{
              gridTemplateColumns: `5rem repeat(${days.length}, minmax(0, 1fr))`,
            }}
          >
            {/* Header row */}
            <div className="border-b border-r border-slate-200 bg-slate-50 p-2.5 text-center text-[10px] font-bold uppercase tracking-wider text-slate-400">
              Time
            </div>
            {days.map((day) => {
              const isToday = dayKeyLocal(day) === dayKeyLocal(new Date());
              return (
                <div
                  key={`time-header-${dayKeyLocal(day)}`}
                  className={`flex items-center justify-between border-b border-r border-slate-200 px-3 py-2 ${
                    isToday ? 'bg-teal-50/70' : 'bg-slate-50'
                  }`}
                >
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-slate-700">
                      {day.toLocaleDateString(undefined, { weekday: 'short' })}
                    </span>
                    {isToday && (
                      <span className="rounded bg-teal-100 px-1.5 py-0.5 text-[9px] font-bold text-teal-800">
                        Today
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className={`text-xs font-bold ${isToday ? 'text-teal-700' : 'text-slate-600'}`}>
                      {day.getDate()}
                    </span>
                    <button
                      type="button"
                      title={`Schedule on ${day.toLocaleDateString()}`}
                      aria-label={`Schedule on ${day.toLocaleDateString()}`}
                      onClick={() => {
                        setSchedulingDate(dayKeyLocal(day));
                        setSchedulingTime(undefined);
                      }}
                      className="flex h-5 w-5 items-center justify-center rounded text-slate-400 hover:bg-teal-100 hover:text-teal-700 transition"
                    >
                      +
                    </button>
                  </div>
                </div>
              );
            })}

            {/* Hourly Rows: 8:00 AM to 8:00 PM */}
            {[8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20].map((hour) => {
              const hourLabel =
                hour === 12
                  ? '12:00 PM'
                  : hour > 12
                    ? `${hour - 12}:00 PM`
                    : `${hour}:00 AM`;

              return (
                <div key={`hour-slot-${hour}`} className="contents">
                  {/* Left-hand sticky hour column */}
                  <div className="border-b border-r border-slate-100 bg-slate-50/40 p-2 text-right text-[11px] font-semibold text-slate-400">
                    {hourLabel}
                  </div>

                  {/* Day cell for this hour */}
                  {days.map((day) => {
                    const dayTasks = tasksByDay.get(dayKeyLocal(day)) ?? [];
                    const hourTasks = dayTasks.filter((t) => {
                      const d = new Date(t.dueAt);
                      return !isNaN(d.getTime()) && d.getHours() === hour;
                    });
                    const isToday = dayKeyLocal(day) === dayKeyLocal(new Date());

                    return (
                      <div
                        key={`cell-${dayKeyLocal(day)}-${hour}`}
                        className={`group relative flex min-h-[3.75rem] flex-col gap-1 border-b border-r border-slate-100 p-1.5 transition ${
                          isToday ? 'bg-teal-50/15 hover:bg-teal-50/30' : 'hover:bg-slate-50/50'
                        }`}
                      >
                        {hourTasks.map((task) => (
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
                        {hourTasks.length === 0 && (
                          <button
                            type="button"
                            onClick={() => {
                              setSchedulingDate(dayKeyLocal(day));
                              setSchedulingTime(`${String(hour).padStart(2, '0')}:00`);
                            }}
                            className="flex h-full min-h-7 w-full items-center justify-center rounded text-[10px] font-medium text-slate-300 opacity-0 transition group-hover:opacity-100 hover:border hover:border-dashed hover:border-teal-300 hover:bg-teal-50/40 hover:text-teal-700"
                          >
                            + {hourLabel}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {!schedule.isPending && !schedule.error && calendarLayout === 'cards' && (
        <div
          className={`grid grid-cols-1 gap-2.5 ${
            calendarMode === 'workweek' ? 'sm:grid-cols-5' : 'sm:grid-cols-7'
          }`}
        >
          {days.map((day) => {
            const list = (tasksByDay.get(dayKeyLocal(day)) ?? []).sort(
              (a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime(),
            );
            const isToday = dayKeyLocal(day) === dayKeyLocal(new Date());
            return (
              <div
                key={dayKeyLocal(day)}
                className={`flex min-h-36 flex-col gap-2 rounded-xl border p-2.5 transition ${
                  isToday ? 'border-teal-400 bg-teal-50/40 shadow-xs' : 'border-slate-200 bg-white shadow-2xs'
                }`}
              >
                <div className="flex items-baseline justify-between border-b border-slate-100 pb-1.5">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                      {day.toLocaleDateString(undefined, { weekday: 'short' })}
                    </span>
                    {isToday && (
                      <span className="rounded bg-teal-100 px-1.5 py-0.5 text-[9px] font-bold text-teal-800">
                        Today
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <span className={`text-xs font-bold ${isToday ? 'text-teal-700' : 'text-slate-500'}`}>
                      {day.getDate()}
                    </span>
                    <button
                      type="button"
                      title={`Schedule task on ${day.toLocaleDateString()}`}
                      aria-label={`Schedule task on ${day.toLocaleDateString()}`}
                      onClick={() => {
                        setSchedulingDate(dayKeyLocal(day));
                        setSchedulingTime(undefined);
                      }}
                      className="flex h-5 w-5 items-center justify-center rounded text-slate-400 hover:bg-teal-50 hover:text-teal-600 transition text-sm leading-none"
                    >
                      +
                    </button>
                  </div>
                </div>
                {list.length === 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setSchedulingDate(dayKeyLocal(day));
                      setSchedulingTime(undefined);
                    }}
                    className="flex flex-1 flex-col items-center justify-center rounded-lg border border-dashed border-slate-200 py-6 text-slate-400 hover:border-teal-300 hover:bg-teal-50/20 hover:text-teal-600 transition group"
                  >
                    <span className="text-base font-light leading-none group-hover:scale-125 transition-transform">+</span>
                    <span className="text-[10px] font-medium mt-1">Add task</span>
                  </button>
                )}
                <div className="flex flex-col gap-2">
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
                  {list.length > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        setSchedulingDate(dayKeyLocal(day));
                        setSchedulingTime(undefined);
                      }}
                      className="mt-0.5 flex items-center justify-center gap-1 rounded border border-dashed border-slate-200 py-1 text-[10px] font-medium text-slate-400 hover:border-teal-300 hover:bg-teal-50/20 hover:text-teal-600 transition"
                    >
                      <span>+</span> Add task
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {schedulingDate !== null && (
        <ScheduleActivityModal
          initialDate={schedulingDate}
          initialTime={schedulingTime}
          users={users}
          currentUserId={currentUserId}
          canManageTeam={canManageTeam}
          onClose={() => {
            setSchedulingDate(null);
            setSchedulingTime(undefined);
          }}
          onSuccess={() => {
            setSchedulingDate(null);
            setSchedulingTime(undefined);
          }}
        />
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

  const match = task.notes.match(/^([🤝📞📝⚡])\s*\[(Meeting|Call|Note)\]\s*(.*)$/);
  const badge = match ? `${match[1]} ${match[2]}` : null;
  const displayNotes = match ? match[3] : task.notes;

  const due = new Date(task.dueAt);
  const timeLabel = !isNaN(due.getTime())
    ? due.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    : null;

  return (
    <div
      className="flex flex-col gap-1.5 rounded-lg border border-slate-200 bg-white p-2.5 shadow-2xs"
      style={{ borderLeftColor: color, borderLeftWidth: 3 }}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        {badge && (
          <span className="inline-block rounded bg-slate-100 px-1.5 py-0.5 text-[9px] font-bold text-slate-700">
            {badge}
          </span>
        )}
        {timeLabel && (
          <span className="inline-flex items-center gap-1 rounded bg-teal-50 px-1.5 py-0.5 text-[9px] font-semibold text-teal-700">
            🕒 {timeLabel}
          </span>
        )}
      </div>
      {task.parentName && (
        <span
          title={task.parentName}
          className={`truncate text-[11px] font-bold leading-snug ${
            done ? 'text-slate-400 line-through' : 'text-slate-900'
          }`}
        >
          {task.parentName}
        </span>
      )}
      <p className={`text-[11px] font-medium leading-snug ${done ? 'text-slate-400 line-through' : 'text-slate-600'}`}>
        {displayNotes}
      </p>
      <div className="flex items-center justify-between gap-1">
        <span className="truncate text-[10px] font-semibold" style={{ color }}>
          {ownerName}
        </span>
        {overdue && <span className="text-[9px] font-bold uppercase text-rose-600">Overdue</span>}
      </div>
      <div className="flex items-center justify-between gap-1 border-t border-slate-50 pt-1">
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
            className="max-w-[6.5rem] rounded border border-slate-200 bg-white px-1 py-0.5 text-[10px] font-semibold text-slate-700 focus:border-teal-400 focus:outline-none disabled:opacity-50"
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
    <div className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-2xs">
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
                <span className="w-10 text-right text-[11px] font-bold text-slate-700">{total}</span>
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
    const raw = coordination.data?.items ?? [];
    const byId = new Map<string, PlanningCoordinationRow>();
    for (const r of raw) byId.set(r.userId, r);

    return [...users]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((user) => {
        const found = byId.get(user.id);
        return {
          user,
          leadCount: found?.leadCount ?? 0,
          openDealCount: found?.openDealCount ?? 0,
          openTaskCount: found?.openTaskCount ?? 0,
          overdueTaskCount: found?.overdueTaskCount ?? 0,
        };
      });
  }, [coordination.data, users]);

  if (coordination.isPending) return <p className="text-xs text-slate-500">Loading coordination data…</p>;
  if (coordination.error) {
    return <p className="text-xs text-rose-600">The coordination view could not be loaded.</p>;
  }

  return (
    <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-2xs">
      <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
        <thead className="bg-slate-50">
          <tr>
            <th className="px-4 py-3 font-semibold text-slate-700">Team member</th>
            <th className="px-4 py-3 font-semibold text-slate-700">Assigned leads</th>
            <th className="px-4 py-3 font-semibold text-slate-700">Open deals</th>
            <th className="px-4 py-3 font-semibold text-slate-700">Open tasks</th>
            <th className="px-4 py-3 font-semibold text-slate-700">Overdue tasks</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((row) => {
            const isMe = row.user.id === currentUserId;
            return (
              <tr key={row.user.id} className={isMe ? 'bg-teal-50/30' : undefined}>
                <td className="flex items-center gap-2 px-4 py-3 font-semibold text-slate-900">
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: colorFor(row.user.id) }}
                  />
                  <span>
                    {row.user.name} {isMe && <span className="font-normal text-slate-400">(you)</span>}
                  </span>
                </td>
                <td className="px-4 py-3 text-slate-700">{row.leadCount}</td>
                <td className="px-4 py-3 text-slate-700">{row.openDealCount}</td>
                <td className="px-4 py-3 text-slate-700">{row.openTaskCount}</td>
                <td className="px-4 py-3 font-bold text-rose-600">
                  {row.overdueTaskCount > 0 ? row.overdueTaskCount : <span className="text-slate-300 font-normal">0</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── date helpers ─────────────────────────────────────────────────────────────────────

function dayKeyLocal(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function daysBetween(fromIso: string, toIso: string): string[] {
  const list: string[] = [];
  const current = new Date(fromIso + 'T00:00:00Z');
  const end = new Date(toIso + 'T00:00:00Z');
  while (current.getTime() <= end.getTime()) {
    list.push(current.toISOString().slice(0, 10));
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return list;
}
