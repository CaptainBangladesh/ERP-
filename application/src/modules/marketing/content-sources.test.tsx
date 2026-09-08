import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { MARKETING_PATHS } from '@erp/shared';
import { server } from '../../test/server';
import { renderPage } from '../../test/render';
import { ContentSourcesManager } from './components/ContentSourcesManager';

/**
 * Ticket 15 on the screen: the two claims the panel is responsible for.
 *
 * A feed entry is a stranger's text arriving on a rendering path (16d), and a failed fetch is
 * reported as a code rather than as whatever the remote host said (14-17.0d). Both are asserted
 * against what is actually in the DOM, because both would still "look fine" if they were wrong.
 */
describe('marketing: feeds and competitors', () => {
  function listOf(items: unknown[]) {
    return { items, page: { number: 1, size: 25, total: items.length, pages: 1 } };
  }

  function sources(options: {
    feeds?: unknown[];
    entries?: unknown[];
    competitors?: unknown[];
  }) {
    server.use(
      http.get(MARKETING_PATHS.contentFeeds, () => HttpResponse.json(listOf(options.feeds ?? []))),
      http.get(MARKETING_PATHS.contentFeedEntries, () =>
        HttpResponse.json(listOf(options.entries ?? [])),
      ),
      http.get(MARKETING_PATHS.competitors, () =>
        HttpResponse.json(listOf(options.competitors ?? [])),
      ),
    );
  }

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
