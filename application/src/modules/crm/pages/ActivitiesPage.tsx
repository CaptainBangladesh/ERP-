import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ACTIVITY_PATHS,
  DASHBOARD_PATHS,
  listPath,
  type ActivityCountsResponse,
  type ActivityFeedItem,
  type ActivityFeedResponse,
} from '@erp/shared';
import { api } from '../../../api/client';
import { useSession } from '../../../session/SessionProvider';
import { hasPermission } from '../../../session/permissions';
import { ActivityFeedList } from '../components/ActivityFeedList';
import { ActivityIcon } from '../icons';

/**
 * The Activities screen: the whole team's work in one timeline, split into mine and theirs.
 *
 * It is the roll-up the per-lead feed could never be — every call, note, meeting, task, email
 * and system event across every record, newest first — and it exists because "what has the team
 * been doing" is a question you cannot answer by opening leads one at a time. The lens across the
 * top is the *only* thing that makes a row mine or a colleague's: the server sends one feed and
 * the screen reads it against who is signed in, so nobody sees a version tailored on the server
 * to who they are.
 *
 * The summary strip's numbers come from the dashboard's own count endpoint rather than from the
 * page of rows below, so "247 activities" is the real total and not "as many as fit on screen".
 */

type Lens = 'all' | 'mine' | 'team';

const LENS_LABELS: Record<Lens, string> = {
  all: 'Everyone',
  mine: 'My activity',
  team: 'Teammates',
};

export function ActivitiesPage() {
  const { session } = useSession();
  const canRead = hasPermission(session, 'crm:activities:read');
  const currentUserId = session?.user.id;
  const [lens, setLens] = useState<Lens>('all');

  const feed = useQuery({
    queryKey: ['crm', 'activities', 'company'],
    queryFn: () => api.get<ActivityFeedResponse>(listPath(ACTIVITY_PATHS.activities, { pageSize: 100 })),
    enabled: canRead,
  });

  const counts = useQuery({
    queryKey: ['crm', 'activities', 'company', 'counts'],
    queryFn: () => api.get<ActivityCountsResponse>(DASHBOARD_PATHS.activityCounts),
    enabled: canRead,
  });

  const items = useMemo(() => feed.data?.items ?? [], [feed.data]);

  const shown = useMemo(() => {
    if (lens === 'all') return items;
    return items.filter((item: ActivityFeedItem) => {
      const mine = Boolean(currentUserId) && item.createdByUserId === currentUserId;
      return lens === 'mine' ? mine : !mine;
    });
  }, [items, lens, currentUserId]);

  if (!canRead) {
    return (
      <section className="mx-auto mt-12 max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-2xs">
        <h1 className="text-base font-bold text-slate-900">You cannot see activities.</h1>
        <p className="mt-2 text-sm text-slate-500">
          Ask an administrator for the “Activities: read” permission.
        </p>
      </section>
    );
  }

  const total = counts.data?.totalCount ?? 0;
  const mineTotal =
    counts.data?.byUser.find((user) => user.userId === currentUserId)?.count ?? 0;
  const teamTotal = Math.max(total - mineTotal, 0);

  return (
    <section aria-label="Activities" className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-50 text-teal-700">
            <ActivityIcon size={20} />
          </span>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">Activities</h1>
            <p className="text-sm text-slate-500">
              Everything the team has logged, personal and shared, in one feed.
            </p>
          </div>
        </div>
      </header>

      {/* The three-number summary: the whole team, then the same total cut into mine and theirs.
          Each is a lens too, so the strip both reports and filters. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <SummaryTile
          label="All activity"
          count={total}
          active={lens === 'all'}
          accent="text-slate-900"
          onClick={() => setLens('all')}
        />
        <SummaryTile
          label="My activity"
          count={mineTotal}
          active={lens === 'mine'}
          accent="text-teal-700"
          onClick={() => setLens('mine')}
        />
        <SummaryTile
          label="Teammates"
          count={teamTotal}
          active={lens === 'team'}
          accent="text-indigo-700"
          onClick={() => setLens('team')}
        />
      </div>

      {counts.data && counts.data.byType.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">By type</span>
          {counts.data.byType.map((entry) => (
            <span
              key={entry.type}
              className="rounded-md bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700"
            >
              {entry.type}: <strong className="text-slate-900">{entry.count}</strong>
            </span>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between gap-2">
        <h2 className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Recent activity</h2>
        <div
          role="tablist"
          aria-label="Filter activity"
          className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white p-0.5"
        >
          {(['all', 'mine', 'team'] as Lens[]).map((option) => (
            <button
              key={option}
              type="button"
              role="tab"
              aria-selected={lens === option}
              onClick={() => setLens(option)}
              className={`rounded-md px-3 py-1 text-xs font-semibold transition ${
                lens === option ? 'bg-slate-100 text-slate-900' : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              {LENS_LABELS[option]}
            </button>
          ))}
        </div>
      </div>

      {feed.isPending && (
        <p role="status" className="text-xs text-slate-500">
          Loading activity…
        </p>
      )}

      {feed.error && (
        <p role="alert" className="text-xs text-rose-600">
          The activity feed could not be loaded.
        </p>
      )}

      {!feed.isPending && !feed.error && (
        <ActivityFeedList
          items={shown}
          currentUserId={currentUserId}
          emptyLabel={
            lens === 'mine'
              ? 'You have not logged anything yet. Open a lead and log a call or a note.'
              : lens === 'team'
                ? 'No teammate activity yet.'
                : 'No activity yet. It appears here as the team works leads.'
          }
        />
      )}
    </section>
  );
}

function SummaryTile({
  label,
  count,
  accent,
  active,
  onClick,
}: {
  label: string;
  count: number;
  accent: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`flex flex-col gap-1 rounded-2xl border p-4 text-left transition ${
        active ? 'border-teal-300 bg-teal-50/60 ring-1 ring-teal-200' : 'border-slate-200 bg-white hover:border-slate-300'
      }`}
    >
      <span className={`text-2xl font-bold leading-none ${accent}`}>{count}</span>
      <span className="text-xs font-semibold text-slate-500">{label}</span>
    </button>
  );
}
