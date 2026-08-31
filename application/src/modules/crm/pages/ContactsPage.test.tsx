import { beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import {
  ACTIVITY_PATHS,
  DEAL_PATHS,
  PARTY_PATHS,
  type ActivityListResponse,
  type PartyDealRollupResponse,
  type PartyListResponse,
  type PartyResponse,
  type PartySummary,
} from '@erp/shared';
import { renderPage, signedInWith } from '../../../test/render';
import { server } from '../../../test/server';
import { ContactsPage } from './ContactsPage';

/**
 * The Contacts board from the user's side.
 *
 * The board is the CRM's own view of `Party(kind: 'person')`, so nearly every assertion here
 * is about *composition*: the people come from parties, their deals come from crm, and this
 * screen is the only place the two meet. Each is its own request, and these tests answer them
 * separately for that reason.
 */
describe('ContactsPage', () => {
  // The board's role filter asks the company which roles it has actually used, on every
  // render. No test here is about that list, but leaving it unanswered means each one runs
  // against a failed request and leaves a rejection behind it — an unhandled error, which
  // fails the run whatever the assertions did.
  beforeEach(() => {
    server.use(http.get(PARTY_PATHS.roles, () => HttpResponse.json({ items: [] })));
  });

  function person(id: string, name: string, overrides: Partial<PartySummary> = {}): PartySummary {
    return {
      id,
      kind: 'person',
      name,
      email: `${name.split(' ')[0]?.toLowerCase()}@example.test`,
      phone: null,
      status: 'active',
      roles: [],
      organisationId: null,
      organisationName: null,
      mergedIntoId: null,
      ...overrides,
    };
  }

  function organisation(id: string, name: string): PartySummary {
    return {
      id,
      kind: 'organisation',
      name,
      email: null,
      phone: null,
      status: 'active',
      roles: [],
      organisationId: null,
      organisationName: null,
      mergedIntoId: null,
    };
  }

  function page(items: PartySummary[]): PartyListResponse {
    return { items, page: { number: 1, size: 100, total: items.length, pages: 1 } };
  }

  const noActivities: ActivityListResponse = { items: [] };

  /**
   * Parties is asked twice by this screen — once for the contacts it lists, once for the
   * accounts it groups them under — and the two are told apart by `filter.kind`, exactly as
   * the real endpoint tells them apart.
   */
  function setupMocks({
    contacts = [] as PartySummary[],
    accounts = [] as PartySummary[],
    rollups = [] as PartyDealRollupResponse['items'],
  } = {}) {
    server.use(
      http.get(PARTY_PATHS.parties, ({ request }) => {
        const kind = new URL(request.url).searchParams.get('filter.kind');
        return HttpResponse.json(page(kind === 'organisation' ? accounts : contacts));
      }),
      http.get(DEAL_PATHS.dealsByParty, () =>
        HttpResponse.json({ items: rollups } satisfies PartyDealRollupResponse),
      ),
      http.get(ACTIVITY_PATHS.partyActivities(':id'), () => HttpResponse.json(noActivities)),
    );
  }

  it('says the board is empty rather than showing an empty table', async () => {
    signedInWith();
    setupMocks();

    renderPage(<ContactsPage />, { token: 'session-token' });

    expect(await screen.findByText(/no contacts yet/i)).toBeInTheDocument();
  });

  it('lists every contact with the details that identify them', async () => {
    signedInWith();
    setupMocks({ contacts: [person('p1', 'Priya Kapoor', { phone: '07700900123' })] });

    renderPage(<ContactsPage />, { token: 'session-token' });

    expect(await screen.findByText('Priya Kapoor')).toBeInTheDocument();
    expect(screen.getByText('priya@example.test')).toBeInTheDocument();
    expect(screen.getByText('07700900123')).toBeInTheDocument();
  });

  it("gathers a company's stakeholders under the account they belong to", async () => {
    signedInWith();
    setupMocks({
      accounts: [organisation('o1', 'Fashion Ltd'), organisation('o2', 'Kapoor Trading')],
      contacts: [
        person('p1', 'Priya Kapoor', { organisationId: 'o1', organisationName: 'Fashion Ltd' }),
        person('p2', 'Sam Reed', { organisationId: 'o1', organisationName: 'Fashion Ltd' }),
        person('p3', 'Jo Ali', { organisationId: 'o2', organisationName: 'Kapoor Trading' }),
      ],
    });

    renderPage(<ContactsPage />, { token: 'session-token' });

    const fashion = await screen.findByRole('region', { name: /fashion ltd/i });
    expect(within(fashion).getByText('Priya Kapoor')).toBeInTheDocument();
    expect(within(fashion).getByText('Sam Reed')).toBeInTheDocument();
    expect(within(fashion).queryByText('Jo Ali')).not.toBeInTheDocument();
    expect(within(fashion).getByText(/2 contacts/i)).toBeInTheDocument();
  });

  it('keeps contacts belonging to nobody in a section of their own', async () => {
    signedInWith();
    setupMocks({
      accounts: [organisation('o1', 'Fashion Ltd')],
      contacts: [person('p1', 'Unattached Person')],
    });

    renderPage(<ContactsPage />, { token: 'session-token' });

    const unassigned = await screen.findByRole('region', { name: /no account/i });
    expect(within(unassigned).getByText('Unattached Person')).toBeInTheDocument();
  });

  it('shows what each contact has in flight, from their deals', async () => {
    signedInWith();
    setupMocks({
      contacts: [person('p1', 'Priya Kapoor')],
      rollups: [
        {
          partyId: 'p1',
          openCount: 2,
          wonCount: 1,
          lostCount: 0,
          openValue: { amount: '4000.00', currency: 'GBP' },
          wonValue: { amount: '1500.00', currency: 'GBP' },
        },
      ],
    });

    renderPage(<ContactsPage />, { token: 'session-token' });

    const cell = await screen.findByLabelText(/deals for priya kapoor/i);
    await waitFor(() => expect(cell).toHaveTextContent(/2 open/i));
    expect(cell).toHaveTextContent('4,000');
  });

  it('says so plainly when a contact has no deals', async () => {
    signedInWith();
    setupMocks({ contacts: [person('p1', 'Priya Kapoor')] });

    renderPage(<ContactsPage />, { token: 'session-token' });

    const cell = await screen.findByLabelText(/deals for priya kapoor/i);
    await waitFor(() => expect(cell).toHaveTextContent(/no deals/i));
  });

  it('narrows the board to one account', async () => {
    signedInWith();
    let lastQuery = '';
    server.use(
      http.get(PARTY_PATHS.parties, ({ request }) => {
        const params = new URL(request.url).searchParams;
        if (params.get('filter.kind') === 'organisation') {
          return HttpResponse.json(page([organisation('o1', 'Fashion Ltd')]));
        }
        lastQuery = request.url;
        return HttpResponse.json(page([person('p1', 'Priya Kapoor')]));
      }),
      http.get(DEAL_PATHS.dealsByParty, () => HttpResponse.json({ items: [] })),
    );

    const { user } = renderPage(<ContactsPage />, { token: 'session-token' });

    await screen.findByText('Priya Kapoor');
    await user.selectOptions(screen.getByLabelText('Account'), 'o1');

    await waitFor(() => expect(lastQuery).toContain('filter.organisationId=o1'));
  });

  it('searches by what the person typed', async () => {
    signedInWith();
    let lastQuery = '';
    server.use(
      http.get(PARTY_PATHS.parties, ({ request }) => {
        const params = new URL(request.url).searchParams;
        if (params.get('filter.kind') === 'organisation') return HttpResponse.json(page([]));
        lastQuery = request.url;
        return HttpResponse.json(page([person('p1', 'Priya Kapoor')]));
      }),
      http.get(DEAL_PATHS.dealsByParty, () => HttpResponse.json({ items: [] })),
    );

    const { user } = renderPage(<ContactsPage />, { token: 'session-token' });

    await screen.findByText('Priya Kapoor');
    await user.type(screen.getByLabelText(/search contacts/i), 'kapoor');

    await waitFor(() => expect(lastQuery).toContain('search=kapoor'));
  });

  it('edits a contact in place, sending only the field that changed', async () => {
    signedInWith();
    const patched: unknown[] = [];
    setupMocks({ contacts: [person('p1', 'Priya Kapoor')] });
    server.use(
      http.patch(PARTY_PATHS.party('p1'), async ({ request }) => {
        patched.push(await request.json());
        return HttpResponse.json(person('p1', 'Priya Kapoor') as PartyResponse);
      }),
    );

    const { user } = renderPage(<ContactsPage />, { token: 'session-token' });

    await user.click(await screen.findByRole('button', { name: /edit phone of priya kapoor/i }));
    await user.type(screen.getByRole('textbox', { name: 'Phone of Priya Kapoor' }), '07700900999');
    await user.keyboard('{Enter}');

    await waitFor(() => expect(patched).toEqual([{ phone: '07700900999' }]));
  });

  it('hides every edit control from somebody who may only read', async () => {
    signedInWith(['parties:parties:read', 'crm:deals:read']);
    setupMocks({ contacts: [person('p1', 'Priya Kapoor')] });

    renderPage(<ContactsPage />, { token: 'session-token' });

    await screen.findByText('Priya Kapoor');
    expect(screen.queryByRole('button', { name: /new contact/i })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /edit phone of priya kapoor/i }),
    ).not.toBeInTheDocument();
  });

  it('opens one contact, and carries their activity history', async () => {
    signedInWith();
    setupMocks({
      contacts: [
        person('p1', 'Priya Kapoor', { organisationId: 'o1', organisationName: 'Fashion Ltd' }),
      ],
      accounts: [organisation('o1', 'Fashion Ltd')],
    });
    server.use(
      http.get(PARTY_PATHS.party('p1'), () =>
        HttpResponse.json({
          ...person('p1', 'Priya Kapoor', { organisationId: 'o1', organisationName: 'Fashion Ltd' }),
          addresses: [],
          members: [],
        } satisfies PartyResponse),
      ),
      http.get(DEAL_PATHS.deals, () =>
        HttpResponse.json({ items: [], page: { number: 1, size: 50, total: 0, pages: 0 } }),
      ),
    );

    const { user } = renderPage(<ContactsPage />, { token: 'session-token' });

    await user.click(await screen.findByRole('button', { name: /open priya kapoor/i }));

    const panel = await screen.findByRole('complementary', { name: /priya kapoor/i });
    expect(
      within(panel).getByRole('heading', { name: /activity timeline/i }),
    ).toBeInTheDocument();
  });
  it('orders the whole board, on the server, by what was chosen', async () => {
    signedInWith();
    let lastQuery = '';
    server.use(
      http.get(PARTY_PATHS.parties, ({ request }) => {
        const params = new URL(request.url).searchParams;
        if (params.get('filter.kind') === 'organisation') return HttpResponse.json(page([]));
        lastQuery = request.url;
        return HttpResponse.json(page([person('p1', 'Priya Kapoor')]));
      }),
      http.get(DEAL_PATHS.dealsByParty, () => HttpResponse.json({ items: [] })),
    );

    const { user } = renderPage(<ContactsPage />, { token: 'session-token' });

    await screen.findByText('Priya Kapoor');
    await user.selectOptions(screen.getByLabelText(/sort by/i), '-name');

    await waitFor(() => expect(lastQuery).toContain('sort=-name'));
  });

  it('renames a contact in place', async () => {
    signedInWith();
    const patched: unknown[] = [];
    setupMocks({ contacts: [person('p1', 'Priya Kapoor')] });
    server.use(
      http.patch(PARTY_PATHS.party('p1'), async ({ request }) => {
        patched.push(await request.json());
        return HttpResponse.json(person('p1', 'Priya Kapur') as PartyResponse);
      }),
    );

    const { user } = renderPage(<ContactsPage />, { token: 'session-token' });

    await user.click(await screen.findByRole('button', { name: /edit name of priya kapoor/i }));
    const input = screen.getByRole('textbox', { name: 'Name of Priya Kapoor' });
    await user.clear(input);
    await user.type(input, 'Priya Kapur');
    await user.keyboard('{Enter}');

    await waitFor(() => expect(patched).toEqual([{ name: 'Priya Kapur' }]));
  });

  it('counts what the company has, not what this page happens to hold', async () => {
    signedInWith();
    server.use(
      http.get(PARTY_PATHS.parties, ({ request }) => {
        const params = new URL(request.url).searchParams;
        if (params.get('filter.kind') === 'organisation') return HttpResponse.json(page([]));
        return HttpResponse.json({
          items: [person('p1', 'Priya Kapoor')],
          page: { number: 1, size: 100, total: 407, pages: 5 },
        } satisfies PartyListResponse);
      }),
      http.get(DEAL_PATHS.dealsByParty, () => HttpResponse.json({ items: [] })),
    );

    renderPage(<ContactsPage />, { token: 'session-token' });

    expect(await screen.findByText('407')).toBeInTheDocument();
    expect(screen.getByText(/page 1 of 5/i)).toBeInTheDocument();
  });

  it('reaches the contacts past the first page', async () => {
    signedInWith();
    let lastQuery = '';
    server.use(
      http.get(PARTY_PATHS.parties, ({ request }) => {
        const params = new URL(request.url).searchParams;
        if (params.get('filter.kind') === 'organisation') return HttpResponse.json(page([]));
        lastQuery = request.url;
        return HttpResponse.json({
          items: [person('p1', 'Priya Kapoor')],
          page: { number: 1, size: 100, total: 407, pages: 5 },
        } satisfies PartyListResponse);
      }),
      http.get(DEAL_PATHS.dealsByParty, () => HttpResponse.json({ items: [] })),
    );

    const { user } = renderPage(<ContactsPage />, { token: 'session-token' });

    await user.click(await screen.findByRole('button', { name: /next/i }));

    await waitFor(() => expect(lastQuery).toContain('page=2'));
  });

  it('takes a contact off their account, and says so as an emptied field', async () => {
    signedInWith();
    const patched: unknown[] = [];
    setupMocks({
      contacts: [
        person('p1', 'Priya Kapoor', { organisationId: 'o1', organisationName: 'Fashion Ltd' }),
      ],
      accounts: [organisation('o1', 'Fashion Ltd')],
    });
    server.use(
      http.get(PARTY_PATHS.party('p1'), () =>
        HttpResponse.json({
          ...person('p1', 'Priya Kapoor', { organisationId: 'o1', organisationName: 'Fashion Ltd' }),
          addresses: [],
          members: [],
        } satisfies PartyResponse),
      ),
      http.get(DEAL_PATHS.deals, () =>
        HttpResponse.json({ items: [], page: { number: 1, size: 50, total: 0, pages: 0 } }),
      ),
      http.patch(PARTY_PATHS.party('p1'), async ({ request }) => {
        patched.push(await request.json());
        return HttpResponse.json({
          ...person('p1', 'Priya Kapoor'),
          addresses: [],
          members: [],
        } satisfies PartyResponse);
      }),
    );

    const { user } = renderPage(<ContactsPage />, { token: 'session-token' });

    await user.click(await screen.findByRole('button', { name: /open priya kapoor/i }));
    await user.selectOptions(
      await screen.findByLabelText(/account of priya kapoor/i),
      '',
    );

    // An empty string, never `null` — the platform reads a null as "do not touch it".
    await waitFor(() => expect(patched).toEqual([{ organisationId: '' }]));
  });
});
