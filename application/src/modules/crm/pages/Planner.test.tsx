import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import {
  ACTIVITY_PATHS,
  APPROACH_PLAN_PATHS,
  PLANNER_NOTE_PATHS,
  TEAM_PLAN_PATHS,
  type ApproachPlanResponse,
} from '@erp/shared';
import { server } from '../../../test/server';
import { renderPage, signedInWith } from '../../../test/render';
import { ApproachPlanPanel } from '../components/ApproachPlanPanel';
import { MyPlannerPage } from './MyPlannerPage';
import { TeamPlanPage } from './TeamPlanPage';

const LEAD_ID = 'lead-1';

function emptyPlan(): ApproachPlanResponse {
  return {
    leadId: LEAD_ID,
    angle: null,
    decisionMakers: null,
    objections: null,
    nextSteps: null,
    notes: null,
    updatedByUserId: null,
    updatedAt: null,
  };
}

describe('ApproachPlanPanel', () => {
  it('shows the structured fields and the free-notes block, and saves them as one plan', async () => {
    server.use(http.get(APPROACH_PLAN_PATHS.byLead(LEAD_ID), () => HttpResponse.json(emptyPlan())));

    let sent: Record<string, unknown> | undefined;
    server.use(
      http.put(APPROACH_PLAN_PATHS.byLead(LEAD_ID), async ({ request }) => {
        sent = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ ...emptyPlan(), ...sent, updatedAt: new Date().toISOString() });
      }),
    );

    const { user } = renderPage(<ApproachPlanPanel leadId={LEAD_ID} canWrite />);

    // The hybrid shape: four structured intent fields plus a free-notes escape hatch.
    expect(await screen.findByLabelText('Angle')).toBeInTheDocument();
    expect(screen.getByLabelText('Decision-makers')).toBeInTheDocument();
    expect(screen.getByLabelText('Objections to expect')).toBeInTheDocument();
    expect(screen.getByLabelText('Next steps')).toBeInTheDocument();
    expect(screen.getByLabelText('Notes')).toBeInTheDocument();

    await user.type(screen.getByLabelText('Angle'), 'Lead with the migration pain');
    await user.click(screen.getByRole('button', { name: /save plan/i }));

    await waitFor(() => expect(sent).toMatchObject({ angle: 'Lead with the migration pain' }));
    // Fields left blank are sent as null so they clear rather than storing "".
    expect(sent?.objections).toBeNull();
  });

  it('renders read-only for a rep who cannot write the lead', async () => {
    server.use(
      http.get(APPROACH_PLAN_PATHS.byLead(LEAD_ID), () =>
        HttpResponse.json({ ...emptyPlan(), angle: 'Land and expand', updatedAt: new Date().toISOString() }),
      ),
    );

    renderPage(<ApproachPlanPanel leadId={LEAD_ID} canWrite={false} />);

    expect(await screen.findByText('Land and expand')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /save plan/i })).not.toBeInTheDocument();
  });
});

describe('MyPlannerPage', () => {
  it('lists only my open tasks and saves my private notes', async () => {
    signedInWith(['crm:activities:read']);

    let taskQuery = '';
    server.use(
      http.get(ACTIVITY_PATHS.activities, ({ request }) => {
        taskQuery = new URL(request.url).search;
        return HttpResponse.json({
          items: [
            {
              id: 'a1', type: 'task', notes: 'Follow up on the quote', occurredAt: new Date().toISOString(),
              dueAt: null, completedAt: null, createdByUserId: 'u1', createdByName: 'Ada Okafor',
              assignedToUserId: 'u1', leadId: LEAD_ID, dealId: null, partyId: null,
              createdAt: new Date().toISOString(), parentKind: 'lead', parentName: 'Acme Corp',
            },
            {
              id: 'a2', type: 'task', notes: 'Already done', occurredAt: new Date().toISOString(),
              dueAt: null, completedAt: new Date().toISOString(), createdByUserId: 'u1', createdByName: 'Ada Okafor',
              assignedToUserId: 'u1', leadId: LEAD_ID, dealId: null, partyId: null,
              createdAt: new Date().toISOString(), parentKind: 'lead', parentName: 'Acme Corp',
            },
          ],
          page: 1, pageSize: 25, total: 2,
        });
      }),
      http.get(PLANNER_NOTE_PATHS.myNotes, () => HttpResponse.json({ body: '', updatedAt: null })),
    );

    let sent: Record<string, unknown> | undefined;
    server.use(
      http.put(PLANNER_NOTE_PATHS.myNotes, async ({ request }) => {
        sent = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ body: String(sent.body), updatedAt: new Date().toISOString() });
      }),
    );

    const { user } = renderPage(<MyPlannerPage />, { token: 't' });

    expect(await screen.findByText('Follow up on the quote')).toBeInTheDocument();
    // A completed task is not part of "my open tasks".
    expect(screen.queryByText('Already done')).not.toBeInTheDocument();

    // "My tasks" reuses the existing activities filter — no bespoke endpoint.
    await waitFor(() => expect(taskQuery).toContain('filter.type=task'));
    expect(taskQuery).toContain('filter.assignedToUserId=u1');

    await user.type(screen.getByLabelText('My planner notes'), 'Mon: call Acme');
    await user.click(screen.getByRole('button', { name: /save notes/i }));
    await waitFor(() => expect(sent).toMatchObject({ body: 'Mon: call Acme' }));
  });
});

describe('TeamPlanPage', () => {
  it('lets a manager edit the shared plan', async () => {
    signedInWith(['crm:team:read', 'crm:team:manage']);
    server.use(
      http.get(TEAM_PLAN_PATHS.teamPlan, () =>
        HttpResponse.json({ body: 'Q3 target: 40 new logos', updatedByUserId: 'u1', updatedAt: new Date().toISOString() }),
      ),
    );

    renderPage(<TeamPlanPage />, { token: 't' });

    expect(await screen.findByDisplayValue('Q3 target: 40 new logos')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /save team plan/i })).toBeInTheDocument();
  });

  it('shows a reader the plan without the editor', async () => {
    signedInWith(['crm:team:read']);
    server.use(
      http.get(TEAM_PLAN_PATHS.teamPlan, () =>
        HttpResponse.json({ body: 'Q3 target: 40 new logos', updatedByUserId: 'u2', updatedAt: new Date().toISOString() }),
      ),
    );

    renderPage(<TeamPlanPage />, { token: 't' });

    expect(await screen.findByText('Q3 target: 40 new logos')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /save team plan/i })).not.toBeInTheDocument();
  });
});
