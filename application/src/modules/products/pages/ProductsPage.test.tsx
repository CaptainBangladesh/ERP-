import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import {
  ERROR_CODES,
  PARTY_PATHS,
  PRODUCT_PATHS,
  UNIT_PATHS,
  type ProductListResponse,
  type ProductResponse,
  type ProductSummary,
  type UnitListResponse,
  type UnitSummary,
} from '@erp/shared';
import { server } from '../../../test/server';
import { renderPage, signedInWith } from '../../../test/render';
import { ProductsPage } from './ProductsPage';

/**
 * The catalogue from the user's side.
 *
 * The screen writes no paging, sorting or filtering code — it holds a `ListQuery` and hands it
 * to the shared table — so what these assert about the list is the platform's behaviour as
 * somebody experiences it. Requests are intercepted at the network boundary and their query
 * strings captured, because "filtered to what is not stocked" is only true if the *server* was
 * asked to filter: a screen that hid rows it was already holding would pass a weaker test and
 * be wrong on page two.
 *
 * The empty state gets two tests rather than one, and they assert different things. A company
 * with no units cannot have a product at all, so the screen sends them to the units screen
 * instead of offering a form that can only fail; a company with units and no products gets the
 * form. Nothing in this system is seeded, so both are states real users pass through in order.
 */
describe('ProductsPage', () => {
  const PAGE_SIZE = 25;

  const kilogram: UnitSummary = {
    id: 'unit-kg',
    code: 'kg',
    name: 'Kilogram',
    status: 'active',
    groupId: null,
    groupName: null,
    ratio: '1',
  };

  /**
   * A row whose name is deliberately not its code.
   *
   * Two columns holding the same text would make `getByText('FLOUR')` ambiguous, and the
   * ambiguity would be the fixture's rather than the screen's — which is the sort of thing
   * that gets "fixed" by loosening the query until it stops asserting anything.
   */
  function product(code: string, overrides: Partial<ProductSummary> = {}): ProductSummary {
    return {
      id: `id-${code.toLowerCase()}`,
      code,
      name: code.charAt(0) + code.slice(1).toLowerCase(),
      status: 'active',
      stockable: true,
      unitId: kilogram.id,
      unitCode: kilogram.code,
      unitName: kilogram.name,
      cost: null,
      ...overrides,
    };
  }

  function detail(summary: ProductSummary, overrides: Partial<ProductResponse> = {}): ProductResponse {
    return { ...summary, suppliers: [], ...overrides };
  }

  function page(items: ProductSummary[], total = items.length): ProductListResponse {
    return {
      items,
      page: { number: 1, size: PAGE_SIZE, total, pages: Math.ceil(total / PAGE_SIZE) },
    };
  }

  function unitsAvailable(units: UnitSummary[] = [kilogram]): void {
    server.use(
      http.get(UNIT_PATHS.units, () =>
        HttpResponse.json({
          items: units,
          page: { number: 1, size: PAGE_SIZE, total: units.length, pages: 1 },
        } satisfies UnitListResponse),
      ),
    );
  }

  /** The list endpoint, recording every query string it was asked with. */
  function listing(respond: (parameters: URLSearchParams) => ProductListResponse): {
    asked: string[];
  } {
    const asked: string[] = [];

    server.use(
      http.get(PRODUCT_PATHS.products, ({ request }) => {
        const url = new URL(request.url);
        asked.push(url.search);
        return HttpResponse.json(respond(url.searchParams));
      }),
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

  describe('the list', () => {
    it('shows the code, the name, what it is measured in and what it costs', async () => {
      unitsAvailable();
      listing(() =>
        page([
          product('FLOUR', { name: 'Flour', cost: { amount: '1.25', currency: 'GBP' } }),
          product('CONSULT', {
            name: 'Consultancy',
            status: 'inactive',
            stockable: false,
            unitCode: 'hour',
          }),
        ]),
      );

      renderPage(<ProductsPage />, { path: '/products' });

      await screen.findByText('Flour');
      expect(renderedRows()).toEqual([
        ['FLOUR', 'Flour', 'kg', '£1.25', 'Active'],
        // A product with no shelf says so on the row, because "inactive" and "not stocked" are
        // different facts and a reader should not have to open it to tell them apart.
        // The dash is decorative and the words beside it are for a screen reader: an empty
        // cell would say "this costs nothing", which is a different claim from "nobody has
        // said what it costs".
        ['CONSULT', 'Consultancy', 'hour', '—No cost recorded', 'Inactive · not stocked'],
      ]);
    });

    it('asks the server to sort when a column heading is clicked', async () => {
      unitsAvailable();
      const { asked } = listing(() => page([product('FLOUR')]));

      const { user } = renderPage(<ProductsPage />, { path: '/products' });
      await screen.findByText('FLOUR');

      await user.click(screen.getByRole('button', { name: /^code$/i }));
      await waitFor(() => expect(asked.at(-1)).toContain('sort=code'));
    });

    it('filters to what is not stocked, under the platform’s filter convention', async () => {
      unitsAvailable();
      const { asked } = listing((parameters) =>
        parameters.get('filter.stockable') === 'false'
          ? page([product('CONSULT', { stockable: false })])
          : page([product('FLOUR'), product('CONSULT', { stockable: false })]),
      );

      const { user } = renderPage(<ProductsPage />, { path: '/products' });
      await screen.findByText('FLOUR');

      await user.selectOptions(screen.getByLabelText(/^stock$/i), 'false');

      await waitFor(() => expect(asked.at(-1)).toContain('filter.stockable=false'));
      expect(screen.queryByText('FLOUR')).not.toBeInTheDocument();
    });
  });

  describe('the states a fresh account passes through', () => {
    it('sends somebody with no units to the units screen rather than offering a broken form', async () => {
      signedInWith();
      unitsAvailable([]);
      listing(() => page([]));

      renderPage(<ProductsPage />, { token: 'a-token', path: '/products' });

      // A product cannot exist without a unit, and nothing is seeded, so this is the first
      // thing a real user sees. A form whose only outcome is a validation message is worse
      // than a sentence saying what to do first.
      expect(await screen.findByText(/before you can add a product/i)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /add product/i })).toBeNull();
      expect(screen.getByRole('link', { name: /units/i })).toHaveAttribute('href', '/units');
    });

    it('guides the first product once there is something to measure it in', async () => {
      signedInWith();
      unitsAvailable();
      listing(() => page([]));

      renderPage(<ProductsPage />, { token: 'a-token', path: '/products' });

      expect(await screen.findByText(/nothing in the catalogue yet/i)).toBeInTheDocument();
      // `findBy`, not `getBy`: the form is gated on a permission the session query resolves
      // separately from the (empty) product list, so the two need not settle in one tick.
      expect(await screen.findByRole('button', { name: /add product/i })).toBeInTheDocument();
    });

    it('tells somebody their search matched nothing rather than that they sell nothing', async () => {
      unitsAvailable();
      const { asked } = listing((parameters) =>
        parameters.get('search') ? page([]) : page([product('FLOUR')]),
      );

      const { user } = renderPage(<ProductsPage />, { path: '/products' });
      await screen.findByText('FLOUR');

      await user.type(screen.getByLabelText(/search by code or name/i), 'nothing');
      await user.click(screen.getByRole('button', { name: /^search$/i }));

      expect(await screen.findByText(/nothing matches/i)).toBeInTheDocument();
      expect(screen.queryByText(/nothing in the catalogue yet/i)).not.toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: /clear search and filters/i }));
      await waitFor(() => expect(asked.at(-1)).toBe(''));
    });

    it('shows the failure and offers a way to try again', async () => {
      unitsAvailable();
      let attempts = 0;
      server.use(
        http.get(PRODUCT_PATHS.products, () => {
          attempts += 1;
          // Once, because the screen asks for the catalogue once. Retrying is disabled in the
          // query client, so the second attempt is the one the user asked for by clicking.
          if (attempts <= 1) {
            return HttpResponse.json(
              { code: 'internal_error', message: 'Something went wrong. Please try again.' },
              { status: 500 },
            );
          }
          return HttpResponse.json(page([product('FLOUR')]));
        }),
      );

      const { user } = renderPage(<ProductsPage />, { path: '/products' });

      expect((await screen.findAllByRole('alert'))[0]).toHaveTextContent(/something went wrong/i);

      await user.click(screen.getByRole('button', { name: /try again/i }));
      expect(await screen.findByText('FLOUR')).toBeInTheDocument();
    });
  });

  describe('adding a product', () => {
    it('sends the code, the name, the unit and an exact cost', async () => {
      signedInWith();
      unitsAvailable();
      let sent: unknown;
      let created = false;
      const flour = product('FLOUR', { name: 'Flour' });

      server.use(
        http.get(PRODUCT_PATHS.products, () =>
          HttpResponse.json(created ? page([flour]) : page([])),
        ),
        http.get(PRODUCT_PATHS.product(flour.id), () => HttpResponse.json(detail(flour))),
        http.get(PARTY_PATHS.parties, () =>
          HttpResponse.json({ items: [], page: { number: 1, size: PAGE_SIZE, total: 0, pages: 0 } }),
        ),
        http.post(PRODUCT_PATHS.products, async ({ request }) => {
          sent = await request.json();
          created = true;
          return HttpResponse.json(detail(flour), { status: 201 });
        }),
      );

      const { user } = renderPage(<ProductsPage />, { token: 'a-token', path: '/products' });
      await screen.findByText(/nothing in the catalogue yet/i);

      await user.type(await screen.findByLabelText(/^code$/i), 'flour');
      await user.type(screen.getByLabelText(/^name$/i), 'Flour');
      await user.selectOptions(screen.getByLabelText(/^unit$/i), kilogram.id);
      await user.type(screen.getByLabelText(/^cost$/i), '1.25');

      await user.click(screen.getByRole('button', { name: /add product/i }));

      // The cost goes as decimal text, never a JSON number: a double cannot hold every value
      // the column can. The code goes as typed and the server upper-cases it — one
      // normalisation, on the side that owns the constraint.
      await waitFor(() =>
        expect(sent).toEqual({
          code: 'flour',
          name: 'Flour',
          unitId: kilogram.id,
          cost: '1.25',
        }),
      );
      expect(await screen.findByRole('cell', { name: 'FLOUR' })).toBeInTheDocument();
    });

    it('sends a product that is not stocked when the box is unticked', async () => {
      signedInWith();
      unitsAvailable();
      let sent: unknown;
      const consultancy = product('CONSULT', { stockable: false });

      server.use(
        http.get(PRODUCT_PATHS.products, () => HttpResponse.json(page([]))),
        http.get(PRODUCT_PATHS.product(consultancy.id), () =>
          HttpResponse.json(detail(consultancy)),
        ),
        http.get(PARTY_PATHS.parties, () =>
          HttpResponse.json({ items: [], page: { number: 1, size: PAGE_SIZE, total: 0, pages: 0 } }),
        ),
        http.post(PRODUCT_PATHS.products, async ({ request }) => {
          sent = await request.json();
          return HttpResponse.json(detail(consultancy), { status: 201 });
        }),
      );

      const { user } = renderPage(<ProductsPage />, { token: 'a-token', path: '/products' });
      await screen.findByText(/nothing in the catalogue yet/i);

      await user.type(await screen.findByLabelText(/^code$/i), 'CONSULT');
      await user.type(screen.getByLabelText(/^name$/i), 'Consultancy');
      await user.selectOptions(screen.getByLabelText(/^unit$/i), kilogram.id);
      await user.click(screen.getByLabelText(/stock of this is counted/i));

      await user.click(screen.getByRole('button', { name: /add product/i }));

      // An empty cost is left out rather than sent blank: "I have not priced this yet" is not
      // the same claim as "it costs nothing".
      await waitFor(() =>
        expect(sent).toEqual({
          code: 'CONSULT',
          name: 'Consultancy',
          unitId: kilogram.id,
          stockable: false,
        }),
      );
    });

    it('puts a server message beside the input it belongs to', async () => {
      signedInWith();
      unitsAvailable();
      server.use(
        http.get(PRODUCT_PATHS.products, () => HttpResponse.json(page([]))),
        http.post(PRODUCT_PATHS.products, () =>
          HttpResponse.json(
            {
              code: ERROR_CODES.validationFailed,
              message: 'Some of the details you entered need attention.',
              fields: { code: 'Use letters, numbers, and . _ - / — such as “WIDGET-1”.' },
            },
            { status: 422 },
          ),
        ),
      );

      const { user } = renderPage(<ProductsPage />, { token: 'a-token', path: '/products' });
      await screen.findByText(/nothing in the catalogue yet/i);

      await user.type(await screen.findByLabelText(/^code$/i), 'a widget');
      await user.click(screen.getByRole('button', { name: /add product/i }));

      const code = await screen.findByLabelText(/^code$/i);
      expect(code).toHaveAttribute('aria-invalid', 'true');
      expect(code).toHaveAccessibleDescription(/WIDGET-1/i);
    });

    it('shows a duplicate code as a message rather than a silent failure', async () => {
      signedInWith();
      unitsAvailable();
      server.use(
        http.get(PRODUCT_PATHS.products, () => HttpResponse.json(page([]))),
        http.post(PRODUCT_PATHS.products, () =>
          HttpResponse.json(
            {
              code: 'duplicate_product_code',
              message: "'FLOUR' is already the code of another product.",
              fields: { code: "'FLOUR' is already the code of another product." },
            },
            { status: 409 },
          ),
        ),
      );

      const { user } = renderPage(<ProductsPage />, { token: 'a-token', path: '/products' });
      await screen.findByText(/nothing in the catalogue yet/i);

      await user.type(await screen.findByLabelText(/^code$/i), 'FLOUR');
      await user.click(screen.getByRole('button', { name: /add product/i }));

      // A conflict is not a validation failure, so it arrives with a code of its own — and
      // still carries the field, because the message belongs beside the box that caused it.
      expect(await screen.findByRole('alert')).toHaveTextContent(/already the code/i);
    });

    it('hides the form from a colleague without products:products:write', async () => {
      signedInWith([]);
      unitsAvailable();
      listing(() => page([product('FLOUR')]));

      renderPage(<ProductsPage />, { token: 'a-token', path: '/products' });
      await screen.findByText('FLOUR');

      expect(screen.queryByRole('button', { name: /add product/i })).not.toBeInTheDocument();
    });
  });

  describe('one product, and what can be done to it', () => {
    const flour = product('FLOUR', { name: 'Flour', cost: { amount: '1.25', currency: 'GBP' } });
    const bakers = { id: 'party-bakers', name: 'Bakers Ltd' };

    /** A server that remembers, so the panel renders what happened rather than what it sent. */
    function openable(): { sent: unknown[]; suppliers: Array<{ partyId: string; name: string; email: string | null }> } {
      const sent: unknown[] = [];
      const suppliers: Array<{ partyId: string; name: string; email: string | null }> = [];
      let status: ProductSummary['status'] = 'active';
      const current = () => detail({ ...flour, status }, { suppliers: [...suppliers] });

      server.use(
        http.get(PRODUCT_PATHS.products, () => HttpResponse.json(page([{ ...flour, status }]))),
        http.get(PRODUCT_PATHS.product(flour.id), () => HttpResponse.json(current())),
        http.get(PARTY_PATHS.parties, () =>
          HttpResponse.json({
            items: [{ id: bakers.id, name: bakers.name }],
            page: { number: 1, size: PAGE_SIZE, total: 1, pages: 1 },
          }),
        ),
        http.patch(PRODUCT_PATHS.product(flour.id), async ({ request }) => {
          const body = (await request.json()) as { status?: ProductSummary['status'] };
          sent.push(body);
          if (body.status) status = body.status;
          return HttpResponse.json(current());
        }),
        http.post(PRODUCT_PATHS.suppliers(flour.id), async ({ request }) => {
          sent.push(await request.json());
          suppliers.push({ partyId: bakers.id, name: bakers.name, email: null });
          return HttpResponse.json(current());
        }),
        http.delete(PRODUCT_PATHS.supplier(flour.id, bakers.id), () => {
          suppliers.length = 0;
          return HttpResponse.json(current());
        }),
      );

      return { sent, suppliers };
    }

    it('corrects the details somebody typed wrong, without a second product', async () => {
      unitsAvailable();
      const { sent } = openable();

      const { user } = renderPage(<ProductsPage />, { path: '/products' });
      await user.click(await screen.findByRole('button', { name: 'FLOUR' }));

      await user.click(await screen.findByRole('button', { name: /edit details/i }));

      // Scoped to the panel's form: the "add a product" form on the same screen has a Code and
      // a Name too, which is right — they are the same fields asked at a different moment.
      const details = within(screen.getByRole('form', { name: /^details$/i }));
      await user.clear(details.getByLabelText(/^name$/i));
      await user.type(details.getByLabelText(/^name$/i), 'Flour, plain');
      await user.click(details.getByRole('button', { name: /save details/i }));

      // Nothing is ever deleted here, so a mistyped SKU has to be correctable in place —
      // otherwise the only remedy is a second product and a deactivation, for a missing letter.
      await waitFor(() =>
        expect(sent.at(-1)).toEqual({
          code: 'FLOUR',
          name: 'Flour, plain',
          unitId: kilogram.id,
          stockable: true,
          cost: '1.25',
        }),
      );
    });

    it('deactivates rather than deleting, and says so', async () => {
      unitsAvailable();
      const { sent } = openable();

      const { user } = renderPage(<ProductsPage />, { path: '/products' });
      await user.click(await screen.findByRole('button', { name: 'FLOUR' }));

      await user.click(await screen.findByRole('button', { name: /deactivate/i }));

      await waitFor(() => expect(sent.at(-1)).toEqual({ status: 'inactive' }));
      // There is no delete control anywhere, which is the point rather than an omission.
      expect(screen.queryByRole('button', { name: /^delete/i })).toBeNull();
      expect(await screen.findByRole('button', { name: /reactivate/i })).toBeInTheDocument();
    });

    it('records a supplier from the address book, and takes them off again', async () => {
      unitsAvailable();
      const { sent } = openable();

      const { user } = renderPage(<ProductsPage />, { path: '/products' });
      await user.click(await screen.findByRole('button', { name: 'FLOUR' }));

      await user.selectOptions(await screen.findByLabelText(/add a supplier/i), bakers.id);
      await user.click(screen.getByRole('button', { name: /add supplier/i }));

      await waitFor(() => expect(sent.at(-1)).toEqual({ partyId: bakers.id }));
      // The name is the address book's answer rather than a copy this screen took, which is
      // what stops the catalogue and the address book disagreeing about who anybody is.
      expect(await screen.findByText('Bakers Ltd')).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: /remove supplier bakers ltd/i }));
      expect(await screen.findByText(/nobody recorded yet/i)).toBeInTheDocument();
    });
  });
});
