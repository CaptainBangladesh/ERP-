import { describe, expect, it, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import {
  ACTIVITY_PATHS,
  IDENTITY_PATHS,
  LEAD_FIELD_PATHS,
  LEAD_PATHS,
  LEAD_SOURCE_PATHS,
  LEAD_STATUS_LABEL_PATHS,
  type ActivitySummary,
  type LeadListResponse,
  type LeadSummary,
} from '@erp/shared';
import { server } from '../../../test/server';
import { renderPage, signedInWith } from '../../../test/render';
import { LeadWorkspace } from './LeadWorkspace';

describe('LeadWorkspace', () => {
  const WORKSPACE_PATH = '/crm/leads/id-priya-kapoor';

  /** A board that renamed one built-in status and added a settable stage of its own. */
  const STATUS_LABELS = [
    { status: 'new', label: 'New', color: '#579bfc', isCustom: false, order: 0, isSettable: true },
    { status: 'contacted', label: 'Contacted', color: '#9d5bf0', isCustom: false, order: 1, isSettable: true },
    { status: 'qualified', label: 'Qualified', color: '#00c875', isCustom: false, order: 2, isSettable: false },
    { status: 'disqualified', label: 'Disqualified', color: '#e2445c', isCustom: false, order: 3, isSettable: false },
    { status: 'in-negotiation', label: 'In negotiation', color: '#fdab3d', isCustom: true, order: 4, isSettable: true },
  ];

  function lead(name: string, overrides: Partial<LeadSummary> = {}): LeadSummary {
    return {
      id: `id-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      name,
      organisationName: null,
      email: null,
      phone: null,
      status: 'new',
      source: 'inbound',
      assignedToUserId: null,
      partyId: null,
      groupId: 'group-1',
      sourceId: null,
      customValues: {},
      sourceName: null,
      groupName: 'New Leads',
      ...overrides,
    };
  }

  function page(items: LeadSummary[]): LeadListResponse {
    return { items, page: { number: 1, size: 100, total: items.length, pages: 1 } };
  }

  function activity(overrides: Partial<ActivitySummary> = {}): ActivitySummary {
    return {
      id: `act-${Math.random().toString(36).slice(2)}`,
      type: 'note',
      notes: 'A note',
      occurredAt: '2026-08-30T09:00:00.000Z',
      dueAt: null,
      completedAt: null,
      createdByUserId: 'u1',
      createdByName: 'Ada Okafor',
      leadId: 'id-priya-kapoor',
      dealId: null,
      partyId: null,
      createdAt: '2026-08-30T09:00:00.000Z',
      ...overrides,
    };
  }

  const priya = () =>
    lead('Priya Kapoor', {
      organisationName: 'Kapoor Trading',
      email: 'priya@kapoor.example',
      phone: '01711000000',
      sourceName: 'Referral',
      assignedToUserId: 'u1',
      customValues: { priority: 'hot', budget: '50k' },
    });

  beforeEach(() => {
    window.localStorage.clear();
    signedInWith();
    server.use(
      http.get(LEAD_PATHS.lead('id-priya-kapoor'), () => HttpResponse.json(priya())),
      http.get(LEAD_PATHS.leads, () => HttpResponse.json(page([priya()]))),
      http.get(LEAD_STATUS_LABEL_PATHS.labels, () => HttpResponse.json({ items: STATUS_LABELS })),
      http.get(LEAD_SOURCE_PATHS.leadSources, () => HttpResponse.json({ items: [] })),
      http.get(LEAD_FIELD_PATHS.leadFields, () =>
        HttpResponse.json({
          items: [
            { id: 'f-budget', key: 'budget', label: 'Budget', type: 'text', required: false, order: 1, options: [], archivedAt: null },
          ],
        }),
      ),
      http.get(IDENTITY_PATHS.users, () =>
        HttpResponse.json({
          items: [{ id: 'u1', name: 'Ada Okafor', email: 'ada@northwind.test', roles: [] }],
          page: { number: 1, size: 200, total: 1, pages: 1 },
        }),
      ),
      http.get(ACTIVITY_PATHS.leadActivities('id-priya-kapoor'), () => HttpResponse.json({ items: [] })),
    );
  });

  it('shows the lead on its own full page, with a Hot priority badge in the header', async () => {
    renderPage(<LeadWorkspace />, { token: 'a-token', path: WORKSPACE_PATH });

    const workspace = await screen.findByRole('region', { name: 'Priya Kapoor' });
    expect(within(workspace).getByRole('heading', { name: 'Priya Kapoor' })).toBeInTheDocument();
    // Priority is a display-only custom field (ADR 0010) — 'hot' maps to a Hot badge.
    expect(within(workspace).getAllByText('Hot').length).toBeGreaterThan(0);
  });

  it('gathers every lead detail in one place on the Details tab', async () => {
    const { user } = renderPage(<LeadWorkspace />, { token: 'a-token', path: WORKSPACE_PATH });

    await user.click(await screen.findByRole('button', { name: 'Details' }));

    const details = within(await screen.findByRole('region', { name: 'Lead details' }));
    expect(details.getByText('priya@kapoor.example')).toBeInTheDocument();
    expect(details.getByText('01711000000')).toBeInTheDocument();
    expect(details.getByText('Referral')).toBeInTheDocument();
    expect(details.getByText('Ada Okafor')).toBeInTheDocument();
    // The custom field and its value both appear.
    expect(details.getByText('Budget')).toBeInTheDocument();
    expect(details.getByText('50k')).toBeInTheDocument();
  });

  describe('the worklist', () => {
    it('lists leads with name, organisation, status and priority, and filters by name', async () => {
      server.use(
        http.get(LEAD_PATHS.leads, () =>
          HttpResponse.json(
            page([
              priya(),
              lead('Imran Ali', { status: 'contacted', customValues: { priority: 'cold' } }),
            ]),
          ),
        ),
      );

      const { user } = renderPage(<LeadWorkspace />, { token: 'a-token', path: WORKSPACE_PATH });

      const worklist = await screen.findByRole('complementary', { name: 'Worklist' });
      expect(within(worklist).getByText('Priya Kapoor')).toBeInTheDocument();
      expect(within(worklist).getByText('Kapoor Trading')).toBeInTheDocument();
      expect(within(worklist).getByText('Imran Ali')).toBeInTheDocument();
      expect(within(worklist).getByText('Cold')).toBeInTheDocument();

      await user.type(within(worklist).getByRole('searchbox', { name: 'Search the worklist' }), 'Imran');

      await waitFor(() => expect(within(worklist).queryByText('Priya Kapoor')).not.toBeInTheDocument());
      expect(within(worklist).getByText('Imran Ali')).toBeInTheDocument();
    });

    it('collapses so the centre can fill the space', async () => {
      const { user } = renderPage(<LeadWorkspace />, { token: 'a-token', path: WORKSPACE_PATH });

      await user.click(await screen.findByRole('button', { name: 'Collapse worklist' }));

      expect(screen.queryByRole('complementary', { name: 'Worklist' })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Expand worklist' })).toBeInTheDocument();
    });

    it('moves to another lead by clicking its worklist card', async () => {
      server.use(
        http.get(LEAD_PATHS.leads, () =>
          HttpResponse.json(page([priya(), lead('Imran Ali')])),
        ),
      );

      const { user } = renderPage(<LeadWorkspace />, { token: 'a-token', path: WORKSPACE_PATH });

      const worklist = await screen.findByRole('complementary', { name: 'Worklist' });
      await user.click(within(worklist).getByText('Imran Ali'));

      expect(window.location.pathname).toBe('/crm/leads/id-imran-ali');
    });
  });

  describe('the status stepper', () => {
    it('renders the company’s settable statuses in order, including a custom one', async () => {
      renderPage(<LeadWorkspace />, { token: 'a-token', path: WORKSPACE_PATH });

      await screen.findByRole('region', { name: 'Priya Kapoor' });

      const stepper = within(screen.getByRole('group', { name: 'Status pipeline' }));
      expect(stepper.getByRole('button', { name: 'New' })).toHaveAttribute('aria-current', 'step');
      expect(stepper.getByRole('button', { name: 'Contacted' })).toBeInTheDocument();
      expect(stepper.getByRole('button', { name: 'In negotiation' })).toBeInTheDocument();
      // Qualify and Disqualify are the terminal actions, set apart from the ordinary steps.
      expect(stepper.getByRole('button', { name: 'Qualify' })).toBeInTheDocument();
      expect(stepper.getByRole('button', { name: 'Disqualify' })).toBeInTheDocument();
    });

    it('advances the status by clicking the next step', async () => {
      let sent: unknown;
      server.use(
        http.patch(LEAD_PATHS.lead('id-priya-kapoor'), async ({ request }) => {
          sent = await request.json();
          return HttpResponse.json({ ...priya(), status: 'contacted' });
        }),
      );

      const { user } = renderPage(<LeadWorkspace />, { token: 'a-token', path: WORKSPACE_PATH });

      await user.click(await screen.findByRole('button', { name: 'Contacted' }));

      await waitFor(() => expect(sent).toEqual({ status: 'contacted' }));
    });

    it('disqualifies through the terminal action', async () => {
      let called = false;
      server.use(
        http.post(LEAD_PATHS.disqualify('id-priya-kapoor'), () => {
          called = true;
          return HttpResponse.json({ ...priya(), status: 'disqualified' });
        }),
      );

      const { user } = renderPage(<LeadWorkspace />, { token: 'a-token', path: WORKSPACE_PATH });

      await user.click(await screen.findByRole('button', { name: 'Disqualify' }));

      await waitFor(() => expect(called).toBe(true));
    });
  });

  describe('the Activity feed', () => {
    function withActivities(items: ActivitySummary[]) {
      server.use(http.get(ACTIVITY_PATHS.leadActivities('id-priya-kapoor'), () => HttpResponse.json({ items })));
    }

    it('interleaves person activities and system audit events, and filters between them', async () => {
      withActivities([
        activity({ id: 'a1', type: 'call', notes: 'Called and left a voicemail' }),
        activity({ id: 'a2', type: 'note', notes: '📝 Survey response received' }),
        activity({ id: 'a3', type: 'email', notes: 'Sent the intro email' }),
      ]);

      const { user } = renderPage(<LeadWorkspace />, { token: 'a-token', path: WORKSPACE_PATH });

      expect(await screen.findByText('Called and left a voicemail')).toBeInTheDocument();
      expect(screen.getByText('📝 Survey response received')).toBeInTheDocument();
      expect(screen.getByText('Sent the intro email')).toBeInTheDocument();

      await user.click(screen.getByRole('tab', { name: 'System' }));
      expect(screen.getByText('📝 Survey response received')).toBeInTheDocument();
      expect(screen.queryByText('Called and left a voicemail')).not.toBeInTheDocument();

      await user.click(screen.getByRole('tab', { name: 'Notes' }));
      expect(screen.getByText('Called and left a voicemail')).toBeInTheDocument();
      expect(screen.queryByText('📝 Survey response received')).not.toBeInTheDocument();
      expect(screen.queryByText('Sent the intro email')).not.toBeInTheDocument();
    });

    it('logs a note from the pinned composer', async () => {
      let sent: unknown;
      server.use(
        http.post(ACTIVITY_PATHS.activities, async ({ request }) => {
          sent = await request.json();
          return HttpResponse.json(activity({ notes: 'Left a message with reception' }));
        }),
      );

      const { user } = renderPage(<LeadWorkspace />, { token: 'a-token', path: WORKSPACE_PATH });

      await user.type(
        await screen.findByRole('textbox', { name: 'Activity notes' }),
        'Left a message with reception',
      );
      await user.click(screen.getByRole('button', { name: 'Log activity' }));

      await waitFor(() =>
        expect(sent).toEqual({ type: 'note', notes: 'Left a message with reception', leadId: 'id-priya-kapoor' }),
      );
    });
  });

  describe('the Next-step rail', () => {
    it('surfaces a pending task with one-tap complete', async () => {
      server.use(
        http.get(ACTIVITY_PATHS.leadActivities('id-priya-kapoor'), () =>
          HttpResponse.json({ items: [activity({ id: 't1', type: 'task', notes: 'Follow up on Tuesday' })] }),
        ),
      );
      let completed = false;
      server.use(
        http.post(ACTIVITY_PATHS.completeTask('t1'), () => {
          completed = true;
          return HttpResponse.json(activity({ id: 't1', type: 'task', notes: 'Follow up on Tuesday', completedAt: '2026-08-31T00:00:00.000Z' }));
        }),
      );

      const { user } = renderPage(<LeadWorkspace />, { token: 'a-token', path: WORKSPACE_PATH });

      const rail = await screen.findByRole('complementary', { name: 'Next step' });
      expect(await within(rail).findByText('Follow up on Tuesday')).toBeInTheDocument();

      await user.click(within(rail).getByRole('button', { name: 'Mark done' }));
      await waitFor(() => expect(completed).toBe(true));
    });

    it('offers Qualify as the next step when nothing is pending, and shows what we know', async () => {
      const { user } = renderPage(<LeadWorkspace />, { token: 'a-token', path: WORKSPACE_PATH });

      const rail = await screen.findByRole('complementary', { name: 'Next step' });
      expect(within(rail).getByRole('button', { name: 'Qualify' })).toBeInTheDocument();
      // "What we know": the source and priority, without opening a tab.
      expect(within(rail).getByText('Referral')).toBeInTheDocument();
      expect(within(rail).getByText('Hot')).toBeInTheDocument();

      // The rail's Qualify opens the convert flow rather than writing a status directly.
      await user.click(within(rail).getByRole('button', { name: 'Qualify' }));
      expect(await screen.findByRole('heading', { name: /move .* to contacts/i })).toBeInTheDocument();
    });
  });

  it('returns the same not-found for a lead in another company as for one that does not exist', async () => {
    server.use(
      http.get(LEAD_PATHS.lead('id-priya-kapoor'), () =>
        HttpResponse.json({ code: 'lead_not_found', message: 'That lead could not be found.' }, { status: 404 }),
      ),
    );

    renderPage(<LeadWorkspace />, { token: 'a-token', path: WORKSPACE_PATH });

    expect(await screen.findByText(/could not be found/i)).toBeInTheDocument();
    expect(screen.queryByRole('complementary', { name: 'Worklist' })).not.toBeInTheDocument();
  });
});
