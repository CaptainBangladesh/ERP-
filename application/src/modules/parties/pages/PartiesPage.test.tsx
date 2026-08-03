import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import {
  ERROR_CODES,
  PARTY_PATHS,
  type PartyListResponse,
  type PartyResponse,
  type PartySummary,
} from '@erp/shared';
import { server } from '../../../test/server';
import { renderPage, signedInWith } from '../../../test/render';
import { PartiesPage } from './PartiesPage';

/**
 * The address book from the user's side.
 *
 * The screen writes no paging, sorting or filtering code — it holds a `ListQuery` and hands
 * it to the shared table — so what these assert about the list is the platform's behaviour as
 * somebody experiences it. Requests are intercepted at the network boundary and their query
 * strings captured, because "filtered by role" is only true if the *server* was asked to
 * filter: a screen that hid rows it was already holding would pass a weaker test and be
 * wrong on page two.
 *
 * The role assertions are the ones worth reading. Nothing in this file lists the roles the
 * system permits, because nothing in the system does — the filter's options come from the
 * server's answer, and the input takes whatever is typed. A test that hard-coded three roles
 * would be asserting the opposite of the module's central claim.
 */
describe('PartiesPage', () => {
  const PAGE_SIZE = 25;

  /**
   * Ids are slugs of the name rather than the name itself, because they go into a URL: an id
   * with a space in it is percent-encoded on the way out and the interceptor's path no longer
   * matches, which looks like the screen never asked for the party.
   */
  function idOf(name: string): string {
    return `id-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-$/, '')}`;
  }

  function party(name: string, overrides: Partial<PartySummary> = {}): PartySummary {
    return {
      id: idOf(name),
      kind: 'person',
      name,
      email: null,
      phone: null,
      status: 'active',
      roles: [],
      organisationId: null,
      organisationName: null,
      mergedIntoId: null,
      ...overrides,
    };
  }

  function detail(summary: PartySummary, overrides: Partial<PartyResponse> = {}): PartyResponse {
    return { ...summary, addresses: [], members: [], ...overrides };
  }

  function page(items: PartySummary[], total = items.length, number = 1): PartyListResponse {
    return {
      items,
      page: { number, size: PAGE_SIZE, total, pages: Math.ceil(total / PAGE_SIZE) },
    };
  }

  /**
   * The list endpoint, recording every query string it was asked with.
   *
   * `respond` is given the parameters so a test can behave like a real server — a different
   * page, a different order, a narrower set — rather than the same rows whatever was asked.
   * The directory request the page also makes (for the organisation and merge dropdowns) is
   * the same endpoint, so it is recorded too and the assertions look at the *last* one.
   */
  function listing(
    respond: (parameters: URLSearchParams) => PartyListResponse,
    roles: string[] = [],
  ): { asked: string[] } {
    const asked: string[] = [];

    server.use(
      http.get(PARTY_PATHS.roles, () => HttpResponse.json({ roles })),
      http.get(PARTY_PATHS.parties, ({ request }) => {
        const url = new URL(request.url);
        asked.push(url.search);
        return HttpResponse.json(respond(url.searchParams));
      }),
    );

    return { asked };
  }

  /** The data rows, ignoring the header row, as arrays of cell text. */
  function renderedRows(): string[][] {
    const [, ...rows] = screen.getAllByRole('row');
    return rows.map((row) =>
      within(row)
        .getAllByRole('cell')
        .map((cell) => cell.textContent ?? ''),
    );
  }

  describe('the list', () => {
    it('shows who is in the book, what they are, and what roles they hold', async () => {
      listing(() =>
        page([
          party('Ada Okafor', { roles: ['customer', 'supplier'] }),
          party('Northwind Ltd', { kind: 'organisation', status: 'inactive' }),
        ]),
      );

      renderPage(<PartiesPage />, { path: '/parties' });

      await screen.findByText('Ada Okafor');
      expect(renderedRows()).toEqual([
        ['Ada Okafor', 'Person', 'customer, supplier', 'Active'],
        ['Northwind Ltd', 'Organisation', '—', 'Inactive'],
      ]);
    });

    it('asks the server to sort when a column heading is clicked', async () => {
      const { asked } = listing((parameters) =>
        page(
          parameters.get('sort') === '-name'
            ? [party('Bo Lindqvist'), party('Ada Okafor')]
            : [party('Ada Okafor'), party('Bo Lindqvist')],
        ),
      );

      const { user } = renderPage(<PartiesPage />, { path: '/parties' });
      await screen.findByText('Ada Okafor');

      await user.click(screen.getByRole('button', { name: /^name$/i }));
      await waitFor(() => expect(asked.at(-1)).toContain('sort=name'));

      await user.click(screen.getByRole('button', { name: /^name$/i }));
      await waitFor(() => expect(asked.at(-1)).toContain('sort=-name'));
    });

    it('offers no sort on roles, because a party holds several and a list has one order', async () => {
      listing(() => page([party('Ada Okafor', { roles: ['customer'] })]));

      renderPage(<PartiesPage />, { path: '/parties' });
      await screen.findByText('Ada Okafor');

      // The server refuses `?sort=role`; the column says so by not being a button at all,
      // rather than by offering a control that produces a 403.
      const roles = screen.getByRole('columnheader', { name: /roles/i });
      expect(within(roles).queryByRole('button')).toBeNull();
    });

    it('searches on the server and goes back to the first page to do it', async () => {
      const { asked } = listing((parameters) =>
        parameters.get('search')
          ? page([party('Ada Okafor')])
          : page([party('Ada Okafor'), party('Bo Lindqvist')], 60, 2),
      );

      const { user } = renderPage(<PartiesPage />, { path: '/parties' });
      await screen.findByText('Bo Lindqvist');

      await user.type(screen.getByLabelText(/search by name or email/i), 'okafor');
      await user.click(screen.getByRole('button', { name: /^search$/i }));

      await waitFor(() => expect(asked.at(-1)).toContain('search=okafor'));
      // A narrowed list showing page two of the old one would show nothing and look broken.
      expect(asked.at(-1)).not.toContain('page=');
    });

    it('filters by a role the server says is in use, under the platform’s filter convention', async () => {
      const { asked } = listing(
        (parameters) =>
          parameters.get('filter.role') === 'freight-forwarder'
            ? page([party('Kit Bramley', { roles: ['freight-forwarder'] })])
            : page([party('Ada Okafor'), party('Kit Bramley')]),
        // A role nothing in this codebase has heard of, which is the point: the options come
        // from the data, so a module introducing a role needs no change here.
        ['freight-forwarder'],
      );

      const { user } = renderPage(<PartiesPage />, { path: '/parties' });
      await screen.findByText('Ada Okafor');

      await user.selectOptions(await screen.findByLabelText(/^role$/i), 'freight-forwarder');

      await waitFor(() => expect(asked.at(-1)).toContain('filter.role=freight-forwarder'));
      expect(await screen.findByText('Kit Bramley')).toBeInTheDocument();
      expect(screen.queryByText('Ada Okafor')).not.toBeInTheDocument();
    });

    it('filters by status, and clearing it goes back to no filter at all', async () => {
      const { asked } = listing((parameters) =>
        parameters.get('filter.status') === 'inactive'
          ? page([party('Bo Lindqvist', { status: 'inactive' })])
          : page([party('Ada Okafor')]),
      );

      const { user } = renderPage(<PartiesPage />, { path: '/parties' });
      await screen.findByText('Ada Okafor');

      await user.selectOptions(screen.getByLabelText(/^status$/i), 'inactive');
      await waitFor(() => expect(asked.at(-1)).toContain('filter.status=inactive'));

      await user.selectOptions(screen.getByLabelText(/^status$/i), '');
      // An empty filter left in the query would still count as narrowing, and the screen
      // would go on offering "clear your filters" to somebody with none.
      await waitFor(() => expect(asked.at(-1)).toBe(''));
    });
  });

  describe('the states a fresh account passes through', () => {
    it('guides the first action rather than showing an empty box', async () => {
      listing(() => page([]));

      renderPage(<PartiesPage />, { path: '/parties' });

      // Nothing is seeded in this system, so this is the first thing a real user sees.
      expect(await screen.findByText(/nobody in the address book yet/i)).toBeInTheDocument();
      expect(screen.getByText(/add your first party/i)).toBeInTheDocument();
    });

    it('tells somebody their search matched nothing rather than that they know nobody', async () => {
      const { asked } = listing((parameters) =>
        parameters.get('search') ? page([]) : page([party('Ada Okafor')]),
      );

      const { user } = renderPage(<PartiesPage />, { path: '/parties' });
      await screen.findByText('Ada Okafor');

      await user.type(screen.getByLabelText(/search by name or email/i), 'nobody');
      await user.click(screen.getByRole('button', { name: /^search$/i }));

      // "Add your first party" to somebody with two hundred and a typo is the failure that
      // splitting the empty state in two exists to prevent.
      expect(await screen.findByText(/nothing matches/i)).toBeInTheDocument();
      expect(screen.queryByText(/nobody in the address book yet/i)).not.toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: /clear search and filters/i }));
      await waitFor(() => expect(asked.at(-1)).toBe(''));
      expect(await screen.findByText('Ada Okafor')).toBeInTheDocument();
    });

    it('shows the failure and offers a way to try again', async () => {
      let attempts = 0;
      server.use(
        http.get(PARTY_PATHS.roles, () => HttpResponse.json({ roles: [] })),
        http.get(PARTY_PATHS.parties, () => {
          attempts += 1;
          if (attempts <= 2) {
            return HttpResponse.json(
              { code: 'internal_error', message: 'Something went wrong. Please try again.' },
              { status: 500 },
            );
          }
          return HttpResponse.json(page([party('Ada Okafor')]));
        }),
      );

      const { user } = renderPage(<PartiesPage />, { path: '/parties' });

      expect((await screen.findAllByRole('alert'))[0]).toHaveTextContent(/something went wrong/i);

      await user.click(screen.getByRole('button', { name: /try again/i }));
      expect(await screen.findByText('Ada Okafor')).toBeInTheDocument();
    });
  });

  describe('adding a party', () => {
    it('creates a person and refreshes the list', async () => {
      signedInWith();
      let sent: unknown;
      let created = false;
      const ada = party('Ada Okafor');

      server.use(
        http.get(PARTY_PATHS.roles, () => HttpResponse.json({ roles: [] })),
        http.get(PARTY_PATHS.parties, () =>
          HttpResponse.json(created ? page([ada]) : page([])),
        ),
        http.get(PARTY_PATHS.party(ada.id), () => HttpResponse.json(detail(ada))),
        http.post(PARTY_PATHS.parties, async ({ request }) => {
          sent = await request.json();
          created = true;
          return HttpResponse.json(detail(ada), { status: 201 });
        }),
      );

      const { user } = renderPage(<PartiesPage />, { token: 'a-token', path: '/parties' });
      await screen.findByText(/nobody in the address book yet/i);

      await user.type(await screen.findByLabelText(/^name$/i), 'Ada Okafor');
      await user.type(screen.getByLabelText(/^email$/i), 'ada@example.test');
      await user.click(screen.getByRole('button', { name: /add party/i }));

      await waitFor(() =>
        expect(sent).toEqual({ kind: 'person', name: 'Ada Okafor', email: 'ada@example.test' }),
      );
      expect(await screen.findByRole('cell', { name: 'Ada Okafor' })).toBeInTheDocument();
    });

    it('creates an organisation when asked to', async () => {
      signedInWith();
      let sent: unknown;
      const northwind = party('Northwind Ltd', { kind: 'organisation' });

      server.use(
        http.get(PARTY_PATHS.roles, () => HttpResponse.json({ roles: [] })),
        http.get(PARTY_PATHS.parties, () => HttpResponse.json(page([]))),
        http.get(PARTY_PATHS.party(northwind.id), () => HttpResponse.json(detail(northwind))),
        http.post(PARTY_PATHS.parties, async ({ request }) => {
          sent = await request.json();
          return HttpResponse.json(detail(northwind), { status: 201 });
        }),
      );

      const { user } = renderPage(<PartiesPage />, { token: 'a-token', path: '/parties' });
      await screen.findByText(/nobody in the address book yet/i);

      await user.click(await screen.findByRole('radio', { name: /organisation/i }));
      await user.type(screen.getByLabelText(/^name$/i), 'Northwind Ltd');
      await user.click(screen.getByRole('button', { name: /add party/i }));

      await waitFor(() =>
        expect(sent).toEqual({ kind: 'organisation', name: 'Northwind Ltd' }),
      );
    });

    it('puts a server message beside the input it belongs to', async () => {
      signedInWith();
      server.use(
        http.get(PARTY_PATHS.roles, () => HttpResponse.json({ roles: [] })),
        http.get(PARTY_PATHS.parties, () => HttpResponse.json(page([]))),
        http.post(PARTY_PATHS.parties, () =>
          HttpResponse.json(
            {
              code: ERROR_CODES.validationFailed,
              message: 'Some of the details you entered need attention.',
              fields: { email: 'Enter an email address, such as name@example.com.' },
            },
            { status: 422 },
          ),
        ),
      );

      const { user } = renderPage(<PartiesPage />, { token: 'a-token', path: '/parties' });
      await screen.findByText(/nobody in the address book yet/i);

      await user.type(await screen.findByLabelText(/^name$/i), 'Ada Okafor');
      await user.click(screen.getByRole('button', { name: /add party/i }));

      const email = await screen.findByLabelText(/^email$/i);
      expect(email).toHaveAttribute('aria-invalid', 'true');
      expect(email).toHaveAccessibleDescription(/name@example.com/i);
    });

    it('hides the form from a colleague without parties:parties:write', async () => {
      signedInWith([]);
      server.use(
        http.get(PARTY_PATHS.roles, () => HttpResponse.json({ roles: [] })),
        http.get(PARTY_PATHS.parties, () => HttpResponse.json(page([party('Ada Okafor')]))),
      );

      renderPage(<PartiesPage />, { token: 'a-token', path: '/parties' });
      await screen.findByText('Ada Okafor');

      expect(screen.queryByRole('button', { name: /add party/i })).not.toBeInTheDocument();
    });
  });

  describe('managing roles', () => {
    const ada = party('Ada Okafor', { roles: ['customer'] });

    /**
     * A server that remembers, which this fixture has to be.
     *
     * Every action on the panel refreshes the party afterwards rather than trusting its own
     * copy of what happened, so a handler that answered with the same roles every time would
     * make the screen appear to undo itself. Holding the state here is what makes the test
     * describe the real sequence: add a role, and the list the *server* now reports is what
     * gets rendered.
     */
    function openPanel(): { held: string[]; asked: string[] } {
      const held = ['customer'];
      const asked: string[] = [];
      const current = () => detail(ada, { roles: [...held] });

      server.use(
        http.get(PARTY_PATHS.roles, () => HttpResponse.json({ roles: held })),
        http.get(PARTY_PATHS.parties, () =>
          HttpResponse.json(page([{ ...ada, roles: [...held] }])),
        ),
        http.get(PARTY_PATHS.party(ada.id), () => HttpResponse.json(current())),
        http.post(PARTY_PATHS.partyRoles(ada.id), async ({ request }) => {
          const body = (await request.json()) as { role: string };
          asked.push(body.role);
          if (!held.includes(body.role)) held.push(body.role);
          return HttpResponse.json(current());
        }),
        http.delete(`${PARTY_PATHS.partyRoles(ada.id)}/:role`, ({ params }) => {
          const at = held.indexOf(String(params.role));
          if (at >= 0) held.splice(at, 1);
          return HttpResponse.json(current());
        }),
      );

      return { held, asked };
    }

    it('adds a role the system has never seen, without recreating the party', async () => {
      const { asked } = openPanel();

      const { user } = renderPage(<PartiesPage />, { path: '/parties' });
      await user.click(await screen.findByRole('button', { name: 'Ada Okafor' }));

      await screen.findByRole('heading', { name: 'Ada Okafor' });
      await user.type(screen.getByLabelText(/add a role/i), 'Freight-Forwarder');
      await user.click(screen.getByRole('button', { name: /add role/i }));

      // Normalised on the way out, because a role is compared and put in a URL: `Customer`
      // and `customer` must not both exist and mean the same thing.
      await waitFor(() => expect(asked).toEqual(['freight-forwarder']));
      // The chip, specifically. The role also appears in the list row behind the panel, which
      // is the point — one change, and both places the server was asked agree.
      expect(
        await screen.findByRole('button', { name: /remove role freight-forwarder/i }),
      ).toBeInTheDocument();
      // And the party is the same party — a role is something it holds, not something it is.
      expect(screen.getByRole('heading', { name: 'Ada Okafor' })).toBeInTheDocument();
    });

    it('takes a role away again', async () => {
      const { held } = openPanel();

      const { user } = renderPage(<PartiesPage />, { path: '/parties' });
      await user.click(await screen.findByRole('button', { name: 'Ada Okafor' }));

      await user.click(await screen.findByRole('button', { name: /remove role customer/i }));

      await waitFor(() => expect(held).toEqual([]));
      expect(await screen.findByText(/no roles yet/i)).toBeInTheDocument();
    });

    it('says a merged record cannot be edited rather than offering controls that fail', async () => {
      const gone = party('A. Okafor', { status: 'merged', mergedIntoId: idOf('Ada Okafor') });

      server.use(
        http.get(PARTY_PATHS.roles, () => HttpResponse.json({ roles: [] })),
        http.get(PARTY_PATHS.parties, () => HttpResponse.json(page([gone]))),
        http.get(PARTY_PATHS.party(gone.id), () => HttpResponse.json(detail(gone))),
      );

      const { user } = renderPage(<PartiesPage />, { path: '/parties' });
      await user.click(await screen.findByRole('button', { name: 'A. Okafor' }));

      expect(await screen.findByText(/merged into another/i)).toBeInTheDocument();
      expect(screen.queryByLabelText(/add a role/i)).toBeNull();
      expect(screen.queryByRole('button', { name: /deactivate/i })).toBeNull();
    });
  });

  describe('deactivating and merging', () => {
    const ada = party('Ada Okafor');
    const duplicate = party('A. Okafor');

    it('deactivates rather than deleting, and says so on the row', async () => {
      let sent: unknown;
      let status: PartySummary['status'] = 'active';

      server.use(
        http.get(PARTY_PATHS.roles, () => HttpResponse.json({ roles: [] })),
        http.get(PARTY_PATHS.parties, () =>
          HttpResponse.json(page([{ ...ada, status }])),
        ),
        http.get(PARTY_PATHS.party(ada.id), () =>
          HttpResponse.json(detail({ ...ada, status })),
        ),
        http.patch(PARTY_PATHS.party(ada.id), async ({ request }) => {
          sent = await request.json();
          status = 'inactive';
          return HttpResponse.json(detail({ ...ada, status }));
        }),
      );

      const { user } = renderPage(<PartiesPage />, { path: '/parties' });
      await user.click(await screen.findByRole('button', { name: 'Ada Okafor' }));

      await user.click(await screen.findByRole('button', { name: /deactivate/i }));

      await waitFor(() => expect(sent).toEqual({ status: 'inactive' }));
      // There is no delete control anywhere, which is the point rather than an omission.
      expect(screen.queryByRole('button', { name: /^delete/i })).toBeNull();
      expect(await screen.findByRole('button', { name: /reactivate/i })).toBeInTheDocument();
    });

    it('corrects the details somebody typed wrong, without a second party and a merge', async () => {
      let sent: unknown;
      let current = { ...ada, name: 'Ada Okafr', email: null as string | null };

      server.use(
        http.get(PARTY_PATHS.roles, () => HttpResponse.json({ roles: [] })),
        http.get(PARTY_PATHS.parties, () => HttpResponse.json(page([current]))),
        http.get(PARTY_PATHS.party(ada.id), () => HttpResponse.json(detail(current))),
        http.patch(PARTY_PATHS.party(ada.id), async ({ request }) => {
          sent = await request.json();
          current = { ...current, name: 'Ada Okafor', email: 'ada@example.test' };
          return HttpResponse.json(detail(current));
        }),
      );

      const { user } = renderPage(<PartiesPage />, { path: '/parties' });
      await user.click(await screen.findByRole('button', { name: 'Ada Okafr' }));

      await user.click(await screen.findByRole('button', { name: /edit details/i }));

      // Scoped to the panel's form: the "add a party" form on the same screen has a Name and
      // an Email too, which is right — they are the same fields asked at a different moment.
      const details = within(screen.getByRole('form', { name: /^details$/i }));
      await user.clear(details.getByLabelText(/^name$/i));
      await user.type(details.getByLabelText(/^name$/i), 'Ada Okafor');
      await user.type(details.getByLabelText(/^email$/i), 'ada@example.test');
      await user.click(details.getByRole('button', { name: /save details/i }));

      // Nothing is ever deleted here, so a misspelled name has to be correctable in place —
      // otherwise the only remedy is a second record and a merge, for a missing letter. The
      // untouched phone box is left out rather than sent blank, which the endpoint refuses.
      await waitFor(() =>
        expect(sent).toEqual({ name: 'Ada Okafor', email: 'ada@example.test' }),
      );
      expect(await screen.findByRole('heading', { name: 'Ada Okafor' })).toBeInTheDocument();
    });

    it('merges a duplicate into the party on screen', async () => {
      let sent: unknown;

      server.use(
        http.get(PARTY_PATHS.roles, () => HttpResponse.json({ roles: [] })),
        http.get(PARTY_PATHS.parties, () => HttpResponse.json(page([ada, duplicate]))),
        http.get(PARTY_PATHS.party(ada.id), () => HttpResponse.json(detail(ada))),
        http.post(PARTY_PATHS.merge(ada.id), async ({ request }) => {
          sent = await request.json();
          return HttpResponse.json(detail(ada));
        }),
      );

      const { user } = renderPage(<PartiesPage />, { path: '/parties' });
      await user.click(await screen.findByRole('button', { name: 'Ada Okafor' }));

      await user.selectOptions(
        await screen.findByLabelText(/merge a duplicate into this party/i),
        duplicate.id,
      );
      await user.click(screen.getByRole('button', { name: /merge in/i }));

      // The party on screen survives; the one chosen goes away. Getting that round the wrong
      // way is the mistake this control is most likely to produce.
      await waitFor(() => expect(sent).toEqual({ duplicateId: duplicate.id }));
    });
  });
});
