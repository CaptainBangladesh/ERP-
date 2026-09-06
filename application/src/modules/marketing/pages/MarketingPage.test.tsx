import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { MARKETING_PATHS, type MarketingListResponse, type MarketingSummary } from '@erp/shared';
import { server } from '../../../test/server';
import { renderPage } from '../../../test/render';
import { MarketingPage } from './MarketingPage';

/**
 * The screen from the user's side.
 *
 * Requests are intercepted at the network boundary and their query strings captured, because
 * "sorted" and "filtered" are only true if the *server* was asked: a screen that reordered
 * rows it was already holding would pass a weaker test and be wrong on page two.
 */
describe('MarketingPage', () => {
  const PAGE_SIZE = 25;

  function row(name: string, overrides: Partial<MarketingSummary> = {}): MarketingSummary {
    return { id: `id-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, name, status: 'active', ...overrides };
  }

  function page(items: MarketingSummary[], total = items.length): MarketingListResponse {
    return { items, page: { number: 1, size: PAGE_SIZE, total, pages: Math.ceil(total / PAGE_SIZE) } };
  }

  function listing(respond: (parameters: URLSearchParams) => MarketingListResponse): { asked: string[] } {
    const asked: string[] = [];

    server.use(
      http.get(MARKETING_PATHS.marketings, ({ request }) => {
        const url = new URL(request.url);
        asked.push(url.search);
        return HttpResponse.json(respond(url.searchParams));
      }),
    );

    return { asked };
  }

  it('shows what is there', async () => {
    listing(() => page([row('First'), row('Second', { status: 'inactive' })]));

    renderPage(<MarketingPage />, { path: '/marketing' });

    expect(await screen.findByText('First')).toBeInTheDocument();
    expect(screen.getByText('Inactive')).toBeInTheDocument();
  });

  it('guides the first action rather than showing an empty box', async () => {
    listing(() => page([]));

    renderPage(<MarketingPage />, { path: '/marketing' });

    // Nothing is seeded in this system, so this is the first thing a real user sees.
    expect(await screen.findByText(/nothing here yet/i)).toBeInTheDocument();
  });

  it('asks the server to sort when a column heading is clicked', async () => {
    const { asked } = listing(() => page([row('First')]));

    const { user } = renderPage(<MarketingPage />, { path: '/marketing' });
    await screen.findByText('First');

    await user.click(screen.getByRole('button', { name: /^name$/i }));
    await waitFor(() => expect(asked.at(-1)).toContain('sort=name'));
  });

  it('creates one and refreshes the list', async () => {
    let sent: unknown;
    let created = false;

    server.use(
      http.get(MARKETING_PATHS.marketings, () =>
        HttpResponse.json(created ? page([row('First')]) : page([])),
      ),
      http.post(MARKETING_PATHS.marketings, async ({ request }) => {
        sent = await request.json();
        created = true;
        return HttpResponse.json(row('First'), { status: 201 });
      }),
    );

    const { user } = renderPage(<MarketingPage />, { path: '/marketing' });
    await screen.findByText(/nothing here yet/i);

    await user.type(screen.getByLabelText(/^name$/i), 'First');
    await user.click(screen.getByRole('button', { name: /add marketing/i }));

    await waitFor(() => expect(sent).toEqual({ name: 'First' }));
    expect(await screen.findByRole('cell', { name: 'First' })).toBeInTheDocument();
  });

  it('puts a server message beside the input it belongs to', async () => {
    server.use(
      http.get(MARKETING_PATHS.marketings, () => HttpResponse.json(page([]))),
      http.post(MARKETING_PATHS.marketings, () =>
        HttpResponse.json(
          {
            code: 'validation_failed',
            message: 'Some of the details you entered need attention.',
            fields: { name: 'Enter a name.' },
          },
          { status: 422 },
        ),
      ),
    );

    const { user } = renderPage(<MarketingPage />, { path: '/marketing' });
    await screen.findByText(/nothing here yet/i);

    await user.click(screen.getByRole('button', { name: /add marketing/i }));

    const name = await screen.findByLabelText(/^name$/i);
    expect(name).toHaveAttribute('aria-invalid', 'true');
    expect(name).toHaveAccessibleDescription(/enter a name/i);
  });
});
