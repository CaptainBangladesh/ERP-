import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import {
  ACTIVITY_PATHS,
  type ActivityListResponse,
  type ActivityResponse,
  type ActivitySummary,
  type CreateActivityRequest,
} from '@erp/shared';
import { renderPage, signedInWith } from '../../../test/render';
import { server } from '../../../test/server';
import { ActivityTimeline } from './ActivityTimeline';

describe('ActivityTimeline', () => {
  function activity(
    id: string,
    type: 'call' | 'email' | 'meeting' | 'note' | 'task',
    notes: string,
    overrides: Partial<ActivitySummary> = {},
  ): ActivitySummary {
    return {
      id,
      type,
      notes,
      occurredAt: '2026-08-23T12:00:00.000Z',
      dueAt: type === 'task' ? '2026-08-25T12:00:00.000Z' : null,
      completedAt: null,
      createdByUserId: 'user-1',
      createdByName: 'Ada Okafor',
      leadId: 'lead-1',
      dealId: null,
      partyId: null,
      createdAt: '2026-08-23T12:00:00.000Z',
      ...overrides,
    };
  }

  it('renders logged activities and frozen author details', async () => {
    signedInWith();

    server.use(
      http.get(ACTIVITY_PATHS.leadActivities('lead-1'), () =>
        HttpResponse.json({
          items: [
            activity('act-1', 'call', 'Initial discovery call with Priya.'),
            activity('act-2', 'task', 'Send proposal doc.', { completedAt: null }),
          ],
        } satisfies ActivityListResponse),
      ),
    );

    renderPage(<ActivityTimeline parentKind="lead" parentId="lead-1" />, {
      token: 'a-token',
      path: '/crm/leads',
    });

    expect(await screen.findByText('Initial discovery call with Priya.')).toBeInTheDocument();
    expect(await screen.findByText('Send proposal doc.')).toBeInTheDocument();
    expect(screen.getAllByText(/By Ada Okafor/i)).toHaveLength(2);
  });

  it('logs a new activity', async () => {
    signedInWith();

    let sent: unknown;

    server.use(
      http.get(ACTIVITY_PATHS.leadActivities('lead-1'), () =>
        HttpResponse.json({ items: [] } satisfies ActivityListResponse),
      ),
      http.post(ACTIVITY_PATHS.activities, async ({ request }) => {
        sent = await request.json();
        return HttpResponse.json(
          activity('act-new', 'note', 'Follow-up email sent to client.') satisfies ActivityResponse,
          { status: 201 },
        );
      }),
    );

    const { user } = renderPage(<ActivityTimeline parentKind="lead" parentId="lead-1" />, {
      token: 'a-token',
      path: '/crm/leads',
    });

    await screen.findByText('Activity Timeline');
    await user.click(screen.getByRole('button', { name: /\+ log activity/i }));

    await user.type(screen.getByLabelText(/notes \/ details/i), 'Follow-up email sent to client.');
    await user.click(screen.getByRole('button', { name: /save activity/i }));

    await waitFor(() =>
      expect(sent).toMatchObject({
        type: 'call',
        notes: 'Follow-up email sent to client.',
        leadId: 'lead-1',
      }),
    );
  });

  it('completes a task activity', async () => {
    signedInWith();

    let completedTask = false;

    server.use(
      http.get(ACTIVITY_PATHS.leadActivities('lead-1'), () =>
        HttpResponse.json({
          items: [activity('task-1', 'task', 'Follow up on contract', { completedAt: null })],
        } satisfies ActivityListResponse),
      ),
      http.post(ACTIVITY_PATHS.completeTask('task-1'), () => {
        completedTask = true;
        return HttpResponse.json(
          activity('task-1', 'task', 'Follow up on contract', {
            completedAt: '2026-08-23T14:00:00.000Z',
          }) satisfies ActivityResponse,
        );
      }),
    );

    const { user } = renderPage(<ActivityTimeline parentKind="lead" parentId="lead-1" />, {
      token: 'a-token',
      path: '/crm/leads',
    });

    await screen.findByText('Follow up on contract');
    const checkbox = screen.getByRole('checkbox', { name: /mark task done/i });
    await user.click(checkbox);

    await waitFor(() => expect(completedTask).toBe(true));
  });
});
