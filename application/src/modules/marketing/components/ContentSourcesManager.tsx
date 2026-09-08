import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import {
  MARKETING_PATHS,
  OUTBOUND_FETCH_REASON_LABELS,
  SOCIAL_PLATFORMS,
  emptyPage,
  listPath,
  type CompetitorListResponse,
  type CompetitorSummary,
  type ContentFeedEntryListResponse,
  type ContentFeedEntrySummary,
  type ContentFeedListResponse,
  type ContentFeedSummary,
  type ListQuery,
  type SocialPlatform,
} from '@erp/shared';
import { Button, DataTable, Field, Select } from '@erp/shared/ui';
import { ApiFailure, api } from '../../../api/client';

/**
 * External content sources: the feeds a brand watches, and the handles it benchmarks against.
 *
 * Four things about this panel are load-bearing rather than cosmetic.
 *
 * **Every list is scoped by `filter.brandId`, not `brandId`.** The list convention reads
 * `filter.<field>` and *ignores* unknown keys, so a bare `?brandId=` is not a narrowed list —
 * it is every brand's feeds, entries and competitors rendered under one brand's heading, with
 * nothing on screen to say so. This panel drives credentialed reads, which makes that the
 * difference between a brand workspace and a leak.
 *
 * **Every list is a `DataTable`.** Which brings paging with it: a hand-rolled `<ul>` over
 * `items` shows the first twenty-five rows of a list of two hundred and offers no way to the
 * rest, and the operator cannot tell the difference between "twenty-five feeds" and "the
 * first twenty-five". It also brings the four renderings — loading, error, empty, no matches —
 * that a single "No feeds yet." collapses into one wrong answer three times out of four.
 *
 * **Feed text is text (16d).** Every title and excerpt below is a React child, never
 * `dangerouslySetInnerHTML` and never handed to a markdown renderer — a stranger's `<script>`
 * in a headline renders as the characters `<script>`, which is what the ingest test asserts.
 *
 * **A failing feed shows its reason code, in our own words (14-17.0d).** Nothing the remote
 * host said reaches this screen: no status line, no header, no body fragment, no resolved
 * address. An error panel that echoed them would be blind SSRF with a UI.
 */
export function ContentSourcesManager({
  brandId,
  brandName,
}: {
  brandId: string;
  brandName: string;
}) {
  const queryClient = useQueryClient();
  const [feedName, setFeedName] = useState('');
  const [feedUrl, setFeedUrl] = useState('');
  const [feedError, setFeedError] = useState<string | null>(null);
  const [handle, setHandle] = useState('');
  const [network, setNetwork] = useState<SocialPlatform>('instagram');
  const [competitorError, setCompetitorError] = useState<string | null>(null);

  const [feedQuery, setFeedQuery] = useState<ListQuery>({});
  const [entryQuery, setEntryQuery] = useState<ListQuery>({});
  const [competitorQuery, setCompetitorQuery] = useState<ListQuery>({});

  /** The brand narrows every one of these, and it narrows them the way the API reads. */
  const scopedTo = (query: ListQuery): ListQuery => ({
    ...query,
    filters: { ...query.filters, brandId },
  });

  const feedsQuery = useQuery({
    queryKey: ['marketing', 'content-feeds', brandId, feedQuery],
    queryFn: () =>
      api.get<ContentFeedListResponse>(
        listPath(MARKETING_PATHS.contentFeeds, scopedTo(feedQuery)),
      ),
    enabled: Boolean(brandId),
  });

  const entriesQuery = useQuery({
    queryKey: ['marketing', 'content-feed-entries', brandId, entryQuery],
    queryFn: () =>
      api.get<ContentFeedEntryListResponse>(
        listPath(MARKETING_PATHS.contentFeedEntries, scopedTo(entryQuery)),
      ),
    enabled: Boolean(brandId),
  });

  const competitorsQuery = useQuery({
    queryKey: ['marketing', 'competitors', brandId, competitorQuery],
    queryFn: () =>
      api.get<CompetitorListResponse>(
        listPath(MARKETING_PATHS.competitors, scopedTo(competitorQuery)),
      ),
    enabled: Boolean(brandId),
  });

  const refreshFeeds = () => {
    void queryClient.invalidateQueries({ queryKey: ['marketing', 'content-feeds', brandId] });
    void queryClient.invalidateQueries({
      queryKey: ['marketing', 'content-feed-entries', brandId],
    });
  };

  const refreshCompetitors = () =>
    void queryClient.invalidateQueries({ queryKey: ['marketing', 'competitors', brandId] });

  const addFeed = useMutation({
    mutationFn: () =>
      api.post<ContentFeedSummary>(MARKETING_PATHS.contentFeeds, {
        brandId,
        name: feedName,
        url: feedUrl,
      }),
    onSuccess: () => {
      setFeedName('');
      setFeedUrl('');
      setFeedError(null);
      refreshFeeds();
    },
    onError: (error: unknown) => {
      setFeedError(error instanceof ApiFailure ? error.message : 'That feed could not be added.');
    },
  });

  const pollFeed = useMutation({
    mutationFn: (id: string) => api.post<ContentFeedSummary>(MARKETING_PATHS.pollContentFeed(id), {}),
    onSuccess: refreshFeeds,
  });

  const enableFeed = useMutation({
    mutationFn: (id: string) =>
      api.post<ContentFeedSummary>(MARKETING_PATHS.enableContentFeed(id), {}),
    onSuccess: refreshFeeds,
  });

  const removeFeed = useMutation({
    mutationFn: (id: string) => api.delete(MARKETING_PATHS.contentFeed(id)),
    onSuccess: refreshFeeds,
  });

  const addCompetitor = useMutation({
    mutationFn: () =>
      api.post<CompetitorSummary>(MARKETING_PATHS.competitors, { brandId, network, handle }),
    onSuccess: () => {
      setHandle('');
      setCompetitorError(null);
      refreshCompetitors();
    },
    onError: (error: unknown) => {
      setCompetitorError(
        error instanceof ApiFailure ? error.message : 'That competitor could not be added.',
      );
    },
  });

  const snapshotCompetitor = useMutation({
    mutationFn: (id: string) =>
      api.post<CompetitorSummary>(MARKETING_PATHS.snapshotCompetitor(id), {}),
    onSuccess: refreshCompetitors,
    onError: (error: unknown) => {
      setCompetitorError(
        error instanceof ApiFailure ? error.message : 'That snapshot could not be requested.',
      );
    },
  });

  const removeCompetitor = useMutation({
    mutationFn: (id: string) => api.delete(MARKETING_PATHS.competitor(id)),
    onSuccess: refreshCompetitors,
  });

  const feedColumns: Array<ColumnDef<ContentFeedSummary, unknown>> = [
    {
      id: 'name',
      header: 'Feed',
      cell: ({ row }) => (
        <div className="flex flex-col">
          <span className="font-medium text-slate-900">{row.original.name}</span>
          <span className="text-xs text-slate-500">{row.original.url}</span>
        </div>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      cell: ({ row }) => (
        <div className="flex flex-col">
          <span>{row.original.status === 'DISABLED' ? 'Paused after repeated failures' : 'Watching'}</span>
          {row.original.lastReason && (
            <span className="text-xs text-rose-700">
              {OUTBOUND_FETCH_REASON_LABELS[row.original.lastReason]}
            </span>
          )}
        </div>
      ),
    },
    {
      id: 'entryCount',
      header: 'Entries',
      enableSorting: false,
      cell: ({ row }) => row.original.entryCount,
    },
    {
      id: 'actions',
      header: 'Actions',
      enableSorting: false,
      cell: ({ row }) => (
        <div className="flex items-center gap-2">
          {row.original.status === 'DISABLED' ? (
            <Button variant="secondary" onClick={() => enableFeed.mutate(row.original.id)}>
              Re-enable
            </Button>
          ) : (
            <Button variant="secondary" onClick={() => pollFeed.mutate(row.original.id)}>
              Check now
            </Button>
          )}
          <Button variant="secondary" onClick={() => removeFeed.mutate(row.original.id)}>
            Remove
          </Button>
        </div>
      ),
    },
  ];

  const entryColumns: Array<ColumnDef<ContentFeedEntrySummary, unknown>> = [
    {
      id: 'title',
      header: 'Headline',
      cell: ({ row }) => (
        <div className="flex flex-col">
          {/* Text, always. A headline from a stranger is never markup here (16d). */}
          <span className="font-medium text-slate-900">{row.original.title}</span>
          <span className="text-slate-600">{row.original.excerpt}</span>
        </div>
      ),
    },
    {
      id: 'feedId',
      header: 'Source',
      enableSorting: false,
      cell: ({ row }) => (
        <div className="flex flex-col">
          <span>{row.original.feedName}</span>
          <a
            className="text-xs underline"
            href={row.original.link}
            rel="noreferrer noopener nofollow"
            target="_blank"
          >
            source
          </a>
        </div>
      ),
    },
    {
      id: 'status',
      header: 'Draft',
      enableSorting: false,
      cell: ({ row }) =>
        row.original.status === 'DRAFT' ? (
          'In the composer'
        ) : (
          // Honest about why nothing is draftable yet, rather than showing an empty column.
          <span className="text-slate-600">Waiting for a connected account</span>
        ),
    },
    {
      id: 'fetchedAt',
      header: 'Fetched',
      cell: ({ row }) => new Date(row.original.fetchedAt).toLocaleDateString(),
    },
  ];

  const competitorColumns: Array<ColumnDef<CompetitorSummary, unknown>> = [
    {
      id: 'label',
      header: 'Competitor',
      cell: ({ row }) => (
        <div className="flex flex-col">
          <span className="font-medium text-slate-900">{row.original.label}</span>
          <span className="text-xs text-slate-500">{row.original.network}</span>
        </div>
      ),
    },
    {
      id: 'latestSnapshot',
      header: 'Latest snapshot',
      enableSorting: false,
      cell: ({ row }) => {
        const competitor = row.original;
        if (!competitor.metricsSupported) {
          // The honest empty state (15a). There is no scraper behind a flag, so this is the
          // whole answer for this network rather than a "coming soon".
          return (
            <span className="text-slate-600">
              Not supported on this network — its API publishes no public profile metrics.
            </span>
          );
        }
        const latest = competitor.latestSnapshot;
        if (!latest) return <span className="text-slate-600">No snapshot yet.</span>;

        return (
          <span className="text-slate-600">
            {latest.followerCount ?? '—'} followers · {latest.postCount ?? '—'} posts ·{' '}
            {/* A decimal string straight through — never `Number(…)` on the way to a screen. */}
            {latest.engagementRate ?? '—'} engagement · captured {latest.captureDate}
          </span>
        );
      },
    },
    {
      id: 'competitorActions',
      header: 'Actions',
      enableSorting: false,
      cell: ({ row }) => (
        <div className="flex items-center gap-2">
          {row.original.metricsSupported && (
            <Button variant="secondary" onClick={() => snapshotCompetitor.mutate(row.original.id)}>
              Snapshot
            </Button>
          )}
          <Button variant="secondary" onClick={() => removeCompetitor.mutate(row.original.id)}>
            Remove
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold text-slate-900">Sources for {brandName}</h2>
        <p className="text-sm text-slate-600">
          Feeds arrive as drafts for a person to schedule — nothing here publishes on its own.
          Competitor numbers come from each network’s own API through this brand’s connected
          account, and spend the same publishing quota a post does.
        </p>
      </header>

      <section aria-labelledby="feeds-heading" className="flex flex-col gap-3">
        <h3 id="feeds-heading" className="text-sm font-semibold text-slate-900">
          Content feeds
        </h3>

        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (feedName.trim() === '' || feedUrl.trim() === '') return;
            addFeed.mutate();
          }}
        >
          <Field id="feed-name" label="Name" value={feedName} onChange={setFeedName} />
          <Field
            id="feed-url"
            label="Feed address"
            value={feedUrl}
            onChange={setFeedUrl}
            hint="An https:// address. This server fetches it on a schedule."
          />
          <Button type="submit" disabled={addFeed.isPending}>
            Add feed
          </Button>
        </form>

        {feedError && (
          <p role="alert" className="text-sm text-rose-700">
            {feedError}
          </p>
        )}

        <DataTable
          caption="Content feeds"
          columns={feedColumns}
          rows={feedsQuery.data?.items ?? []}
          rowId={(feed) => feed.id}
          page={feedsQuery.data?.page ?? emptyPage()}
          query={feedQuery}
          onQueryChange={setFeedQuery}
          status={feedsQuery.isPending ? 'loading' : feedsQuery.isError ? 'error' : 'ready'}
          error={failureText(feedsQuery.error, 'The feeds could not be loaded.')}
          onRetry={() => void feedsQuery.refetch()}
          searchLabel="Search feeds by name"
          empty={
            <div className="flex flex-col gap-1">
              <p className="font-medium text-slate-900">No feeds yet.</p>
              <p>Add an https:// feed address above to start collecting drafts.</p>
            </div>
          }
          noMatches="No feed matches that search. Clear it to see them all."
        />
      </section>

      <section aria-labelledby="drafts-heading" className="flex flex-col gap-3">
        <h3 id="drafts-heading" className="text-sm font-semibold text-slate-900">
          Drafts from feeds
        </h3>

        <DataTable
          caption="Entries ingested from content feeds"
          columns={entryColumns}
          rows={entriesQuery.data?.items ?? []}
          rowId={(entry) => entry.id}
          page={entriesQuery.data?.page ?? emptyPage()}
          query={entryQuery}
          onQueryChange={setEntryQuery}
          status={entriesQuery.isPending ? 'loading' : entriesQuery.isError ? 'error' : 'ready'}
          error={failureText(entriesQuery.error, 'The drafts could not be loaded.')}
          onRetry={() => void entriesQuery.refetch()}
          searchLabel="Search headlines"
          empty={
            <div className="flex flex-col gap-1">
              <p className="font-medium text-slate-900">Nothing ingested yet.</p>
              <p>Add a feed above, or use “Check now” on one you already watch.</p>
            </div>
          }
          noMatches="No headline matches that search. Clear it to see them all."
        />
      </section>

      <section aria-labelledby="competitors-heading" className="flex flex-col gap-3">
        <h3 id="competitors-heading" className="text-sm font-semibold text-slate-900">
          Competitors
        </h3>

        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (handle.trim() === '') return;
            addCompetitor.mutate();
          }}
        >
          <Select
            id="competitor-network"
            label="Network"
            value={network}
            onChange={(value) => setNetwork(value as SocialPlatform)}
            options={SOCIAL_PLATFORMS.map((platform) => ({ value: platform, label: platform }))}
          />
          <Field
            id="competitor-handle"
            label="Handle"
            value={handle}
            onChange={setHandle}
            hint="The name on the profile, not a link. Each network has its own rules."
          />
          <Button type="submit" disabled={addCompetitor.isPending}>
            Track competitor
          </Button>
        </form>

        {competitorError && (
          <p role="alert" className="text-sm text-rose-700">
            {competitorError}
          </p>
        )}

        <DataTable
          caption="Competitor handles"
          columns={competitorColumns}
          rows={competitorsQuery.data?.items ?? []}
          rowId={(competitor) => competitor.id}
          page={competitorsQuery.data?.page ?? emptyPage()}
          query={competitorQuery}
          onQueryChange={setCompetitorQuery}
          status={
            competitorsQuery.isPending ? 'loading' : competitorsQuery.isError ? 'error' : 'ready'
          }
          error={failureText(competitorsQuery.error, 'The competitors could not be loaded.')}
          onRetry={() => void competitorsQuery.refetch()}
          searchLabel="Search competitors"
          empty={
            <div className="flex flex-col gap-1">
              <p className="font-medium text-slate-900">No competitors tracked yet.</p>
              <p>Add a public business handle above to start a daily benchmark.</p>
            </div>
          }
          noMatches="No competitor matches that search. Clear it to see them all."
        />
      </section>
    </div>
  );
}

/** The failure's own message where there is one, and our words where there is not. */
function failureText(error: unknown, fallback: string): string | undefined {
  if (error === null || error === undefined) return undefined;
  return error instanceof ApiFailure ? error.message : fallback;
}
