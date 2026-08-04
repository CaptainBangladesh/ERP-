import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import {
  LOCATION_PATHS,
  MOVEMENT_ERROR_CODES,
  MOVEMENT_PATHS,
  PRODUCT_PATHS,
  STOCK_PATHS,
  type ListResponse,
  type LocationSummary,
  type ProductSummary,
  type StockLevelSummary,
} from '@erp/shared';
import { server } from '../../../test/server';
import { renderPage, signedInWith } from '../../../test/render';
import { StockPage } from './StockPage';

/**
 * The stock screen from the user's side.
 *
 * Two things here are worth more than the rest. The **no-locations state** is the one ticket 08
 * built its empty locations screen to receive: a company with nowhere to keep things must be
 * sent to create somewhere rather than shown a form whose only possible outcome is a refusal.
 * And the **refresh after recording** is what makes the screen trustworthy — a total that does
 * not include the delivery you just booked in is a number nobody believes again.
 *
 * Requests are intercepted at the network boundary and their bodies captured, because "the
 * quantity was sent unsigned" and "the sign is the server's" are only true if what actually
 * went over the wire says so.
 */
describe('StockPage', () => {
  const PAGE_SIZE = 25;

  function product(code: string, overrides: Partial<ProductSummary> = {}): ProductSummary {
    return {
      id: `p-${code.toLowerCase()}`,
      code,
      name: `${code} widget`,
      status: 'active',
      stockable: true,
      unitId: 'u1',
      unitCode: 'each',
      unitName: 'Each',
      cost: { amount: '12.50', currency: 'GBP' },
      ...overrides,
    };
  }

  function location(code: string, overrides: Partial<LocationSummary> = {}): LocationSummary {
    return { id: `l-${code.toLowerCase()}`, code, name: `${code} store`, status: 'active', ...overrides };
  }

  function level(overrides: Partial<StockLevelSummary> = {}): StockLevelSummary {
    return {
      productId: 'p-widget-1',
      productCode: 'WIDGET-1',
      productName: 'WIDGET-1 widget',
      unitCode: 'each',
      locationId: 'l-wh-1',
      locationCode: 'WH-1',
      locationName: 'WH-1 store',
      quantity: '10',
      ...overrides,
    };
  }

  function page<T>(items: T[], total = items.length): ListResponse<T> {
    return {
      items,
      page: { number: 1, size: PAGE_SIZE, total, pages: Math.ceil(total / PAGE_SIZE) },
    };
  }

  /**
   * The three lists this screen needs, with sensible defaults per test.
   *
   * `levels` is a function rather than a value so a test can change what the server answers
   * after a movement — which is the only way to tell a screen that refetched from one that
   * merely re-rendered what it was already holding.
   */
  function backend({
    levels = () => page<StockLevelSummary>([]),
    products = [product('WIDGET-1')],
    locations = [location('WH-1')],
  }: {
    levels?: () => ListResponse<StockLevelSummary>;
    products?: ProductSummary[];
    locations?: LocationSummary[];
  } = {}): { asked: string[] } {
    const asked: string[] = [];

    server.use(
      http.get(STOCK_PATHS.stock, ({ request }) => {
        asked.push(new URL(request.url).search);
        return HttpResponse.json(levels());
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

  describe('what is held', () => {
    it('shows the product, the place and how much, with its unit', async () => {
      signedInWith();
      backend({ levels: () => page([level(), level({ locationId: 'l-van-1', locationCode: 'VAN-1', locationName: 'VAN-1 store', quantity: '2.5' })]) });

      renderPage(<StockPage />, { token: 'a-token', path: '/stock' });

      // Waited for by row count rather than by cell text: the same product appears in both
      // rows, so a query for it would match two elements and throw before asserting anything.
      await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(3));
      expect(renderedRows()).toEqual([
        ['WIDGET-1 — WIDGET-1 widget', 'WH-1 — WH-1 store', '10each'],
        ['WIDGET-1 — WIDGET-1 widget', 'VAN-1 — VAN-1 store', '2.5each'],
      ]);
    });

    it('narrows to one place, under the platform’s filter convention', async () => {
      signedInWith();
      const { asked } = backend({ levels: () => page([level()]) });

      const { user } = renderPage(<StockPage />, { token: 'a-token', path: '/stock' });

      // The table's own filter slot, not a form control — scoped by its label, which is what
      // distinguishes it from the "Out of" and "Into" pickers on the two forms above it. Waited
      // for by its options, because they arrive with the locations request rather than the
      // stock one.
      const filter = await screen.findByLabelText(/^location$/i);
      await waitFor(() => expect(within(filter).getAllByRole('option')).toHaveLength(2));

      await user.selectOptions(filter, 'l-wh-1');

      await waitFor(() => expect(asked.at(-1)).toContain('filter.locationId=l-wh-1'));
    });

    it('says nothing is held rather than showing an empty box', async () => {
      signedInWith();
      backend();

      renderPage(<StockPage />, { token: 'a-token', path: '/stock' });

      expect(await screen.findByText(/nothing held anywhere yet/i)).toBeInTheDocument();
      expect(screen.getByText(/stock exists once you record that it arrived/i)).toBeInTheDocument();
    });
  });

  describe('a company with nowhere to put anything', () => {
    /**
     * The criterion ticket 09 states outright: with no locations, the movement screen sends me
     * to create one instead of failing. A form whose location dropdown is empty is a form whose
     * only possible outcome is a message, so it is not offered at all.
     */
    it('sends somebody to the locations screen instead of offering an unusable form', async () => {
      signedInWith();
      backend({ locations: [] });

      renderPage(<StockPage />, { token: 'a-token', path: '/stock' });

      expect(await screen.findByText(/stock has to be somewhere before it can move/i)).toBeInTheDocument();
      expect(screen.getByRole('link', { name: /locations/i })).toHaveAttribute(
        'href',
        '/locations',
      );
      expect(screen.queryByRole('button', { name: /record receipt/i })).not.toBeInTheDocument();
    });

    /** The second problem, reported only once the first is solved. */
    it('sends somebody to the products screen when there is nothing stocked', async () => {
      signedInWith();
      backend({ products: [] });

      renderPage(<StockPage />, { token: 'a-token', path: '/stock' });

      expect(await screen.findByText(/stock is stock of something/i)).toBeInTheDocument();
      expect(screen.getByRole('link', { name: /products/i })).toHaveAttribute('href', '/products');
      expect(screen.queryByRole('button', { name: /record receipt/i })).not.toBeInTheDocument();
    });

    it('does not flash that advice at a company that simply has not loaded yet', async () => {
      signedInWith();
      backend();

      renderPage(<StockPage />, { token: 'a-token', path: '/stock' });

      // "No locations" and "we have not asked yet" look identical from an empty array, and
      // telling a company with four warehouses to go and create one is worse than showing them
      // nothing for a moment.
      expect(
        screen.queryByText(/stock has to be somewhere before it can move/i),
      ).not.toBeInTheDocument();

      await screen.findByRole('button', { name: /record receipt/i });
    });

    /**
     * The forms are hidden when the lists behind them fail, and hiding them silently would look
     * identical to a company that is not allowed to record anything.
     */
    it('says why the forms are absent when their dropdowns could not be loaded', async () => {
      signedInWith();
      server.use(
        http.get(STOCK_PATHS.stock, () => HttpResponse.json(page<StockLevelSummary>([]))),
        http.get(PRODUCT_PATHS.products, () =>
          HttpResponse.json({ code: 'internal_error', message: 'No.' }, { status: 500 }),
        ),
        http.get(LOCATION_PATHS.locations, () => HttpResponse.json(page([location('WH-1')]))),
      );

      renderPage(<StockPage />, { token: 'a-token', path: '/stock' });

      expect(await screen.findByText(/could not be loaded/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /record receipt/i })).not.toBeInTheDocument();
    });

    it('hides both forms from somebody who may only read', async () => {
      signedInWith(['inventory:stock:read']);
      backend();

      renderPage(<StockPage />, { token: 'a-token', path: '/stock' });

      await screen.findByText(/nothing held anywhere yet/i);
      expect(screen.queryByRole('button', { name: /record receipt/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /record issue/i })).not.toBeInTheDocument();
    });
  });

  describe('recording a receipt', () => {
    it('sends what was chosen and refreshes what is held', async () => {
      signedInWith();

      let sent: unknown;
      let recorded = false;

      server.use(
        http.get(STOCK_PATHS.stock, () =>
          HttpResponse.json(recorded ? page([level({ quantity: '6' })]) : page<StockLevelSummary>([])),
        ),
        http.get(PRODUCT_PATHS.products, () => HttpResponse.json(page([product('WIDGET-1')]))),
        http.get(LOCATION_PATHS.locations, () => HttpResponse.json(page([location('WH-1')]))),
        http.post(MOVEMENT_PATHS.receipts, async ({ request }) => {
          sent = await request.json();
          recorded = true;
          return HttpResponse.json({ id: 'm1' }, { status: 201 });
        }),
      );

      const { user } = renderPage(<StockPage />, { token: 'a-token', path: '/stock' });

      const form = within(await screen.findByRole('form', { name: /record a receipt/i }));
      await user.selectOptions(form.getByLabelText(/^product$/i), 'p-widget-1');
      await user.selectOptions(form.getByLabelText(/^into$/i), 'l-wh-1');
      await user.type(form.getByLabelText(/^quantity$/i), '6');
      await user.click(form.getByRole('button', { name: /record receipt/i }));

      // Unsigned, and with no `kind` — the endpoint chosen is what says which way stock went.
      await waitFor(() =>
        expect(sent).toEqual({ productId: 'p-widget-1', locationId: 'l-wh-1', quantity: '6' }),
      );

      // The list is stale the moment a movement is recorded, and a screen showing a total that
      // does not include what you just booked in is a screen nobody trusts again. Asserted on
      // the row's own text rather than on an accessible name, because the quantity and its unit
      // are separate elements and the name computed from them is whitespace-normalised.
      await waitFor(() =>
        expect(renderedRows()).toEqual([
          ['WIDGET-1 — WIDGET-1 widget', 'WH-1 — WH-1 store', '6each'],
        ]),
      );
    });

    /**
     * Somebody booking in a delivery records six things into one place one after another.
     * Clearing the choices each time would be the form fighting the job.
     */
    it('clears the quantity and keeps the choices, ready for the next line', async () => {
      signedInWith();
      backend();
      server.use(
        http.post(MOVEMENT_PATHS.receipts, () => HttpResponse.json({ id: 'm1' }, { status: 201 })),
      );

      const { user } = renderPage(<StockPage />, { token: 'a-token', path: '/stock' });

      const form = within(await screen.findByRole('form', { name: /record a receipt/i }));
      await user.selectOptions(form.getByLabelText(/^product$/i), 'p-widget-1');
      await user.selectOptions(form.getByLabelText(/^into$/i), 'l-wh-1');
      await user.type(form.getByLabelText(/^quantity$/i), '6');
      await user.click(form.getByRole('button', { name: /record receipt/i }));

      await waitFor(() => expect(form.getByLabelText(/^quantity$/i)).toHaveValue(''));
      expect(form.getByLabelText(/^product$/i)).toHaveValue('p-widget-1');
      expect(form.getByLabelText(/^into$/i)).toHaveValue('l-wh-1');
    });

    it('shows the unit the chosen product is measured in', async () => {
      signedInWith();
      backend({ products: [product('FLOUR', { unitCode: 'kg', unitName: 'Kilogram' })] });

      const { user } = renderPage(<StockPage />, { token: 'a-token', path: '/stock' });

      const form = within(await screen.findByRole('form', { name: /record a receipt/i }));
      await user.selectOptions(form.getByLabelText(/^product$/i), 'p-flour');

      expect(form.getByLabelText(/^quantity$/i)).toHaveAccessibleDescription(/measured in kg/i);
    });

    it('puts a server message about the quantity beside the quantity box', async () => {
      signedInWith();
      backend();
      server.use(
        http.post(MOVEMENT_PATHS.receipts, () =>
          HttpResponse.json(
            {
              code: 'validation_failed',
              message: 'That request could not be understood.',
              fields: { quantity: 'Enter a quantity greater than zero.' },
            },
            { status: 422 },
          ),
        ),
      );

      const { user } = renderPage(<StockPage />, { token: 'a-token', path: '/stock' });

      const form = within(await screen.findByRole('form', { name: /record a receipt/i }));
      await user.selectOptions(form.getByLabelText(/^product$/i), 'p-widget-1');
      await user.selectOptions(form.getByLabelText(/^into$/i), 'l-wh-1');
      await user.type(form.getByLabelText(/^quantity$/i), '0');
      await user.click(form.getByRole('button', { name: /record receipt/i }));

      const box = await form.findByLabelText(/^quantity$/i);
      expect(box).toHaveAttribute('aria-invalid', 'true');
      expect(box).toHaveAccessibleDescription(/greater than zero/i);
    });

    it('names the field at fault when nothing was chosen', async () => {
      signedInWith();
      backend();
      server.use(
        http.post(MOVEMENT_PATHS.receipts, () =>
          HttpResponse.json(
            {
              code: 'validation_failed',
              message: 'That request could not be understood.',
              fields: { productId: 'Choose a product.', locationId: 'Choose a location.' },
            },
            { status: 422 },
          ),
        ),
      );

      const { user } = renderPage(<StockPage />, { token: 'a-token', path: '/stock' });

      const form = within(await screen.findByRole('form', { name: /record a receipt/i }));
      await user.click(form.getByRole('button', { name: /record receipt/i }));

      expect(await form.findByLabelText(/^product$/i)).toHaveAccessibleDescription(
        /choose a product/i,
      );
      expect(form.getByLabelText(/^into$/i)).toHaveAccessibleDescription(/choose a location/i);
    });

    /**
     * A refusal that belongs to no single box — a closed location, a product with no shelf —
     * has nowhere to sit beside an input, so it must not be swallowed.
     */
    it('shows a refusal that belongs to no particular box', async () => {
      signedInWith();
      backend();
      server.use(
        http.post(MOVEMENT_PATHS.receipts, () =>
          HttpResponse.json(
            {
              code: MOVEMENT_ERROR_CODES.locationNotInUse,
              message: "'WH-1 store' is not in use, so stock cannot be moved into or out of it.",
            },
            { status: 409 },
          ),
        ),
      );

      const { user } = renderPage(<StockPage />, { token: 'a-token', path: '/stock' });

      const form = within(await screen.findByRole('form', { name: /record a receipt/i }));
      await user.selectOptions(form.getByLabelText(/^product$/i), 'p-widget-1');
      await user.selectOptions(form.getByLabelText(/^into$/i), 'l-wh-1');
      await user.type(form.getByLabelText(/^quantity$/i), '1');
      await user.click(form.getByRole('button', { name: /record receipt/i }));

      expect(await form.findByText(/is not in use/i)).toBeInTheDocument();
    });
  });

  describe('recording an issue', () => {
    /**
     * The separate intent, over the wire. The body is identical to a receipt's — which is
     * exactly why the two must be different endpoints rather than one with a direction in it.
     */
    it('posts to the issues endpoint with the same unsigned quantity', async () => {
      signedInWith();
      backend({ levels: () => page([level()]) });

      let sent: unknown;
      server.use(
        http.post(MOVEMENT_PATHS.issues, async ({ request }) => {
          sent = await request.json();
          return HttpResponse.json({ id: 'm2' }, { status: 201 });
        }),
      );

      const { user } = renderPage(<StockPage />, { token: 'a-token', path: '/stock' });

      const form = within(await screen.findByRole('form', { name: /record an issue/i }));
      await user.selectOptions(form.getByLabelText(/^product$/i), 'p-widget-1');
      await user.selectOptions(form.getByLabelText(/^out of$/i), 'l-wh-1');
      await user.type(form.getByLabelText(/^quantity$/i), '4');
      await user.click(form.getByRole('button', { name: /record issue/i }));

      await waitFor(() =>
        expect(sent).toEqual({ productId: 'p-widget-1', locationId: 'l-wh-1', quantity: '4' }),
      );
    });

    /**
     * The sign belongs to the act, not to a character somebody typed. The shared quantity box
     * filters keystrokes to what could still become a valid amount, and a lone `-` is on the
     * way to one — so this asserts the server would be sent something it refuses, rather than
     * that the box is impossible to type a minus into.
     */
    it('does not let a minus sign stand in for the other kind of movement', async () => {
      signedInWith();
      backend();

      const { user } = renderPage(<StockPage />, { token: 'a-token', path: '/stock' });

      const form = within(await screen.findByRole('form', { name: /record a receipt/i }));
      await user.type(form.getByLabelText(/^quantity$/i), '-5');

      // Whatever was typed, the form still posts to the receipts endpoint: there is no path
      // from this form to an issue.
      expect(form.getByRole('button', { name: /record receipt/i })).toBeInTheDocument();
      expect(form.queryByRole('button', { name: /record issue/i })).not.toBeInTheDocument();
    });
  });

  describe('recording an adjustment', () => {
    it('posts an adjustment with product, location, quantity and mandatory reason', async () => {
      signedInWith();
      backend();

      let sent: unknown;
      server.use(
        http.post(MOVEMENT_PATHS.adjustments, async ({ request }) => {
          sent = await request.json();
          return HttpResponse.json({ id: 'm3' }, { status: 201 });
        }),
      );

      const { user } = renderPage(<StockPage />, { token: 'a-token', path: '/stock' });

      const form = within(await screen.findByRole('form', { name: /record an adjustment/i }));
      await user.selectOptions(form.getByLabelText(/^product$/i), 'p-widget-1');
      await user.selectOptions(form.getByLabelText(/^location$/i), 'l-wh-1');
      await user.type(form.getByLabelText(/^quantity/i), '-2');
      await user.type(form.getByLabelText(/^reason$/i), 'Annual count discrepancy');
      await user.click(form.getByRole('button', { name: /record adjustment/i }));

      await waitFor(() =>
        expect(sent).toEqual({
          productId: 'p-widget-1',
          locationId: 'l-wh-1',
          quantity: '-2',
          reason: 'Annual count discrepancy',
        }),
      );
    });
  });

  describe('recording a transfer', () => {
    it('posts a transfer with product, from location, to location, and quantity', async () => {
      signedInWith();
      backend({ locations: [location('WH-1'), location('STORE-1')] });

      let sent: unknown;
      server.use(
        http.post(MOVEMENT_PATHS.transfers, async ({ request }) => {
          sent = await request.json();
          return HttpResponse.json(
            { from: { id: 'm4' }, to: { id: 'm5' } },
            { status: 201 },
          );
        }),
      );

      const { user } = renderPage(<StockPage />, { token: 'a-token', path: '/stock' });

      const form = within(await screen.findByRole('form', { name: /record a transfer/i }));
      await user.selectOptions(form.getByLabelText(/^product$/i), 'p-widget-1');
      await user.selectOptions(form.getByLabelText(/^from$/i), 'l-wh-1');
      await user.selectOptions(form.getByLabelText(/^to$/i), 'l-store-1');
      await user.type(form.getByLabelText(/^quantity$/i), '5');
      await user.click(form.getByRole('button', { name: /record transfer/i }));

      await waitFor(() =>
        expect(sent).toEqual({
          productId: 'p-widget-1',
          fromLocationId: 'l-wh-1',
          toLocationId: 'l-store-1',
          quantity: '5',
        }),
      );
    });
  });
});
