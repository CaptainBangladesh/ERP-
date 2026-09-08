import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { MARKETING_PATHS } from '@erp/shared';
import { server } from '../../test/server';
import { renderPage } from '../../test/render';
import { ContentSourcesManager } from './components/ContentSourcesManager';

/**
 * Ticket 15 on the screen: the claims the panel is responsible for.
 *
 * A feed entry is a stranger's text arriving on a rendering path (16d); a failed fetch is
 * reported as a code rather than as whatever the remote host said (14-17.0d); and every list is
 * narrowed the way the list convention actually reads, which is the difference between a brand
 * workspace and every brand's rows under one brand's heading. All are asserted against what is
 * in the DOM or on the wire, because all of them would still "look fine" if they were wrong.
 */
describe('marketing: feeds and competitors', () => {
  function listOf(items: unknown[]) {
    return { items, page: { number: 1, size: 25, total: items.length, pages: 1 } };
  }

  function sources(options: {
    feeds?: unknown[];
    entries?: unknown[];
    competitors?: unknown[];
    /** Every list URL the panel asked for, in order. */
    seen?: string[];
  }) {
    const record = (url: string) => options.seen?.push(url);

    server.use(
      http.get(MARKETING_PATHS.contentFeeds, ({ request }) => {
        record(request.url);
        return HttpResponse.json(listOf(options.feeds ?? []));
      }),
      http.get(MARKETING_PATHS.contentFeedEntries, ({ request }) => {
        record(request.url);
        return HttpResponse.json(listOf(options.entries ?? []));
      }),
      http.get(MARKETING_PATHS.competitors, ({ request }) => {
        record(request.url);
        return HttpResponse.json(listOf(options.competitors ?? []));
      }),
    );
  }

  it('narrows every list by filter.brandId, which is the key the API reads', async () => {
    const seen: string[] = [];
    sources({ seen });

    renderPage(<ContentSourcesManager brandId="brand-1" brandName="Nike Global" />);

    await waitFor(() => expect(seen).toHaveLength(3));

    // A bare `?brandId=` is an unknown key, and unknown keys are ignored — so the panel would
    // have listed every brand's feeds, entries and competitors with nothing on screen saying so.
    for (const url of seen) {
      expect(url).toContain('filter.brandId=brand-1');
      expect(new URL(url).searchParams.get('brandId')).toBeNull();
    }
  });

  it('tells loading, error and empty apart rather than saying "none" to all three', async () => {
    server.use(
      http.get(MARKETING_PATHS.contentFeeds, () => HttpResponse.error()),
      http.get(MARKETING_PATHS.contentFeedEntries, () => HttpResponse.json(listOf([]))),
      http.get(MARKETING_PATHS.competitors, () => HttpResponse.json(listOf([]))),
    );

    renderPage(<ContentSourcesManager brandId="brand-1" brandName="Nike Global" />);

    // The feeds list failed; the drafts list is genuinely empty. One "No feeds yet." for both
    // is the rendering this split exists to prevent.
    expect(await screen.findByRole('button', { name: /try again/i })).toBeInTheDocument();
    expect(await screen.findByText(/nothing ingested yet/i)).toBeInTheDocument();
  });

  it('renders an engagement rate as the string the API sent, not a parsed number', async () => {
    sources({
      competitors: [
        {
          id: 'competitor-1',
          brandId: 'brand-1',
          network: 'instagram',
          handle: 'rival_co',
          label: 'Rival Co',
          metricsSupported: true,
          latestSnapshot: {
            id: 'snapshot-1',
            competitorId: 'competitor-1',
            network: 'instagram',
            captureDate: '2026-09-08',
            followerCount: 4200,
            postCount: 310,
            engagementRate: '0.0450',
            capturedAt: new Date().toISOString(),
          },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
    });

    renderPage(<ContentSourcesManager brandId="brand-1" brandName="Nike Global" />);

    // `0.0450`, with its trailing zero — the scale the column carries. `Number('0.0450')`
    // renders `0.045`, which is a different claim about precision.
    expect(await screen.findByText(/0\.0450 engagement/)).toBeInTheDocument();
  });

  it('renders a feed headline containing markup as text', async () => {
    sources({
      entries: [
        {
          id: 'entry-1',
          brandId: 'brand-1',
          feedId: 'feed-1',
          feedName: 'Industry news',
          title: '<script>alert(1)</script> Ten trends',
          excerpt: 'Words about it.',
          link: 'https://news.test/1',
          fetchedAt: new Date().toISOString(),
          status: 'DRAFT',
        },
      ],
    });

    renderPage(<ContentSourcesManager brandId="brand-1" brandName="Nike Global" />);

    // The characters, in a text node — not a `script` element, and not stripped either.
    const headline = await screen.findByText('<script>alert(1)</script> Ten trends');
    expect(headline.querySelector('script')).toBeNull();
    expect(document.querySelector('script[data-testid]')).toBeNull();
  });

  it('shows a refusal as our own words for the reason code, never the remote response', async () => {
    sources({
      feeds: [
        {
          id: 'feed-1',
          brandId: 'brand-1',
          name: 'Industry news',
          url: 'https://feeds.example.test/rss',
          status: 'ACTIVE',
          lastReason: 'blocked_address',
          consecutiveFailures: 1,
          entryCount: 0,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
    });

    renderPage(<ContentSourcesManager brandId="brand-1" brandName="Nike Global" />);

    expect(
      await screen.findByText(/that host resolves to an address this server will not call/i),
    ).toBeInTheDocument();
  });

  it('offers a re-enable action for a feed that was disabled after repeated failures', async () => {
    sources({
      feeds: [
        {
          id: 'feed-1',
          brandId: 'brand-1',
          name: 'Dead feed',
          url: 'https://feeds.example.test/rss',
          status: 'DISABLED',
          lastReason: 'timeout',
          consecutiveFailures: 5,
          entryCount: 0,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
    });

    renderPage(<ContentSourcesManager brandId="brand-1" brandName="Nike Global" />);

    expect(await screen.findByRole('button', { name: /re-enable/i })).toBeInTheDocument();
  });

  it('says so honestly when a network publishes no public profile metrics', async () => {
    sources({
      competitors: [
        {
          id: 'competitor-1',
          brandId: 'brand-1',
          network: 'linkedin',
          handle: 'rival-co',
          label: 'Rival Co',
          metricsSupported: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
    });

    renderPage(<ContentSourcesManager brandId="brand-1" brandName="Nike Global" />);

    expect(await screen.findByText(/not supported on this network/i)).toBeInTheDocument();
    // No snapshot button, because there is nothing to ask for — and no scraper behind a flag.
    expect(screen.queryByRole('button', { name: /^snapshot$/i })).toBeNull();
  });
});
