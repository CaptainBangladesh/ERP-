import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import {
  WORKFLOW_RULE_PATHS,
  type WorkflowRuleListResponse,
  type WorkflowRuleSummary,
} from '@erp/shared';
import { server } from '../../../test/server';
import { renderPage, signedInWith } from '../../../test/render';
import { WorkflowRulesPage } from './WorkflowRulesPage';

describe('WorkflowRulesPage', () => {
  const PAGE_SIZE = 25;

  function rule(name: string, overrides: Partial<WorkflowRuleSummary> = {}): WorkflowRuleSummary {
    return {
      id: `id-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      name,
      triggerType: 'deal.stage_changed',
      triggerConfig: { toStageId: 'stage-1' },
      actionType: 'notify_user',
      actionConfig: { userId: 'user-1' },
      enabled: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ...overrides,
    };
  }

  function page(items: WorkflowRuleSummary[], total = items.length): WorkflowRuleListResponse {
    return { items, page: { number: 1, size: PAGE_SIZE, total, pages: Math.ceil(total / PAGE_SIZE) } };
  }

  function listing(items: WorkflowRuleSummary[]): void {
    server.use(http.get(WORKFLOW_RULE_PATHS.rules, () => HttpResponse.json(page(items))));
  }

  it('renders an empty state when no rules exist', async () => {
    listing([]);
    renderPage(<WorkflowRulesPage />, { path: '/crm/workflow-rules' });

    expect(await screen.findByText(/no workflow rules configured yet/i)).toBeInTheDocument();
  });

  it('renders configured workflow rules in a table', async () => {
    listing([
      rule('Notify on Stage Change', {
        triggerType: 'deal.stage_changed',
        actionType: 'notify_user',
        enabled: true,
      }),
    ]);

    renderPage(<WorkflowRulesPage />, { path: '/crm/workflow-rules' });

    expect(await screen.findByText('Notify on Stage Change')).toBeInTheDocument();
    expect(screen.getByText('Deal stage changed')).toBeInTheDocument();
    expect(screen.getByText('Notify user')).toBeInTheDocument();
    expect(screen.getByText('Enabled')).toBeInTheDocument();
  });

  it('creates a new workflow rule from the form', async () => {
    signedInWith();
    let sent: unknown;
    let created = false;

    server.use(
      http.get(WORKFLOW_RULE_PATHS.rules, () =>
        HttpResponse.json(created ? page([rule('Lead Task Automation')]) : page([])),
      ),
      http.post(WORKFLOW_RULE_PATHS.rules, async ({ request }) => {
        sent = await request.json();
        created = true;
        return HttpResponse.json(rule('Lead Task Automation'), { status: 201 });
      }),
    );

    const { user } = renderPage(<WorkflowRulesPage />, { token: 'a-token', path: '/crm/workflow-rules' });
    await screen.findByText(/no workflow rules configured yet/i);

    await user.type(screen.getByLabelText(/^rule name$/i), 'Lead Task Automation');
    await user.selectOptions(screen.getByLabelText(/trigger type/i), 'lead.status_changed');
    await user.selectOptions(screen.getByLabelText(/action type/i), 'create_task');
    await user.click(screen.getByRole('button', { name: /add rule/i }));

    await waitFor(() =>
      expect(sent).toMatchObject({ name: 'Lead Task Automation', triggerType: 'lead.status_changed', actionType: 'create_task' }),
    );
    expect(await screen.findByText('Lead Task Automation')).toBeInTheDocument();
  });
});
