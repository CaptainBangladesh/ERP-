import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import {
  PRODUCT_PATHS,
  WARRANTY_PATHS,
  type ProductListResponse,
  type ProductSummary,
  type WarrantyListResponse,
  type WarrantySummary,
} from '@erp/shared';
import { server } from '../../../test/server';
import { renderPage } from '../../../test/render';
import { WarrantiesPage } from './WarrantiesPage';

/**
 * The screen from the user's side.
 *
 * Requests are intercepted at the network boundary and their query strings captured, because
 * "sorted" and "filtered" are only true if the *server* was asked: a screen that reordered
 * rows it was already holding would pass a weaker test and be wrong on page two.
 */
describe('WarrantiesPage', () => {
  const PAGE_SIZE = 25;

  function row(months: number, overrides: Partial<WarrantySummary> = {}): WarrantySummary {
    return {
      id: `id-${months}`,
      productId: 'product-1',
      productName: 'Widget',
      months,
      notes: null,
      status: 'active',
      ...overrides,
    };
  }

  function page(items: WarrantySummary[], total = items.length): WarrantyListResponse {
    return { items, page: { number: 1, size: PAGE_SIZE, total, pages: Math.ceil(total / PAGE_SIZE) } };
  }

  function product(): ProductSummary {
    return {
      id: 'product-1',
      code: 'WIDGET-1',
      name: 'Widget',
      status: 'active',
      stockable: true,
      unitId: 'unit-1',
      unitCode: 'each',
      unitName: 'Each',
      cost: null,
    };
  }

  function listing(respond: (parameters: URLSearchParams) => WarrantyListResponse): { asked: string[] } {
    const asked: string[] = [];

    server.use(
      http.get(WARRANTY_PATHS.warranties, ({ request }) => {
        const url = new URL(request.url);
        asked.push(url.search);
        return HttpResponse.json(respond(url.searchParams));
      }),
      http.get(PRODUCT_PATHS.products, () =>
        HttpResponse.json({
          items: [product()],
          page: { number: 1, size: 100, total: 1, pages: 1 },
        } satisfies ProductListResponse),
      ),
    );

    return { asked };
  }

  it('shows what is there', async () => {
    listing(() => page([row(12), row(24, { status: 'inactive' })]));

    renderPage(<WarrantiesPage />, { path: '/warranties' });

    // Both rows name the same product, so the product column is not unique text — the row is
    // identified by its months instead.
    expect(await screen.findAllByText('Widget')).toHaveLength(2);
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('Inactive')).toBeInTheDocument();
  });

  it('guides the first action rather than showing an empty box', async () => {
    listing(() => page([]));

    renderPage(<WarrantiesPage />, { path: '/warranties' });

    // Nothing is seeded in this system, so this is the first thing a real user sees.
    expect(await screen.findByText(/nothing here yet/i)).toBeInTheDocument();
  });

  it('asks the server to sort when a column heading is clicked', async () => {
    const { asked } = listing(() => page([row(12)]));

    const { user } = renderPage(<WarrantiesPage />, { path: '/warranties' });
    await screen.findByText('Widget');

    await user.click(screen.getByRole('button', { name: /^months$/i }));
    await waitFor(() => expect(asked.at(-1)).toContain('sort=months'));
  });

  it('creates one against a chosen product and refreshes the list', async () => {
    let sent: unknown;
    let created = false;

    server.use(
      http.get(WARRANTY_PATHS.warranties, () =>
        HttpResponse.json(created ? page([row(18)]) : page([])),
      ),
      http.get(PRODUCT_PATHS.products, () =>
        HttpResponse.json({
          items: [product()],
          page: { number: 1, size: 100, total: 1, pages: 1 },
        } satisfies ProductListResponse),
      ),
      http.post(WARRANTY_PATHS.warranties, async ({ request }) => {
        sent = await request.json();
        created = true;
        return HttpResponse.json(row(18), { status: 201 });
      }),
    );

    const { user } = renderPage(<WarrantiesPage />, { path: '/warranties' });
    await screen.findByText(/nothing here yet/i);

    await user.selectOptions(await screen.findByLabelText(/^product$/i), 'product-1');
    await user.type(screen.getByLabelText(/^months$/i), '18');
    await user.click(screen.getByRole('button', { name: /add warranty/i }));

    await waitFor(() => expect(sent).toEqual({ productId: 'product-1', months: 18 }));
    expect(await screen.findByRole('cell', { name: 'Widget' })).toBeInTheDocument();
  });

  it('puts a server message beside the input it belongs to', async () => {
    listing(() => page([]));
    server.use(
      http.post(WARRANTY_PATHS.warranties, () =>
        HttpResponse.json(
          {
            code: 'validation_failed',
            message: 'Some of the details you entered need attention.',
            fields: { months: 'Enter a whole number of months, from 1 to 600.' },
          },
          { status: 422 },
        ),
      ),
    );

    const { user } = renderPage(<WarrantiesPage />, { path: '/warranties' });
    await screen.findByText(/nothing here yet/i);

    await user.selectOptions(await screen.findByLabelText(/^product$/i), 'product-1');
    await user.click(screen.getByRole('button', { name: /add warranty/i }));

    const months = await screen.findByLabelText(/^months$/i);
    expect(months).toHaveAttribute('aria-invalid', 'true');
    expect(months).toHaveAccessibleDescription(/whole number of months/i);
  });
});
