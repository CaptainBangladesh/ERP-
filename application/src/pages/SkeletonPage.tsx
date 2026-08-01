import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  SKELETON_PROBES_PATH,
  SKELETON_PROBE_COUNT_PATH,
  type SkeletonProbe,
  type SkeletonProbeCount,
} from '@erp/shared';
import { api, ApiFailure } from '../api/client';

/**
 * TEMPORARY — replaced by the sign-in and home screens in ticket 02.
 *
 * Proves the read path and the write path through every layer against an empty database.
 * The three states it renders — empty, loading, error — are the ones every later screen
 * must render too: because the application seeds nothing, an empty result is the normal
 * first experience of every feature, not an edge case.
 */
export function SkeletonPage() {
  const queryClient = useQueryClient();

  const countQuery = useQuery({
    queryKey: ['skeleton-probes', 'count'],
    queryFn: () => api.get<SkeletonProbeCount>(SKELETON_PROBE_COUNT_PATH),
  });

  const createProbe = useMutation({
    mutationFn: () => api.post<SkeletonProbe>(SKELETON_PROBES_PATH),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['skeleton-probes'] }),
  });

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-6 p-8">
      <header>
        <h1 className="text-2xl font-semibold text-slate-900">Walking skeleton</h1>
        <p className="mt-1 text-sm text-slate-600">
          React to NestJS to Prisma to PostgreSQL, against an empty database.
        </p>
      </header>

      <section
        aria-label="Probe count"
        className="rounded-lg border border-slate-200 bg-white p-6"
      >
        {countQuery.isPending ? (
          <p className="text-slate-500">Loading…</p>
        ) : countQuery.isError ? (
          <div role="alert" className="text-red-700">
            <p className="font-medium">Could not load the count.</p>
            <p className="mt-1 text-sm">
              {countQuery.error instanceof ApiFailure
                ? countQuery.error.message
                : 'Something went wrong. Please try again.'}
            </p>
          </div>
        ) : countQuery.data.count === 0 ? (
          <p className="text-slate-500">
            No probes yet. Nothing is ever seeded — create the first one.
          </p>
        ) : (
          <p className="text-slate-900">
            <span className="text-4xl font-semibold tabular-nums">{countQuery.data.count}</span>
            <span className="ml-2 text-slate-600">
              {countQuery.data.count === 1 ? 'probe' : 'probes'}
            </span>
          </p>
        )}
      </section>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => createProbe.mutate()}
          disabled={createProbe.isPending}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
        >
          {createProbe.isPending ? 'Creating…' : 'Create a probe'}
        </button>

        {createProbe.isError && (
          <p role="alert" className="text-sm text-red-700">
            {createProbe.error instanceof ApiFailure
              ? createProbe.error.message
              : 'Could not create a probe.'}
          </p>
        )}
      </div>
    </main>
  );
}
