import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import {
  IDENTITY_PATHS,
  LEAD_PATHS,
  PARTY_PATHS,
  type LeadListResponse,
  type LeadResponse,
  type LeadSummary,
  type PartyListResponse,
  type PartyResponse,
  type PartySummary,
  type UserListResponse,
} from '@erp/shared';
import { server } from '../../../test/server';
import { renderPage, signedInWith } from '../../../test/render';
import { LeadsPage } from './LeadsPage';

/**
 * Leads from the user's side.
 *
 * The screen writes no paging, sorting or filtering code — it holds a `ListQuery` and hands it
 * to the shared table — so what these assert about the list is the platform's behaviour as
 * somebody experiences it, the same discipline `PartiesPage.test.tsx` follows.
 *
 * The qualify tests are the ones worth reading closely: they assert on the *sequence* of
 * requests the browser makes — create-or-find the Party, call crm's `qualify`, then tag
 * `prospect` through Parties' own role endpoint — because that sequence, composed entirely on
 * this side of the wire, is what the spec asks for instead of a backend write to `PartyRole`.
 */
describe('LeadsPage', () => {
  const PAGE_SIZE = 25;

  function lead(name: string, overrides: Partial<LeadSummary> = {}): LeadSummary {
    return {
      id: `id-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      name,
      organisationName: null,
      email: null,
      phone: null,
      source: 'inbound',
      status: 'new',
      assignedToUserId: null,
      partyId: null,
      ...overrides,
    };
  }

  function page(items: LeadSummary[], total = items.length): LeadListResponse {
    return { items, page: { number: 1, size: PAGE_SIZE, total, pages: Math.ceil(total / PAGE_SIZE) } };
  }

  function party(id: string, name: string): PartyResponse {
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
      addresses: [],
      members: [],
    };
  }

  function listing(items: LeadSummary[]): void {
    server.use(http.get(LEAD_PATHS.leads, () => HttpResponse.json(page(items))));
  }

  describe('the list', () => {
    it('guides the first action rather than showing an empty box', async () => {
      listing([]);

      renderPage(<LeadsPage />, { path: '/crm/leads' });

      // Nothing is seeded in this system, so this is the first thing a real user sees.
      expect(await screen.findByText(/no leads yet/i)).toBeInTheDocument();
    });

    it('shows what is there', async () => {
      listing([lead('Priya Kapoor', { organisationName: 'Kapoor Trading', source: 'referral' })]);

      renderPage(<LeadsPage />, { path: '/crm/leads' });

      expect(await screen.findByText('Priya Kapoor')).toBeInTheDocument();
      expect(screen.getByText('Kapoor Trading')).toBeInTheDocument();
      // A cell, specifically — "Referral" is also an option in the source filter beside it.
      expect(screen.getByRole('cell', { name: 'Referral' })).toBeInTheDocument();
    });

    it('asks the server to sort when a column heading is clicked', async () => {
      const asked: string[] = [];
      server.use(
        http.get(LEAD_PATHS.leads, ({ request }) => {
          asked.push(new URL(request.url).search);
          return HttpResponse.json(page([lead('Priya Kapoor')]));
        }),
      );

      const { user } = renderPage(<LeadsPage />, { path: '/crm/leads' });
      await screen.findByText('Priya Kapoor');

      await user.click(screen.getByRole('button', { name: /^name$/i }));
      await waitFor(() => expect(asked.at(-1)).toContain('sort=name'));
    });
  });

  describe('adding a lead', () => {
    it('creates one and refreshes the list', async () => {
      signedInWith();
      let sent: unknown;
      let created = false;

      server.use(
        http.get(LEAD_PATHS.leads, () =>
          HttpResponse.json(created ? page([lead('Priya Kapoor')]) : page([])),
        ),
        http.post(LEAD_PATHS.leads, async ({ request }) => {
          sent = await request.json();
          created = true;
          return HttpResponse.json(lead('Priya Kapoor'), { status: 201 });
        }),
        http.get(LEAD_PATHS.lead('id-priya-kapoor'), () => HttpResponse.json(lead('Priya Kapoor'))),
        // Adding a lead opens its detail panel, which resolves an assignee picker and a
        // qualify-by-linking list — neither is what this test is about.
        http.get(IDENTITY_PATHS.users, () =>
          HttpResponse.json({ items: [], page: { number: 1, size: 200, total: 0, pages: 0 } } satisfies UserListResponse),
        ),
        http.get(PARTY_PATHS.parties, () =>
          HttpResponse.json({ items: [], page: { number: 1, size: 100, total: 0, pages: 0 } } satisfies PartyListResponse),
        ),
      );

      const { user } = renderPage(<LeadsPage />, { token: 'a-token', path: '/crm/leads' });
      await screen.findByText(/no leads yet/i);

      await user.type(screen.getByLabelText(/^name$/i), 'Priya Kapoor');
      await user.click(screen.getByRole('button', { name: /add lead/i }));

      await waitFor(() => expect(sent).toEqual({ name: 'Priya Kapoor', source: 'referral' }));
      expect(await screen.findByRole('cell', { name: 'Priya Kapoor' })).toBeInTheDocument();
    });

    it('puts a server message beside the input it belongs to', async () => {
      signedInWith();
      server.use(
        http.get(LEAD_PATHS.leads, () => HttpResponse.json(page([]))),
        http.post(LEAD_PATHS.leads, () =>
          HttpResponse.json(
            {
              code: 'validation_failed',
              message: 'Some of the details you entered need attention.',
              fields: { name: "Enter the lead's name." },
            },
            { status: 422 },
          ),
        ),
      );

      const { user } = renderPage(<LeadsPage />, { token: 'a-token', path: '/crm/leads' });
      await screen.findByText(/no leads yet/i);

      await user.click(screen.getByRole('button', { name: /add lead/i }));

      const name = await screen.findByLabelText(/^name$/i);
      expect(name).toHaveAttribute('aria-invalid', 'true');
      expect(name).toHaveAccessibleDescription(/enter the lead/i);
    });

    it('hides the form from a colleague without crm:leads:write', async () => {
      signedInWith([]);
      listing([lead('Priya Kapoor')]);

      renderPage(<LeadsPage />, { token: 'a-token', path: '/crm/leads' });
      await screen.findByText('Priya Kapoor');

      expect(screen.queryByRole('button', { name: /add lead/i })).not.toBeInTheDocument();
    });
  });

  describe('the lead detail panel', () => {
    function openPanel(initial: LeadSummary): { current: () => LeadResponse } {
      let current = initial;
      // Mirrors the real backend's own round-trip: the status held at the moment of
      // disqualifying is stored, not guessed, so `reopen` can restore it exactly.
      let priorStatus: LeadSummary['status'] | undefined;

      server.use(
        http.get(LEAD_PATHS.leads, () => HttpResponse.json(page([current]))),
        http.get(LEAD_PATHS.lead(initial.id), () => HttpResponse.json(current)),
        http.patch(LEAD_PATHS.lead(initial.id), async ({ request }) => {
          const body = (await request.json()) as Partial<LeadSummary>;
          current = { ...current, ...body };
          return HttpResponse.json(current);
        }),
        http.post(LEAD_PATHS.disqualify(initial.id), () => {
          priorStatus = current.status;
          current = { ...current, status: 'disqualified' };
          return HttpResponse.json(current);
        }),
        http.post(LEAD_PATHS.reopen(initial.id), () => {
          current = { ...current, status: priorStatus ?? 'new' };
          return HttpResponse.json(current);
        }),
        http.get(IDENTITY_PATHS.users, () =>
          HttpResponse.json({ items: [], page: { number: 1, size: 200, total: 0, pages: 0 } } satisfies UserListResponse),
        ),
        http.get(PARTY_PATHS.parties, () =>
          HttpResponse.json({ items: [], page: { number: 1, size: 100, total: 0, pages: 0 } } satisfies PartyListResponse),
        ),
      );

      return { current: () => current };
    }

    it('marks a new lead contacted, then disqualifies and reopens it — restoring contacted, not new', async () => {
      signedInWith();
      openPanel(lead('Priya Kapoor'));

      const { user } = renderPage(<LeadsPage />, { token: 'a-token', path: '/crm/leads' });
      await user.click(await screen.findByRole('button', { name: 'Priya Kapoor' }));

      // Scoped to the detail panel: the list row behind it repeats the status in its own
      // column, which is a second match for the same text rather than a different question.
      const panel = () => within(screen.getByRole('region', { name: 'Priya Kapoor' }));

      await user.click(await screen.findByRole('button', { name: /mark contacted/i }));
      await waitFor(() => expect(panel().getByText(/^Contacted/)).toBeInTheDocument());

      await user.click(panel().getByRole('button', { name: /disqualify/i }));
      await waitFor(() => expect(panel().getByText(/^Disqualified/)).toBeInTheDocument());

      await user.click(panel().getByRole('button', { name: /reopen/i }));

      // Restored to 'contacted', which disqualifying interrupted — not reset to 'new'.
      await waitFor(() => expect(panel().getByText(/^Contacted/)).toBeInTheDocument());
    });

    it('qualifies by creating a new party, then tags it prospect as a second call', async () => {
      signedInWith();
      openPanel(lead('Priya Kapoor', { organisationName: 'Kapoor Trading' }));

      const createdParty = party('new-party-1', 'Kapoor Trading');
      const calls: string[] = [];

      server.use(
        http.post(PARTY_PATHS.parties, async ({ request }) => {
          calls.push('create-party');
          const body = await request.json();
          expect(body).toMatchObject({ kind: 'organisation', name: 'Kapoor Trading' });
          return HttpResponse.json(createdParty, { status: 201 });
        }),
        http.post(LEAD_PATHS.qualify('id-priya-kapoor'), async ({ request }) => {
          calls.push('qualify');
          const body = await request.json();
          expect(body).toEqual({ action: 'create', partyId: createdParty.id });
          return HttpResponse.json(
            { ...lead('Priya Kapoor'), status: 'qualified', partyId: createdParty.id },
            { status: 200 },
          );
        }),
        http.post(PARTY_PATHS.partyRoles(createdParty.id), async ({ request }) => {
          calls.push('tag-prospect');
          const body = await request.json();
          expect(body).toEqual({ role: 'prospect' });
          return HttpResponse.json(createdParty);
        }),
      );

      const { user } = renderPage(<LeadsPage />, { token: 'a-token', path: '/crm/leads' });
      await user.click(await screen.findByRole('button', { name: 'Priya Kapoor' }));

      await screen.findByText(/qualify this lead/i);
      await user.click(screen.getByRole('button', { name: /^qualify$/i }));

      // The order matters: crm is only ever handed a partyId that already exists, and the
      // role tag happens strictly after crm has confirmed the qualify — never before it, and
      // never as part of the same request.
      await waitFor(() => expect(calls).toEqual(['create-party', 'qualify', 'tag-prospect']));
      expect(await screen.findByText(/^qualified/i)).toBeInTheDocument();
    });

    it('qualifies by linking an existing party, without ever calling POST /api/parties', async () => {
      signedInWith();
      openPanel(lead('Priya Kapoor'));

      const existing = party('existing-1', 'Existing Trading Co');
      let createPartyCalled = false;
      const calls: string[] = [];

      server.use(
        http.get(PARTY_PATHS.parties, () =>
          HttpResponse.json({
            items: [existing as unknown as PartySummary],
            page: { number: 1, size: 100, total: 1, pages: 1 },
          } satisfies PartyListResponse),
        ),
        http.post(PARTY_PATHS.parties, () => {
          createPartyCalled = true;
          return HttpResponse.json(existing, { status: 201 });
        }),
        http.post(LEAD_PATHS.qualify('id-priya-kapoor'), async ({ request }) => {
          calls.push('qualify');
          const body = await request.json();
          expect(body).toEqual({ action: 'link', partyId: existing.id });
          return HttpResponse.json(
            { ...lead('Priya Kapoor'), status: 'qualified', partyId: existing.id },
            { status: 200 },
          );
        }),
        http.post(PARTY_PATHS.partyRoles(existing.id), async ({ request }) => {
          calls.push('tag-prospect');
          const body = await request.json();
          expect(body).toEqual({ role: 'prospect' });
          return HttpResponse.json(existing);
        }),
      );

      const { user } = renderPage(<LeadsPage />, { token: 'a-token', path: '/crm/leads' });
      await user.click(await screen.findByRole('button', { name: 'Priya Kapoor' }));

      await screen.findByText(/qualify this lead/i);
      await user.click(screen.getByRole('radio', { name: /link an existing party/i }));
      await user.selectOptions(screen.getByLabelText(/^party$/i), existing.id);
      await user.click(screen.getByRole('button', { name: /^qualify$/i }));

      await waitFor(() => expect(calls).toEqual(['qualify', 'tag-prospect']));
      expect(createPartyCalled).toBe(false);
    });
  });
});
