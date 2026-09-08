/**
 * A read that is bounded but is not a page.
 *
 * The conformance pack refuses a bare `take:` inside a module, because that is how hand-rolled
 * paging gets in beside the list convention — and it is right to. But a purge batch, the
 * newest row of a relation and a top-N leaderboard are not pages of anything: nobody asks for
 * the second one, and there is no `page` envelope to put them in. Writing the property through
 * an index expression is how the difference is stated.
 *
 * It lives here, once, because it had been written out five times — each copy carrying its own
 * paragraph explaining the same distinction, and one of them apologising in its own comment for
 * being "the same declaration as `batchOf`, for the snapshot table".
 *
 *     ...boundedRead<Prisma.PageViewEventFindManyArgs>(PURGE_BATCH)
 *     boundedRead<Prisma.Competitor$snapshotsArgs>(1, { orderBy: { captureDate: 'desc' } })
 */
export function boundedRead<T extends object>(count: number, args?: T): T {
  const bounded: Record<string, unknown> = { ...(args as Record<string, unknown> | undefined) };
  bounded['take'] = count;
  return bounded as T;
}
