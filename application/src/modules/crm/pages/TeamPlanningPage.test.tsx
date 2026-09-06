import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import {
  IDENTITY_PATHS,
  PLANNING_PATHS,
  type PlanningCoordinationResponse,
  type PlanningHeatmapResponse,
  type PlanningScheduleResponse,
  type UserListResponse,
} from '@erp/shared';
import { renderPage, signedInWith } from '../../../test/render';
import { server } from '../../../test/server';
import { TeamPlanningPage } from './TeamPlanningPage';

/**
 * The Planning workspace from the user's side — three views over the same team data. The task
 * assignee, deals and leads it reads are all arranged server-side; here we assert the page draws
 * the schedule, the heatmap and the coordination table, and refuses the whole thing without the
 * team permission.
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
    );
  }

  it('shows the week’s scheduled tasks with their owner and parent', async () => {
    signedInWith('all');
    setupMocks();

    renderPage(<TeamPlanningPage />, { token: 'a-token', path: '/crm/planning' });

    expect(await screen.findByText('Prepare the Kapoor quote')).toBeInTheDocument();
    expect(screen.getByText('Kapoor Trading')).toBeInTheDocument();
    // The owner is named on the card and in the legend.
    expect(screen.getAllByText('Ada Okafor').length).toBeGreaterThan(0);
  });

  it('switches to the activity heatmap and shows a rep’s row', async () => {
    signedInWith('all');
    setupMocks();

    renderPage(<TeamPlanningPage />, { token: 'a-token', path: '/crm/planning' });
    await screen.findByText('Prepare the Kapoor quote');

    await userEvent.click(screen.getByRole('tab', { name: /activity heatmap/i }));

    expect(await screen.findByText(/activity over the last 12 weeks/i)).toBeInTheDocument();
    // Bo did five things today; their row is present with the running total.
    expect(screen.getByText('Bo Rivera')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
  });

  it('switches to coordination and lists each rep’s workload, idle teammates included', async () => {
    signedInWith('all');
    setupMocks();

    renderPage(<TeamPlanningPage />, { token: 'a-token', path: '/crm/planning' });
    await screen.findByText('Prepare the Kapoor quote');

    await userEvent.click(screen.getByRole('tab', { name: /who owns what/i }));

    // Ada's real workload.
    const adaRow = (await screen.findByText('Ada Okafor')).closest('tr')!;
    expect(adaRow).toHaveTextContent('3');
    expect(adaRow).toHaveTextContent('2');
    // Bo owns nothing but still gets a row — the point of the view.
    expect(screen.getByText('Bo Rivera')).toBeInTheDocument();
  });

  it('refuses the whole workspace without the team permission', async () => {
    signedInWith(['crm:leads:read']);
    setupMocks();

    renderPage(<TeamPlanningPage />, { token: 'a-token', path: '/crm/planning' });

    expect(await screen.findByText(/you cannot see team planning/i)).toBeInTheDocument();
  });
});
