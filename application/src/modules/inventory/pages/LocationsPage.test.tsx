import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import {
  LOCATION_ERROR_CODES,
  LOCATION_PATHS,
  type LocationListResponse,
  type LocationResponse,
  type LocationSummary,
} from '@erp/shared';
import { server } from '../../../test/server';
import { renderPage, signedInWith } from '../../../test/render';
import { LocationsPage } from './LocationsPage';

/**
 * The locations screen from the user's side.
 *
 * The screen writes no paging, sorting or filtering code — it holds a `ListQuery` and hands it
 * to the shared table — so what these assert about the list is the platform's behaviour as
 * somebody experiences it. Requests are intercepted at the network boundary and their query
 * strings captured, because "sorted" and "filtered to what is in use" are only true if the
 * *server* was asked: a screen that reordered rows it was already holding would pass a weaker
 * test and be wrong on page two.
 *
 * The empty state gets a test of its own rather than being an afterthought. Nothing here is
 * seeded, so an empty list is the first thing every real user sees, and it is where the
 * movement screen will send somebody who has nowhere to record a movement into.
 */
describe('LocationsPage', () => {
  const PAGE_SIZE = 25;

  /**
   * A row whose name is deliberately not its code, so that a query for one is never ambiguous
   * about which column answered it.
   */
  function location(code: string, overrides: Partial<LocationSummary> = {}): LocationSummary {
    return {
      id: `id-${code.toLowerCase()}`,
      code,
      name: `${code} store`,
      status: 'active',
      ...overrides,
    };
  }

  function page(items: LocationSummary[], total = items.length): LocationListResponse {
    return {
      items,
      page: { number: 1, size: PAGE_SIZE, total, pages: Math.ceil(total / PAGE_SIZE) },
    };
  }

  function listing(
    respond: (parameters: URLSearchParams) => LocationListResponse,
  ): { asked: string[] } {
    const asked: string[] = [];

    server.use(
      http.get(LOCATION_PATHS.locations, ({ request }) => {
        const url = new URL(request.url);
        asked.push(url.search);
        return HttpResponse.json(respond(url.searchParams));
      }),
    );

    return { asked };
  }

  function detailing(response: LocationResponse): void {
    server.use(
      http.get(LOCATION_PATHS.location(response.id), () => HttpResponse.json(response)),
    );
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
    it('shows the code, the name and whether it is still in use', async () => {
      listing(() =>
        page([location('WH-1'), location('VAN-1', { name: 'Delivery van', status: 'inactive' })]),
      );

      renderPage(<LocationsPage />, { path: '/locations' });

      await screen.findByText('WH-1 store');
      expect(renderedRows()).toEqual([
        ['WH-1', 'WH-1 store', 'In use'],
        ['VAN-1', 'Delivery van', 'Not in use'],
      ]);
    });

    it('asks the server to sort when a column heading is clicked', async () => {
      const { asked } = listing(() => page([location('WH-1')]));

      const { user } = renderPage(<LocationsPage />, { path: '/locations' });
      await screen.findByText('WH-1 store');

      await user.click(screen.getByRole('button', { name: /^code$/i }));
      await waitFor(() => expect(asked.at(-1)).toContain('sort=code'));
    });

    it('filters to what is in use, under the platform’s filter convention', async () => {
      const { asked } = listing((parameters) =>
        parameters.get('filter.status') === 'active'
          ? page([location('WH-1')])
          : page([location('WH-1'), location('VAN-1', { status: 'inactive' })]),
      );

      const { user } = renderPage(<LocationsPage />, { path: '/locations' });
      await screen.findByText('VAN-1');

      await user.selectOptions(screen.getByLabelText(/^status$/i), 'active');

      await waitFor(() => expect(asked.at(-1)).toContain('filter.status=active'));
      expect(screen.queryByText('VAN-1')).not.toBeInTheDocument();
    });

    it('searches by code or name in one box, which is what somebody remembers', async () => {
      const { asked } = listing(() => page([location('WH-1')]));

      const { user } = renderPage(<LocationsPage />, { path: '/locations' });
      await screen.findByText('WH-1 store');

      await user.type(screen.getByLabelText(/search by code or name/i), 'van');
      // Submitted rather than debounced — the shared box searches when asked, so a test that
      // only typed would be asserting a request the design deliberately does not make.
      await user.click(screen.getByRole('button', { name: /^search$/i }));

      await waitFor(() => expect(asked.at(-1)).toContain('search=van'));
    });
  });

  describe('a fresh account', () => {
    it('says what a location is rather than showing an empty box', async () => {
      signedInWith();
      listing(() => page([]));

      renderPage(<LocationsPage />, { token: 'a-token', path: '/locations' });

      // Nothing is seeded in this system, so this is the first thing a real user sees — and
      // the screen the movement form will send them to when there is nowhere to record into.
      expect(await screen.findByText(/nowhere to keep anything yet/i)).toBeInTheDocument();
      expect(screen.getByText(/a warehouse, a van, a bay/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /add location/i })).toBeInTheDocument();
    });

    it('hides the form from somebody who may not add one', async () => {
      signedInWith(['inventory:locations:read']);
      listing(() => page([]));

      renderPage(<LocationsPage />, { token: 'a-token', path: '/locations' });

      await screen.findByText(/nowhere to keep anything yet/i);
      expect(screen.queryByRole('button', { name: /add location/i })).not.toBeInTheDocument();
    });
  });

  describe('adding one', () => {
    it('creates a location and refreshes the list', async () => {
      signedInWith();

      let sent: unknown;
      let created = false;
      const warehouse = location('WH-1');

      server.use(
        http.get(LOCATION_PATHS.locations, () =>
          HttpResponse.json(created ? page([warehouse]) : page([])),
        ),
        http.post(LOCATION_PATHS.locations, async ({ request }) => {
          sent = await request.json();
          created = true;
          return HttpResponse.json(warehouse, { status: 201 });
        }),
      );
      detailing(warehouse);

      const { user } = renderPage(<LocationsPage />, { token: 'a-token', path: '/locations' });
      await screen.findByText(/nowhere to keep anything yet/i);

      await user.type(screen.getByLabelText(/^code$/i), 'wh-1');
      await user.type(screen.getByLabelText(/^name$/i), 'WH-1 store');
      await user.click(screen.getByRole('button', { name: /add location/i }));

      // Sent as typed — the upper-casing is the server's, and a screen that did it first would
      // be a second place for the rule to live and drift from.
      await waitFor(() => expect(sent).toEqual({ code: 'wh-1', name: 'WH-1 store' }));
      expect(await screen.findByRole('cell', { name: 'WH-1 store' })).toBeInTheDocument();
    });

    it('puts a server message beside the input it belongs to', async () => {
      signedInWith();
      listing(() => page([]));

      server.use(
        http.post(LOCATION_PATHS.locations, () =>
          HttpResponse.json(
            {
              code: LOCATION_ERROR_CODES.duplicateLocationCode,
              message: "'WH-1' is already the code of another location.",
              fields: { code: "'WH-1' is already the code of another location." },
            },
            { status: 409 },
          ),
        ),
      );

      const { user } = renderPage(<LocationsPage />, { token: 'a-token', path: '/locations' });
      await screen.findByText(/nowhere to keep anything yet/i);

      await user.type(screen.getByLabelText(/^code$/i), 'WH-1');
      await user.type(screen.getByLabelText(/^name$/i), 'Second warehouse');
      await user.click(screen.getByRole('button', { name: /add location/i }));

      const code = await screen.findByLabelText(/^code$/i);
      expect(code).toHaveAttribute('aria-invalid', 'true');
      expect(code).toHaveAccessibleDescription(/already the code of another location/i);
    });
  });

  describe('the panel for one location', () => {
    /**
     * Opens the panel with a mutable server behind it.
     *
     * `changing` replaces what both the list and the detail answer, because a change here
     * invalidates both — a fixture that kept answering with the row as it was would make the
     * panel look like it had ignored the response it rendered.
     */
    async function openWarehouse() {
      signedInWith();
      let current: LocationResponse = location('WH-1');

      server.use(
        http.get(LOCATION_PATHS.locations, () => HttpResponse.json(page([current]))),
        http.get(LOCATION_PATHS.location(current.id), () => HttpResponse.json(current)),
      );

      const { user } = renderPage(<LocationsPage />, { token: 'a-token', path: '/locations' });
      await user.click(await screen.findByRole('button', { name: 'WH-1' }));
      await screen.findByRole('heading', { name: 'WH-1 store' });

      return {
        user,
        warehouse: current,
        changing: (become: LocationResponse, onRequest?: (body: unknown) => void) =>
          server.use(
            http.patch(LOCATION_PATHS.location(current.id), async ({ request }) => {
              onRequest?.(await request.json());
              current = become;
              return HttpResponse.json(current);
            }),
          ),
      };
    }

    it('corrects a code and a name, because nothing here can be deleted and retyped', async () => {
      const { user, warehouse, changing } = await openWarehouse();

      let sent: unknown;
      changing({ ...warehouse, code: 'WH-2', name: 'North warehouse' }, (body) => {
        sent = body;
      });

      await user.click(screen.getByRole('button', { name: /edit details/i }));

      // Scoped to the panel's own form, because the add form on the same screen has a Code box
      // too — and a query that matched either would be a test that passed on the wrong one.
      const details = within(screen.getByRole('form', { name: /^details$/i }));
      await user.clear(details.getByLabelText(/^code$/i));
      await user.type(details.getByLabelText(/^code$/i), 'WH-2');
      await user.click(details.getByRole('button', { name: /save details/i }));

      await waitFor(() => expect(sent).toEqual({ code: 'WH-2', name: 'WH-1 store' }));
      expect(await screen.findByRole('heading', { name: 'North warehouse' })).toBeInTheDocument();
    });

    /**
     * A refused edit keeps the boxes, because the boxes are where the message goes.
     *
     * Closing the form on submit would take them away before the answer arrived, discarding
     * what the user typed at exactly the moment they need to see it again.
     */
    it('keeps the edit form open when the server refuses the code', async () => {
      const { user, warehouse } = await openWarehouse();

      server.use(
        http.patch(LOCATION_PATHS.location(warehouse.id), () =>
          HttpResponse.json(
            {
              code: LOCATION_ERROR_CODES.duplicateLocationCode,
              message: "'VAN-1' is already the code of another location.",
              fields: { code: "'VAN-1' is already the code of another location." },
            },
            { status: 409 },
          ),
        ),
      );

      await user.click(screen.getByRole('button', { name: /edit details/i }));

      const details = within(screen.getByRole('form', { name: /^details$/i }));
      await user.clear(details.getByLabelText(/^code$/i));
      await user.type(details.getByLabelText(/^code$/i), 'VAN-1');
      await user.click(details.getByRole('button', { name: /save details/i }));

      const box = await within(screen.getByRole('form', { name: /^details$/i })).findByLabelText(
        /^code$/i,
      );
      expect(box).toHaveValue('VAN-1');
      expect(box).toHaveAccessibleDescription(/already the code of another location/i);
    });

    it('deactivates one, and offers to bring it back rather than making that final', async () => {
      const { user, warehouse, changing } = await openWarehouse();

      changing({ ...warehouse, status: 'inactive' });

      await user.click(screen.getByRole('button', { name: /deactivate/i }));

      expect(await screen.findByRole('button', { name: /reactivate/i })).toBeInTheDocument();
    });

    /**
     * The refusal in words, which is the reason the panel renders what the server said rather
     * than what it asked for: a button that appeared to do nothing would be indistinguishable
     * from one that was broken.
     */
    it('explains why somewhere holding stock will not go quiet', async () => {
      const { user, warehouse } = await openWarehouse();

      server.use(
        http.patch(LOCATION_PATHS.location(warehouse.id), () =>
          HttpResponse.json(
            {
              code: LOCATION_ERROR_CODES.locationHoldsStock,
              message:
                '3 products still held here. Move it elsewhere first, and then deactivate.',
            },
            { status: 409 },
          ),
        ),
      );

      await user.click(screen.getByRole('button', { name: /deactivate/i }));

      expect(await screen.findByText(/3 products still held here/i)).toBeInTheDocument();
      // Still in use, because the server refused. The panel does not congratulate itself.
      expect(screen.getByRole('button', { name: /deactivate/i })).toBeInTheDocument();
    });
  });
});
