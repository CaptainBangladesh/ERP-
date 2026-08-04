import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import {
  LOCATION_PATHS,
  MOVEMENT_PATHS,
  PRODUCT_PATHS,
  type ListResponse,
  type LocationSummary,
  type MovementSummary,
  type ProductSummary,
} from '@erp/shared';
import { server } from '../../../test/server';
import { renderPage, signedInWith } from '../../../test/render';
import { MovementsPage } from './MovementsPage';

/**
 * The ledger from the user's side.
 *
 * What this file mostly asserts is that the screen *asks the server* for what it shows. A
 * history screen that sorted or filtered rows it was already holding would pass a weaker test
 * and be wrong on page two — and being wrong on page two of an audit trail is worse than being
 * wrong on page two of a product list.
 *
 * The absence of an edit control gets a test of its own. It is the module's central claim, and
 * "we did not build one" is not something that stays true by itself.
 */
describe('MovementsPage', () => {
  const PAGE_SIZE = 25;

  function movement(overrides: Partial<MovementSummary> = {}): MovementSummary {
    return {
      id: 'm1',
      kind: 'receipt',
      classification: 'stock-in',
      productId: 'p1',
      productCode: 'WIDGET-1',
      productName: 'Widget',
      unitCode: 'each',
      locationId: 'l1',
      locationCode: 'WH-1',
      locationName: 'Main warehouse',
      quantity: '10',
      unitCost: { amount: '12.50', currency: 'GBP' },
      value: { amount: '125.00', currency: 'GBP' },
      reason: null,
      transferId: null,
      reversedMovementId: null,
      recordedById: 'u1',
      recordedByName: 'Ada Okafor',
      recordedAt: '2026-08-03T09:30:00.000Z',
      ...overrides,
    };
  }

  function page<T>(items: T[], total = items.length): ListResponse<T> {
    return {
      items,
      page: { number: 1, size: PAGE_SIZE, total, pages: Math.ceil(total / PAGE_SIZE) },
    };
  }

  function backend(
    items: MovementSummary[] = [movement()],
    {
      products = [
        {
          id: 'p1',
          code: 'WIDGET-1',
          name: 'Widget',
          status: 'active',
          stockable: true,
          unitId: 'u1',
          unitCode: 'each',
          unitName: 'Each',
          cost: null,
        } satisfies ProductSummary,
      ],
      locations = [
        { id: 'l1', code: 'WH-1', name: 'Main warehouse', status: 'active' } satisfies LocationSummary,
      ],
    } = {},
  ): { asked: string[] } {
    const asked: string[] = [];

    server.use(
      http.get(MOVEMENT_PATHS.movements, ({ request }) => {
        asked.push(new URL(request.url).search);
        return HttpResponse.json(page(items));
      }),
      http.get(PRODUCT_PATHS.products, () => HttpResponse.json(page(products))),
      http.get(LOCATION_PATHS.locations, () => HttpResponse.json(page(locations))),
    );

    return { asked };
  }

  function renderedRows(): string[][] {
    const [, ...rows] = screen.getAllByRole('row');
    return rows.map((row) =>
      within(row)
        .getAllByRole('cell')
        .map((cell) => cell.textContent ?? ''),
    );
  }

  describe('reading history', () => {
    it('shows what moved, where, how much, what it was worth and who did it', async () => {
      signedInWith();
      backend();

      renderPage(<MovementsPage />, { token: 'a-token', path: '/movements' });

      await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(2));
      const [row] = renderedRows();

      expect(row).toEqual([
        expect.stringMatching(/\d/),
        'Received',
        'WIDGET-1 — Widget',
        'WH-1 — Main warehouse',
        '10each',
        '£125.00',
        '—',
        'Ada Okafor',
        'Reverse',
      ]);
    });

    it('reverses a movement when the reverse button is clicked', async () => {
      signedInWith();
      let reversedId: string | undefined;

      server.use(
        http.get(MOVEMENT_PATHS.movements, () =>
          HttpResponse.json(page([movement({ id: 'm1', kind: 'receipt' })])),
        ),
        http.post('*/movements/:id/reverse', async ({ params }) => {
          reversedId = params.id as string;
          return HttpResponse.json(
            movement({
              id: 'm2',
              kind: 'reversal',
              classification: 'stock-out',
              quantity: '-10',
              reversedMovementId: 'm1',
            }),
            { status: 201 },
          );
        }),
      );

      const { user } = renderPage(<MovementsPage />, { token: 'a-token', path: '/movements' });

      await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(2));
      const btn = screen.getByRole('button', { name: /reverse/i });
      await user.click(btn);

      await waitFor(() => expect(reversedId).toBe('m1'));
    });

    it('shows adjustment reason and transfer linkage in history', async () => {
      signedInWith();
      backend([
        movement({
          id: 'm1',
          kind: 'adjustment',
          classification: 'stock-in',
          quantity: '5',
          reason: 'Stock count discrepancy',
        }),
        movement({
          id: 'm2',
          kind: 'transfer',
          classification: 'transfer',
          quantity: '-5',
          transferId: '12345678-aaaa-bbbb-cccc-ddddeeeeffff',
        }),
      ]);

      renderPage(<MovementsPage />, { token: 'a-token', path: '/movements' });

      await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(3));
      const [adjRow, xferRow] = renderedRows();

      expect(adjRow).toContain('Stock count discrepancy');
      expect(xferRow).toContain('Transfer (12345678)');
    });

    it('shows an issue as a negative quantity, which is how the ledger records it', async () => {
      signedInWith();
      backend([
        movement({
          id: 'm2',
          kind: 'issue',
          classification: 'stock-out',
          quantity: '-4',
          value: { amount: '-50.00', currency: 'GBP' },
        }),
      ]);

      renderPage(<MovementsPage />, { token: 'a-token', path: '/movements' });

      await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(2));
      const [row] = renderedRows();

      expect(row?.[1]).toBe('Issued');
      expect(row?.[4]).toBe('-4each');
      expect(row?.[5]).toBe('-£50.00');
    });

    /**
     * Null is "nobody has said what this costs", and an empty cell would read as "it is worth
     * nothing" — the distinction ticket 13's valuation depends on being able to make.
     */
    it('says a movement has no recorded cost rather than showing nothing', async () => {
      signedInWith();
      backend([movement({ unitCost: null, value: null })]);

      renderPage(<MovementsPage />, { token: 'a-token', path: '/movements' });

      await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(2));
      expect(screen.getByText('No cost recorded')).toBeInTheDocument();
    });

    it('shows the moment as a machine-readable time as well as a readable one', async () => {
      signedInWith();
      backend();

      renderPage(<MovementsPage />, { token: 'a-token', path: '/movements' });

      await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(2));

      // Found by the element itself rather than by a cell whose name contains a digit — the
      // quantity and the value cells contain digits too.
      const [moment] = document.querySelectorAll('time');
      expect(moment).toHaveAttribute('datetime', '2026-08-03T09:30:00.000Z');
    });

    it('says nothing has moved rather than showing an empty box', async () => {
      signedInWith();
      backend([]);

      renderPage(<MovementsPage />, { token: 'a-token', path: '/movements' });

      const empty = await screen.findByText(/nothing has moved yet/i);

      // Scoped to the empty state, because the page's own intro paragraph links to Stock too —
      // and a query matching either would be a test that passed on the wrong one.
      const guidance = within(empty.parentElement as HTMLElement);
      expect(guidance.getByRole('link', { name: /^stock$/i })).toHaveAttribute('href', '/stock');
    });
  });

  describe('narrowing it down', () => {
    it('asks the server to filter by type', async () => {
      signedInWith();
      const { asked } = backend();

      const { user } = renderPage(<MovementsPage />, { token: 'a-token', path: '/movements' });
      await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(2));

      await user.selectOptions(screen.getByLabelText(/^type$/i), 'issue');

      await waitFor(() => expect(asked.at(-1)).toContain('filter.kind=issue'));
    });

    it('asks the server to filter by product', async () => {
      signedInWith();
      const { asked } = backend();

      const { user } = renderPage(<MovementsPage />, { token: 'a-token', path: '/movements' });

      const filter = await screen.findByLabelText(/^product$/i);
      await waitFor(() => expect(within(filter).getAllByRole('option')).toHaveLength(2));
      await user.selectOptions(filter, 'p1');

      await waitFor(() => expect(asked.at(-1)).toContain('filter.productId=p1'));
    });

    it('asks the server to filter by location', async () => {
      signedInWith();
      const { asked } = backend();

      const { user } = renderPage(<MovementsPage />, { token: 'a-token', path: '/movements' });

      const filter = await screen.findByLabelText(/^location$/i);
      await waitFor(() => expect(within(filter).getAllByRole('option')).toHaveLength(2));
      await user.selectOptions(filter, 'l1');

      await waitFor(() => expect(asked.at(-1)).toContain('filter.locationId=l1'));
    });

    /**
     * A date, sent under the platform's own filter convention — the operator is part of the
     * parameter name, and a bare `YYYY-MM-DD` is what the list platform reads as UTC midnight.
     */
    it('asks the server for everything since a date', async () => {
      signedInWith();
      const { asked } = backend();

      const { user } = renderPage(<MovementsPage />, { token: 'a-token', path: '/movements' });
      await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(2));

      await user.type(screen.getByLabelText(/^since$/i), '2026-08-01');

      await waitFor(() =>
        expect(asked.at(-1)).toContain('filter.recordedAt.gte=2026-08-01'),
      );
    });

    it('asks the server to sort, rather than reordering the page it is holding', async () => {
      signedInWith();
      const { asked } = backend();

      const { user } = renderPage(<MovementsPage />, { token: 'a-token', path: '/movements' });
      await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(2));

      await user.click(screen.getByRole('button', { name: /^when$/i }));

      await waitFor(() => expect(asked.at(-1)).toContain('sort=recordedAt'));
    });
  });

  describe('history is permanent', () => {
    /**
     * The module's central claim, asserted as an absence.
     *
     * "We did not build an edit button" is not something that stays true by itself, and this is
     * the cheapest place to notice somebody adding one. The backend refuses the write in two
     * independent ways regardless — there is no route, and the table is declared immutable — so
     * this is about the screen not implying otherwise.
     */
    it('offers no way to change or remove a movement', async () => {
      signedInWith();
      backend();

      renderPage(<MovementsPage />, { token: 'a-token', path: '/movements' });
      await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(2));

      for (const forbidden of [/edit/i, /delete/i, /remove/i, /change/i]) {
        expect(screen.queryByRole('button', { name: forbidden })).not.toBeInTheDocument();
      }

      expect(screen.getByText(/nothing here can be edited or removed/i)).toBeInTheDocument();
    });
  });
});
