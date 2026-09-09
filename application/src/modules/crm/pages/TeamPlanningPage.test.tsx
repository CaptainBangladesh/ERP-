import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import {
  ACTIVITY_PATHS,
  APPROACH_PLAN_PATHS,
  IDENTITY_PATHS,
  LEAD_PATHS,
  LEAD_STATUS_LABEL_PATHS,
  PLANNER_NOTE_PATHS,
  PLANNING_PATHS,
  PLAYBOOK_PATHS,
  SCRIPT_PATHS,
  TEAM_PLAN_PATHS,
  type ActivityFeedResponse,
  type ApproachPlanResponse,
  type LeadListResponse,
  type LeadStatusLabelListResponse,
  type PlannerNoteResponse,
  type PlanningCoordinationResponse,
  type PlanningHeatmapResponse,
  type PlanningScheduleResponse,
  type PlaybookListResponse,
  type ScriptListResponse,
  type TeamPlanResponse,
  type UserListResponse,
} from '@erp/shared';
import { renderPage, signedInWith } from '../../../test/render';
import { server } from '../../../test/server';
import { TeamPlanningPage } from './TeamPlanningPage';

/**
 * The Sales Planning Hub workspace:
 * 1. 📌 Strategy Whiteboard: sticky-note cards (Angle, Objections, Next Step, Turn into Task)
 * 2. 📅 My Tasks & Agenda: personal open tasks & scratchpad
 * 3. 👥 Team Load & Calendar: schedule calendar (5-day workweek & 7-day views, unbounded stepping),
 *    activity heatmap, and coordination view
 * 4. 📋 Team Plan & Playbooks: shared plan and guidance library
 */
describe('TeamPlanningPage', () => {
  const today = new Date();
  const todayIso = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 12, 0, 0).toISOString();
  const todayKey = today.toISOString().slice(0, 10);

  function setupMocks() {
    server.use(
      http.get(IDENTITY_PATHS.users, () =>
        HttpResponse.json({
          items: [
            { id: 'user-1', name: 'Ada Okafor', email: 'ada@northwind.test', isOwner: true, roles: [] },
            { id: 'user-2', name: 'Bo Rivera', email: 'bo@northwind.test', isOwner: false, roles: [] },
          ],
          page: { number: 1, size: 200, total: 2, pages: 1 },
        } satisfies UserListResponse),
      ),
      http.get(LEAD_PATHS.leads, () =>
        HttpResponse.json({
          items: [
            {
              id: 'lead-1',
              name: 'Kapoor Trading',
              organisationName: 'Kapoor Group',
              email: 'info@kapoor.test',
              phone: '+44 20 7946 0991',
              source: 'referral',
              sourceId: null,
              groupId: null,
              status: 'contacted',
              assignedToUserId: 'user-1',
              assigneeUserIds: ['user-1', 'user-2'],
              partyId: null,
            },
            {
              id: 'lead-2',
              name: 'Rahman Textiles',
              organisationName: null,
              email: null,
              phone: null,
              source: 'referral',
              sourceId: null,
              groupId: null,
              status: 'processing',
              assignedToUserId: 'user-2',
              assigneeUserIds: ['user-2'],
              partyId: null,
            },
          ],
          page: { number: 1, size: 100, total: 2, pages: 1 },
        } satisfies LeadListResponse),
      ),
      http.get(LEAD_STATUS_LABEL_PATHS.labels, () =>
        HttpResponse.json({
          items: [
            { status: 'new', label: 'New', color: '#579bfc', isCustom: false, order: 0, isSettable: true },
            { status: 'processing', label: 'Processing', color: '#fdab3d', isCustom: true, order: 1, isSettable: true },
            { status: 'contacted', label: 'In Progress', color: '#9d5bf0', isCustom: false, order: 2, isSettable: true },
            { status: 'qualified', label: 'Qualified', color: '#00c875', isCustom: false, order: 3, isSettable: false },
            { status: 'disqualified', label: 'Disqualified', color: '#e2445c', isCustom: false, order: 4, isSettable: false },
          ],
        } satisfies LeadStatusLabelListResponse),
      ),
      http.get(APPROACH_PLAN_PATHS.byLead('lead-2'), () =>
        HttpResponse.json({
          leadId: 'lead-2',
          angle: null,
          decisionMakers: null,
          objections: null,
          nextSteps: null,
          notes: null,
          updatedByUserId: null,
          updatedAt: todayIso,
        } satisfies ApproachPlanResponse),
      ),
      http.get(APPROACH_PLAN_PATHS.byLead('lead-1'), () =>
        HttpResponse.json({
          leadId: 'lead-1',
          angle: 'Focus on automated invoicing migration',
          decisionMakers: 'Sunita Kapoor (CFO)',
          objections: 'Concerned about onboarding time',
          nextSteps: 'Send migration timeline and demo quote',
          notes: null,
          updatedByUserId: 'user-1',
          updatedAt: todayIso,
        } satisfies ApproachPlanResponse),
      ),
      http.get(PLANNING_PATHS.schedule, () =>
        HttpResponse.json({
          from: todayIso,
          to: todayIso,
          items: [
            {
              id: 'task-1',
              notes: 'Prepare the Kapoor quote',
              dueAt: todayIso,
              completedAt: null,
              assignedToUserId: 'user-1',
              parentKind: 'lead',
              parentId: 'lead-1',
              parentName: 'Kapoor Trading',
            },
          ],
        } satisfies PlanningScheduleResponse),
      ),
      http.get(PLANNING_PATHS.heatmap, () =>
        HttpResponse.json({
          from: todayKey,
          to: todayKey,
          cells: [{ userId: 'user-2', date: todayKey, count: 5 }],
        } satisfies PlanningHeatmapResponse),
      ),
      http.get(PLANNING_PATHS.coordination, () =>
        HttpResponse.json({
          items: [
            { userId: 'user-1', leadCount: 3, openDealCount: 1, openTaskCount: 4, overdueTaskCount: 2 },
          ],
        } satisfies PlanningCoordinationResponse),
      ),
      http.get(ACTIVITY_PATHS.activities, () =>
        HttpResponse.json({
          items: [
            {
              id: 'task-1',
              type: 'task',
              notes: 'Prepare the Kapoor quote',
              occurredAt: todayIso,
              dueAt: todayIso,
              completedAt: null,
              createdByUserId: 'user-1',
              createdByName: 'Ada Okafor',
              assignedToUserId: 'user-1',
              leadId: 'lead-1',
              dealId: null,
              partyId: null,
              createdAt: todayIso,
              parentKind: 'lead',
              parentName: 'Kapoor Trading',
            },
          ],
          page: { number: 1, size: 25, total: 1, pages: 1 },
        } satisfies ActivityFeedResponse),
      ),
      http.get(PLANNER_NOTE_PATHS.myNotes, () =>
        HttpResponse.json({ body: 'Focus on enterprise deals this week', updatedAt: todayIso } satisfies PlannerNoteResponse),
      ),
      http.get(TEAM_PLAN_PATHS.teamPlan, () =>
        HttpResponse.json({ body: 'Q3 Goal: Close 50 enterprise accounts', updatedByUserId: 'user-1', updatedAt: todayIso } satisfies TeamPlanResponse),
      ),
      http.get(SCRIPT_PATHS.scripts, () =>
        HttpResponse.json({
          items: [
            {
              id: 's1',
              title: 'Cold Outreach Hook',
              body: 'Hi {{lead.name}}, noticed your team is expanding.',
              category: 'opener',
              leadStatus: 'new',
              createdByUserId: 'user-1',
              createdAt: todayIso,
              updatedAt: todayIso,
            },
          ],
        } satisfies ScriptListResponse),
      ),
      http.get(PLAYBOOK_PATHS.playbooks, () =>
        HttpResponse.json({
          items: [
            {
              id: 'pb1',
              name: 'Inbound Discovery Cadence',
              description: 'Standard 4-step sequence for inbound inquiries',
              steps: [
                {
                  id: 'step-1',
                  order: 1,
                  title: 'Discovery Call',
                  instruction: 'Confirm tech stack and timeline',
                  scriptId: 's1',
                  activityType: 'call',
                },
              ],
              createdByUserId: 'user-1',
              createdAt: todayIso,
              updatedAt: todayIso,
            },
          ],
        } satisfies PlaybookListResponse),
      ),
    );
  }

  it('renders the Strategy Whiteboard by default as the first hub tab', async () => {
    signedInWith('all');
    setupMocks();

    renderPage(<TeamPlanningPage />, { token: 'a-token', path: '/crm/planning' });

    // Hub tabs
    expect(await screen.findByRole('tab', { name: /strategy whiteboard/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /my tasks & agenda/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /team load & calendar/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /team plan & playbooks/i })).toBeInTheDocument();

    // Strategy whiteboard cards
    expect(await screen.findByText('Kapoor Trading')).toBeInTheDocument();
    const card = screen.getByRole('article', { name: /strategy whiteboard for kapoor trading/i });
    expect(within(card).getByText('Kapoor Group')).toBeInTheDocument();
    expect(within(card).getByText(/The Angle \/ Hook/i)).toBeInTheDocument();
    expect(within(card).getByText(/Next Best Action/i)).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: /turn into task/i })).toBeInTheDocument();
  });

  it('shows every assignee on a whiteboard card, not just the primary owner', async () => {
    signedInWith('all');
    setupMocks();

    renderPage(<TeamPlanningPage />, { token: 'a-token', path: '/crm/planning' });

    const card = await screen.findByRole('article', { name: /strategy whiteboard for kapoor trading/i });
    expect(within(card).getByText(/Ada Okafor/)).toBeInTheDocument();
    expect(within(card).getByText(/Bo Rivera/)).toBeInTheDocument();
  });

  it('finds an account by a rep who is on it as a second assignee', async () => {
    signedInWith('all');
    setupMocks();

    renderPage(<TeamPlanningPage />, { token: 'a-token', path: '/crm/planning' });

    expect(await screen.findByText('Kapoor Trading')).toBeInTheDocument();
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: /filter by representative/i }),
      'user-2',
    );

    // Bo Rivera is the second assignee on Kapoor Trading and the only one on Rahman Textiles.
    expect(screen.getByText('Kapoor Trading')).toBeInTheDocument();
    expect(screen.getByText('Rahman Textiles')).toBeInTheDocument();
  });

  it('captions each status badge with what this company calls that status', async () => {
    signedInWith('all');
    setupMocks();

    renderPage(<TeamPlanningPage />, { token: 'a-token', path: '/crm/planning' });

    // `contacted` has been renamed "In Progress" here, and "Processing" is a status of the
    // company's own — the badge follows the stored status through the vocabulary either way.
    const renamed = await screen.findByRole('article', { name: /strategy whiteboard for kapoor trading/i });
    expect(within(renamed).getByText('In Progress')).toBeInTheDocument();
    expect(within(renamed).queryByText('Contacted')).not.toBeInTheDocument();

    const custom = screen.getByRole('article', { name: /strategy whiteboard for rahman textiles/i });
    expect(within(custom).getByText('Processing')).toBeInTheDocument();
  });

  it('offers this company’s own statuses in the whiteboard status filter, in picker order', async () => {
    signedInWith('all');
    setupMocks();

    renderPage(<TeamPlanningPage />, { token: 'a-token', path: '/crm/planning' });

    const filter = await screen.findByRole('combobox', { name: /filter by status/i });
    await waitFor(() =>
      expect(
        within(filter)
          .getAllByRole('option')
          .map((option) => option.textContent),
      ).toEqual(['All statuses', 'New', 'Processing', 'In Progress', 'Qualified', 'Disqualified']),
    );

    await userEvent.selectOptions(filter, 'processing');
    expect(screen.getByText('Rahman Textiles')).toBeInTheDocument();
    expect(screen.queryByText('Kapoor Trading')).not.toBeInTheDocument();
  });

  it('switches to Team Load & Calendar to show the week’s scheduled tasks with density controls', async () => {
    signedInWith('all');
    setupMocks();

    renderPage(<TeamPlanningPage />, { token: 'a-token', path: '/crm/planning' });

    await userEvent.click(await screen.findByRole('tab', { name: /team load & calendar/i }));

    expect(await screen.findByText('Prepare the Kapoor quote')).toBeInTheDocument();
    expect(screen.getByText('Kapoor Trading')).toBeInTheDocument();
    expect(screen.getAllByText('Ada Okafor').length).toBeGreaterThan(0);

    // 5-day / 7-day density toggle
    expect(screen.getByRole('button', { name: /5-day workweek/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /7-day full/i })).toBeInTheDocument();

    // Stepping buttons
    expect(screen.getByRole('button', { name: /previous week/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /today/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /next week/i })).toBeInTheDocument();
  });

  it('switches to the activity heatmap and shows a rep’s row', async () => {
    signedInWith('all');
    setupMocks();

    renderPage(<TeamPlanningPage />, { token: 'a-token', path: '/crm/planning' });

    await userEvent.click(await screen.findByRole('tab', { name: /team load & calendar/i }));
    await userEvent.click(await screen.findByRole('tab', { name: /activity heatmap/i }));

    expect(await screen.findByText(/activity over the last 12 weeks/i)).toBeInTheDocument();
    expect(screen.getByText('Bo Rivera')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
  });

  it('switches to coordination and lists each rep’s workload, idle teammates included', async () => {
    signedInWith('all');
    setupMocks();

    renderPage(<TeamPlanningPage />, { token: 'a-token', path: '/crm/planning' });

    await userEvent.click(await screen.findByRole('tab', { name: /team load & calendar/i }));
    await userEvent.click(await screen.findByRole('tab', { name: /who owns what/i }));

    const adaRow = (await screen.findByText('Ada Okafor')).closest('tr')!;
    expect(adaRow).toHaveTextContent('3');
    expect(adaRow).toHaveTextContent('2');
    expect(screen.getByText('Bo Rivera')).toBeInTheDocument();
  });

  it('switches to My Tasks & Agenda tab', async () => {
    signedInWith('all');
    setupMocks();

    renderPage(<TeamPlanningPage />, { token: 'a-token', path: '/crm/planning' });

    await userEvent.click(await screen.findByRole('tab', { name: /my tasks & agenda/i }));

    expect(await screen.findByText('My open tasks')).toBeInTheDocument();
    expect(screen.getByText('My notes')).toBeInTheDocument();
    expect(screen.getByText('Prepare the Kapoor quote')).toBeInTheDocument();
    expect(screen.getByText('+1d')).toBeInTheDocument();
  });

  it('switches to Team Plan & Playbooks tab', async () => {
    signedInWith('all');
    setupMocks();

    renderPage(<TeamPlanningPage />, { token: 'a-token', path: '/crm/planning' });

    await userEvent.click(await screen.findByRole('tab', { name: /team plan & playbooks/i }));

    expect(await screen.findByText(/Q3 Goal: Close 50 enterprise accounts/i)).toBeInTheDocument();
    expect(screen.getByText('Cold Outreach Hook')).toBeInTheDocument();
    expect(screen.getByText('Inbound Discovery Cadence')).toBeInTheDocument();
  });

  it('refuses the whole workspace without the team permission', async () => {
    signedInWith(['crm:leads:read']);
    setupMocks();

    renderPage(<TeamPlanningPage />, { token: 'a-token', path: '/crm/planning' });

    expect(await screen.findByText(/you cannot see team planning/i)).toBeInTheDocument();
  });

  it('opens Schedule Task modal from the calendar and allows scheduling an event', async () => {
    signedInWith('all');
    setupMocks();

    let postedBody: any = null;
    server.use(
      http.post(ACTIVITY_PATHS.activities, async ({ request }) => {
        postedBody = await request.json();
        return HttpResponse.json({
          id: 'task-new',
          type: 'task',
          notes: postedBody.notes,
          occurredAt: todayIso,
          dueAt: postedBody.dueAt,
          completedAt: null,
          createdByUserId: 'user-1',
          createdByName: 'Ada Okafor',
          assignedToUserId: postedBody.assignedToUserId ?? 'user-1',
          leadId: postedBody.leadId ?? 'lead-1',
          dealId: null,
          partyId: null,
          createdAt: todayIso,
        });
      }),
    );

    renderPage(<TeamPlanningPage />, { token: 'a-token', path: '/crm/planning' });

    await userEvent.click(await screen.findByRole('tab', { name: /team load & calendar/i }));

    const scheduleBtn = await screen.findByRole('button', { name: /\+ schedule task/i });
    await userEvent.click(scheduleBtn);

    expect(await screen.findByRole('heading', { name: /schedule task or event/i })).toBeInTheDocument();

    // Type notes
    const notesInput = screen.getByLabelText(/task details|agenda/i);
    await userEvent.type(notesInput, 'Quarterly strategy review');

    // Click Meeting kind
    await userEvent.click(screen.getByRole('button', { name: /🤝 meeting/i }));

    // Submit
    await userEvent.click(screen.getByRole('button', { name: /^schedule task$/i }));

    await waitFor(() => {
      expect(postedBody).not.toBeNull();
      expect(postedBody.notes).toContain('Quarterly strategy review');
      expect(postedBody.notes).toContain('[Meeting]');
    });
  });
});
