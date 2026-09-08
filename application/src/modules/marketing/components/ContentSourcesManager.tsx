import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  MARKETING_PATHS,
  OUTBOUND_FETCH_REASON_LABELS,
  SOCIAL_PLATFORMS,
  type CompetitorListResponse,
  type CompetitorSummary,
  type ContentFeedEntryListResponse,
  type ContentFeedListResponse,
  type ContentFeedSummary,
  type SocialPlatform,
} from '@erp/shared';
import { Button, Field, Select } from '@erp/shared/ui';
import { ApiFailure, api } from '../../../api/client';

/**
 * External content sources: the feeds a brand watches, and the handles it benchmarks against.
 *
 * Two things about this panel are load-bearing rather than cosmetic.
 *
 * Feed text is **text** (16d). Every title and excerpt below is a React child, never
 * `dangerouslySetInnerHTML` and never handed to a markdown renderer — a stranger's `<script>`
 * in a headline renders as the characters `<script>`, which is what the ingest test asserts.
 *
 * A failing feed shows its reason **code**, translated to our own words (14-17.0d). Nothing the
 * remote host said reaches this screen: no status line, no header, no body fragment, no
 * resolved address. An error panel that echoed them would be blind SSRF with a UI.
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

  const feedsQuery = useQuery({
    queryKey: ['marketing', 'content-feeds', brandId],
    queryFn: () =>
      api.get<ContentFeedListResponse>(
        `${MARKETING_PATHS.contentFeeds}?brandId=${encodeURIComponent(brandId)}`,
      ),
    enabled: Boolean(brandId),
  });

  const entriesQuery = useQuery({
    queryKey: ['marketing', 'content-feed-entries', brandId],
    queryFn: () =>
      api.get<ContentFeedEntryListResponse>(
        `${MARKETING_PATHS.contentFeedEntries}?brandId=${encodeURIComponent(brandId)}`,
      ),
    enabled: Boolean(brandId),
  });

  const competitorsQuery = useQuery({
    queryKey: ['marketing', 'competitors', brandId],
    queryFn: () =>
      api.get<CompetitorListResponse>(
        `${MARKETING_PATHS.competitors}?brandId=${encodeURIComponent(brandId)}`,
      ),
    enabled: Boolean(brandId),
  });

  const feeds = feedsQuery.data?.items ?? [];
  const entries = entriesQuery.data?.items ?? [];
  const competitors = competitorsQuery.data?.items ?? [];

  const refreshFeeds = () => {
    void queryClient.invalidateQueries({ queryKey: ['marketing', 'content-feeds', brandId] });
    void queryClient.invalidateQueries({
      queryKey: ['marketing', 'content-feed-entries', brandId],
    });
  };

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
      void queryClient.invalidateQueries({ queryKey: ['marketing', 'competitors', brandId] });
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
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: ['marketing', 'competitors', brandId] }),
  });

  const removeCompetitor = useMutation({
    mutationFn: (id: string) => api.delete(MARKETING_PATHS.competitor(id)),
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: ['marketing', 'competitors', brandId] }),
  });

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold text-slate-900">Sources for {brandName}</h2>
        <p className="text-sm text-slate-600">
          Feeds arrive as drafts for a person to schedule — nothing here publishes on its own.
          Competitor numbers come from each network’s own API through this brand’s connected
          account.
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

        {feeds.length === 0 ? (
          <p className="text-sm text-slate-600">No feeds yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {feeds.map((feed) => (
              <li
                key={feed.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-slate-200 px-3 py-2"
              >
                <div className="flex flex-col">
                  <span className="text-sm font-medium text-slate-900">{feed.name}</span>
                  <span className="text-xs text-slate-500">{feed.url}</span>
                  <span className="text-xs text-slate-600">
                    {feed.entryCount} draft{feed.entryCount === 1 ? '' : 's'}
                    {feed.status === 'DISABLED' ? ' · paused after repeated failures' : ''}
                  </span>
                  {feed.lastReason && (
                    <span className="text-xs text-rose-700">
                      {OUTBOUND_FETCH_REASON_LABELS[feed.lastReason]}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {feed.status === 'DISABLED' ? (
                    <Button variant="secondary" onClick={() => enableFeed.mutate(feed.id)}>
                      Re-enable
                    </Button>
                  ) : (
                    <Button variant="secondary" onClick={() => pollFeed.mutate(feed.id)}>
                      Check now
                    </Button>
                  )}
                  <Button variant="secondary" onClick={() => removeFeed.mutate(feed.id)}>
                    Remove
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="drafts-heading" className="flex flex-col gap-3">
        <h3 id="drafts-heading" className="text-sm font-semibold text-slate-900">
          Drafts from feeds
        </h3>
        {entries.length === 0 ? (
          <p className="text-sm text-slate-600">Nothing ingested yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {entries.map((entry) => (
              <li key={entry.id} className="rounded-md border border-slate-200 px-3 py-2">
                {/* Text, always. A headline from a stranger is never markup here (16d). */}
                <p className="text-sm font-medium text-slate-900">{entry.title}</p>
                <p className="text-sm text-slate-600">{entry.excerpt}</p>
                <p className="text-xs text-slate-500">
                  {entry.feedName} ·{' '}
                  <a className="underline" href={entry.link} rel="noreferrer noopener nofollow" target="_blank">
                    source
                  </a>
                </p>
              </li>
            ))}
          </ul>
        )}
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
            hint="The name on the profile, not a link."
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

        {competitors.length === 0 ? (
          <p className="text-sm text-slate-600">No competitors tracked yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {competitors.map((competitor) => (
              <li
                key={competitor.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-slate-200 px-3 py-2"
              >
                <div className="flex flex-col">
                  <span className="text-sm font-medium text-slate-900">
                    {competitor.label} · {competitor.network}
                  </span>
                  {!competitor.metricsSupported ? (
                    // The honest empty state (15a). There is no scraper behind a flag, so
                    // this is the whole answer for this network rather than a "coming soon".
                    <span className="text-xs text-slate-600">
                      Not supported on this network — its API publishes no public profile
                      metrics.
                    </span>
                  ) : competitor.latestSnapshot ? (
                    <span className="text-xs text-slate-600">
                      {competitor.latestSnapshot.followerCount ?? '—'} followers ·{' '}
                      {competitor.latestSnapshot.postCount ?? '—'} posts · captured{' '}
                      {competitor.latestSnapshot.captureDate}
                    </span>
                  ) : (
                    <span className="text-xs text-slate-600">No snapshot yet.</span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {competitor.metricsSupported && (
                    <Button
                      variant="secondary"
                      onClick={() => snapshotCompetitor.mutate(competitor.id)}
                    >
                      Snapshot
                    </Button>
                  )}
                  <Button variant="secondary" onClick={() => removeCompetitor.mutate(competitor.id)}>
                    Remove
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
