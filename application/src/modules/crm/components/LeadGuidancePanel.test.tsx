import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import {
  ACTIVITY_PATHS,
  LEAD_GUIDANCE_PATHS,
  PLAYBOOK_PATHS,
  type LeadGuidanceResponse,
} from '@erp/shared';
import { server } from '../../../test/server';
import { renderPage } from '../../../test/render';
import { LeadGuidancePanel } from './LeadGuidancePanel';

describe('LeadGuidancePanel', () => {
  const LEAD_ID = 'lead-1';

  function guidance(overrides: Partial<LeadGuidanceResponse> = {}): LeadGuidanceResponse {
    return {
      scripts: [
        { id: 's1', title: 'Cold opener', category: 'opener', leadStatus: 'new', body: 'Hi {{lead.name}}', resolvedBody: 'Hi Acme Prospect' },
      ],
      enrollment: null,
      nextBestAction: {
        kind: 'status-suggestion',
        title: 'Make first contact',
        instruction: 'Reach out and introduce yourself.',
        activityType: 'call',
        script: { id: 's1', title: 'Cold opener', category: 'opener', leadStatus: 'new', body: 'Hi {{lead.name}}', resolvedBody: 'Hi Acme Prospect' },
        playbookStepOrder: null,
        reason: 'Lead is new. No activity logged yet.',
      },
      ...overrides,
    };
  }

  function serve(data: LeadGuidanceResponse): void {
    server.use(
      http.get(LEAD_GUIDANCE_PATHS.guidance(LEAD_ID), () => HttpResponse.json(data)),
      http.get(PLAYBOOK_PATHS.playbooks, () => HttpResponse.json({ items: [] })),
    );
  }

  it('renders the next best action and the merged script for the lead', async () => {
    serve(guidance());
    renderPage(<LeadGuidancePanel leadId={LEAD_ID} canWrite currentUserId="u1" />);

    expect(await screen.findByText('Make first contact')).toBeInTheDocument();
    // The script arrives already merged with the lead's data.
    expect(screen.getAllByText('Hi Acme Prospect').length).toBeGreaterThan(0);
  });

  it('logs the recommended action as a task assigned to the current rep', async () => {
    serve(guidance());
    let sent: Record<string, unknown> | undefined;
    server.use(
      http.post(ACTIVITY_PATHS.activities, async ({ request }) => {
        sent = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ id: 'a1' }, { status: 201 });
      }),
    );

    const { user } = renderPage(<LeadGuidancePanel leadId={LEAD_ID} canWrite currentUserId="u1" />);

    await user.click(await screen.findByRole('button', { name: /log this as a task for me/i }));

    await waitFor(() =>
      expect(sent).toMatchObject({ type: 'task', leadId: LEAD_ID, assignedToUserId: 'u1' }),
    );
    expect(String(sent?.notes)).toContain('Make first contact');
  });

  it('offers to start a play when the lead is on none', async () => {
    serve(guidance());
    server.use(
      http.get(PLAYBOOK_PATHS.playbooks, () =>
        HttpResponse.json({ items: [{ id: 'p1', name: 'New-lead outreach', description: null, steps: [], createdByUserId: 'u1', createdAt: '', updatedAt: '' }] }),
      ),
    );

    renderPage(<LeadGuidancePanel leadId={LEAD_ID} canWrite currentUserId="u1" />);

    expect(await screen.findByText(/on no play yet/i)).toBeInTheDocument();
    expect(await screen.findByLabelText(/start a play/i)).toBeInTheDocument();
  });
});
