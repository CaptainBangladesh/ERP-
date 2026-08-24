import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import {
  DEAL_PATHS,
  IDENTITY_PATHS,
  PARTY_PATHS,
  STAGE_PATHS,
  type DealListResponse,
  type DealSummary,
  type PartyListResponse,
  type StageListResponse,
  type StageResponse,
  type StageSummary,
  type UserListResponse,
} from '@erp/shared';
import { renderPage, signedInWith } from '../../../test/render';
import { server } from '../../../test/server';
import { DealsPage } from './DealsPage';

/**
 * The deals board from the user's side.
 *
 * Covers the empty state (a fresh company has zero stages, and nothing here is seeded), the
 * board rendering stages as columns and deals as cards, the "edit labels" affordance (add,
 * rename, reorder, mark won/lost), and creating a deal — the assignment and party pickers are
 * both a second, composed call, the same discipline `LeadDetail.test.tsx` already covers.
 */
describe('DealsPage', () => {
  function stage(id: string, name: string, order: number, outcome: 'won' | 'lost' | null = null): StageSummary {
    return { id, name, order, outcome };
  }

  function deal(id: string, name: string, stageId: string, partyId: string, amount = '10000.00'): DealSummary {
    return {
      id,
      name,
      stageId,
      partyId,
      stageOutcome: null,
      amount: { amount, currency: 'GBP' },
      expectedCloseDate: '2026-12-31',
      assignedToUserId: null,
      originLeadId: null,
    };
  }

  function stagePage(items: StageSummary[]): StageListResponse {
    return { items, page: { number: 1, size: 200, total: items.length, pages: 1 } };
  }

  function dealPage(items: DealSummary[]): DealListResponse {
    return { items, page: { number: 1, size: 200, total: items.length, pages: 1 } };
  }

  function setupMocks(stages: StageSummary[] = [], deals: DealSummary[] = []) {
    server.use(
      http.get(STAGE_PATHS.stages, () => HttpResponse.json(stagePage(stages))),
      http.get(DEAL_PATHS.deals, () => HttpResponse.json(dealPage(deals))),
      http.get(PARTY_PATHS.parties, () =>
        HttpResponse.json({
          items: [
            {
              id: 'party-1',
              kind: 'organisation',
              name: 'Kapoor Trading',
              email: null,
              phone: null,
              status: 'active',
              roles: [],
              organisationId: null,
              organisationName: null,
              mergedIntoId: null,
            },
          ],
          page: { number: 1, size: 200, total: 1, pages: 1 },
        } satisfies PartyListResponse),
      ),
      http.get(IDENTITY_PATHS.users, () =>
        HttpResponse.json({
          items: [{ id: 'user-1', name: 'Ada Okafor', email: 'ada@northwind.test', isOwner: false, roles: [] }],
          page: { number: 1, size: 200, total: 1, pages: 1 },
        } satisfies UserListResponse),
      ),
    );
  }

  it('guides the first action rather than showing an empty board', async () => {
    signedInWith();
    setupMocks([], []);

    renderPage(<DealsPage />, { token: 'a-token', path: '/crm/deals' });

    expect(await screen.findByText(/create your first stage/i)).toBeInTheDocument();
  });

  it('renders stages as columns, deals as cards, and totals a column exactly', async () => {
    signedInWith();
    const discovery = stage('stage-1', 'Discovery', 1);
    const won = stage('stage-2', 'Won', 2, 'won');
    setupMocks([discovery, won], [deal('deal-1', 'Big Enterprise Contract', 'stage-1', 'party-1', '25000.00')]);

    renderPage(<DealsPage />, { token: 'a-token', path: '/crm/deals' });

    const discoveryColumn = await screen.findByRole('region', { name: 'Discovery' });
    expect(within(discoveryColumn).getByText('Big Enterprise Contract')).toBeInTheDocument();
    // The card's amount and the column's total both read the same exact figure — summed as
    // Money, not as a floating-point number.
    expect(within(discoveryColumn).getAllByText(/25,000\.00/)).toHaveLength(2);

    const wonColumn = screen.getByRole('region', { name: 'Won' });
    expect(within(wonColumn).getAllByText('Won').length).toBeGreaterThan(0);
  });

  it('has an empty state per column when a stage holds no deals', async () => {
    signedInWith();
    setupMocks([stage('stage-1', 'Discovery', 1)], []);

    renderPage(<DealsPage />, { token: 'a-token', path: '/crm/deals' });

    expect(await screen.findByText(/no deals here/i)).toBeInTheDocument();
  });

  describe('editing labels', () => {
    it('adds a stage', async () => {
      signedInWith();
      setupMocks([stage('stage-1', 'Discovery', 1)], []);

      let created: unknown;
      server.use(
        http.post(STAGE_PATHS.stages, async ({ request }) => {
          created = await request.json();
          return HttpResponse.json(stage('stage-2', 'Proposal Sent', 2) satisfies StageResponse, { status: 201 });
        }),
      );

      const { user } = renderPage(<DealsPage />, { token: 'a-token', path: '/crm/deals' });
      await screen.findByRole('region', { name: 'Discovery' });

      await user.click(screen.getByRole('button', { name: /edit labels/i }));
      await user.type(screen.getByLabelText(/^name$/i), 'Proposal Sent');
      await user.click(screen.getByRole('button', { name: /^add stage$/i }));

      await waitFor(() => expect(created).toEqual({ name: 'Proposal Sent' }));
    });

    it('renames a stage in place', async () => {
      signedInWith();
      setupMocks([stage('stage-1', 'Discovery', 1)], []);

      let sent: unknown;
      server.use(
        http.patch(STAGE_PATHS.stage('stage-1'), async ({ request }) => {
          sent = await request.json();
          return HttpResponse.json(stage('stage-1', 'Qualifying', 1) satisfies StageResponse);
        }),
      );

      const { user } = renderPage(<DealsPage />, { token: 'a-token', path: '/crm/deals' });
      await screen.findByRole('region', { name: 'Discovery' });

      await user.click(screen.getByRole('button', { name: /edit labels/i }));
      await user.click(screen.getByRole('button', { name: 'Discovery' }));
      const nameBoxes = screen.getAllByLabelText(/^name$/i);
      const nameBox = nameBoxes[0]!;
      await user.clear(nameBox);
      await user.type(nameBox, 'Qualifying');
      await user.click(screen.getByRole('button', { name: /save/i }));

      await waitFor(() => expect(sent).toEqual({ name: 'Qualifying' }));
    });

    it('moves a stage down, sending its new position rather than a raw column value', async () => {
      signedInWith();
      setupMocks([stage('stage-1', 'Discovery', 1), stage('stage-2', 'Proposal', 2)], []);

      let sent: unknown;
      server.use(
        http.patch(STAGE_PATHS.stage('stage-1'), async ({ request }) => {
          sent = await request.json();
          return HttpResponse.json(stage('stage-1', 'Discovery', 2) satisfies StageResponse);
        }),
      );

      const { user } = renderPage(<DealsPage />, { token: 'a-token', path: '/crm/deals' });
      await screen.findByRole('region', { name: 'Discovery' });

      await user.click(screen.getByRole('button', { name: /edit labels/i }));
      await user.click(screen.getByRole('button', { name: /move discovery down/i }));

      await waitFor(() => expect(sent).toEqual({ order: 2 }));
    });

    it('marks a stage won', async () => {
      signedInWith();
      setupMocks([stage('stage-1', 'Discovery', 1)], []);

      let sent: unknown;
      server.use(
        http.patch(STAGE_PATHS.stage('stage-1'), async ({ request }) => {
          sent = await request.json();
          return HttpResponse.json(stage('stage-1', 'Discovery', 1, 'won') satisfies StageResponse);
        }),
      );

      const { user } = renderPage(<DealsPage />, { token: 'a-token', path: '/crm/deals' });
      await screen.findByRole('region', { name: 'Discovery' });

      await user.click(screen.getByRole('button', { name: /edit labels/i }));
      await user.click(screen.getByRole('button', { name: /mark won/i }));

      await waitFor(() => expect(sent).toEqual({ outcome: 'won' }));
    });

    it('deletes a stage', async () => {
      signedInWith();
      setupMocks([stage('stage-1', 'Discovery', 1)], []);

      let deleted = false;
      server.use(
        http.delete(STAGE_PATHS.stage('stage-1'), () => {
          deleted = true;
          return new HttpResponse(null, { status: 204 });
        }),
      );

      const { user } = renderPage(<DealsPage />, { token: 'a-token', path: '/crm/deals' });
      await screen.findByRole('region', { name: 'Discovery' });

      await user.click(screen.getByRole('button', { name: /edit labels/i }));
      await user.click(screen.getByRole('button', { name: /^delete$/i }));

      await waitFor(() => expect(deleted).toBe(true));
    });
  });

  describe('adding a deal', () => {
    it('creates one against a chosen party and stage', async () => {
      signedInWith();
      setupMocks([stage('stage-1', 'Discovery', 1)], []);

      let sent: unknown;
      let dealsList: DealSummary[] = [];
      server.use(
        http.get(DEAL_PATHS.deals, () => HttpResponse.json(dealPage(dealsList))),
        http.post(DEAL_PATHS.deals, async ({ request }) => {
          sent = await request.json();
          const created = deal('deal-new', 'New SaaS Deal', 'stage-1', 'party-1', '1000.00');
          dealsList = [created];
          return HttpResponse.json(created, { status: 201 });
        }),
      );

      const { user } = renderPage(<DealsPage />, { token: 'a-token', path: '/crm/deals' });
      await screen.findByRole('region', { name: 'Discovery' });

      await user.click(screen.getByRole('button', { name: /add deal/i }));
      await user.type(screen.getByLabelText(/^name$/i), 'New SaaS Deal');
      await user.selectOptions(screen.getByLabelText(/^party$/i), 'party-1');
      await user.type(screen.getByLabelText(/^amount$/i), '1000.00');
      await user.click(screen.getByRole('button', { name: /create deal/i }));

      await waitFor(() =>
        expect(sent).toEqual({ name: 'New SaaS Deal', partyId: 'party-1', stageId: 'stage-1', amount: '1000.00' }),
      );
      expect(await screen.findByText('New SaaS Deal')).toBeInTheDocument();
    });

    it('is not offered while the company has zero stages', async () => {
      signedInWith();
      setupMocks([], []);

      renderPage(<DealsPage />, { token: 'a-token', path: '/crm/deals' });
      await screen.findByText(/create your first stage/i);

      expect(screen.queryByRole('button', { name: /add deal/i })).not.toBeInTheDocument();
    });
  });

  describe('moving a deal between stages', () => {
    it('sends the target stageId as an ordinary PATCH', async () => {
      signedInWith();
      const discovery = stage('stage-1', 'Discovery', 1);
      const won = stage('stage-2', 'Won', 2, 'won');
      setupMocks([discovery, won], [deal('deal-1', 'Big Enterprise Contract', 'stage-1', 'party-1')]);

      let sent: unknown;
      server.use(
        http.patch(DEAL_PATHS.deal('deal-1'), async ({ request }) => {
          sent = await request.json();
          return HttpResponse.json({
            ...deal('deal-1', 'Big Enterprise Contract', 'stage-2', 'party-1'),
            stageOutcome: 'won',
          });
        }),
      );

      const { user } = renderPage(<DealsPage />, { token: 'a-token', path: '/crm/deals' });
      const discoveryColumn = await screen.findByRole('region', { name: 'Discovery' });

      await user.selectOptions(within(discoveryColumn).getByLabelText(/^stage$/i), 'stage-2');

      await waitFor(() => expect(sent).toEqual({ stageId: 'stage-2' }));
    });
  });
});
