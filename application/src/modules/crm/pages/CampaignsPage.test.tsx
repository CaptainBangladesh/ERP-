import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import {
  CAMPAIGN_PATHS,
  EMAIL_TEMPLATE_PATHS,
  MAILBOX_PATHS,
  type CampaignRecipientListResponse,
  type CampaignRecipientSummary,
  type CampaignSummary,
  type EmailTemplateSummary,
  type MailboxConnectionSummary,
} from '@erp/shared';
import { server } from '../../../test/server';
import { renderPage, signedInWith } from '../../../test/render';
import { CampaignsPage } from './CampaignsPage';

describe('CampaignsPage', () => {
  const MAILBOX: MailboxConnectionSummary = {
    id: 'mb-1',
    userId: 'user-1',
    provider: 'gmail',
    emailAddress: 'sales@example.com',
    displayName: 'Sales Team',
    status: 'connected',
    connectedAt: '2026-08-24T00:00:00.000Z',
    createdAt: '2026-08-24T00:00:00.000Z',
    updatedAt: '2026-08-24T00:00:00.000Z',
  };

  const TEMPLATE: EmailTemplateSummary = {
    id: 'tmpl-1',
    name: 'Outreach Offer',
    subject: 'Special offer for {{lead.name}}',
    body: '<p>Hi {{lead.name}}</p>',
    createdByUserId: 'user-1',
    createdAt: '2026-08-24T00:00:00.000Z',
    updatedAt: '2026-08-24T00:00:00.000Z',
  };

  const CAMPAIGN: CampaignSummary = {
    id: 'cmp-1',
    name: 'Summer Blast',
    status: 'draft',
    mailboxConnectionId: MAILBOX.id,
    templateId: TEMPLATE.id,
    segmentConfig: {},
    totalLeadsCount: 2,
    excludedCount: 1,
    sentCount: 0,
    openedCount: 0,
    openRate: 0,
    createdAt: '2026-08-24T00:00:00.000Z',
    updatedAt: '2026-08-24T00:00:00.000Z',
  };

  const RECIPIENT: CampaignRecipientSummary = {
    id: 'rec-1',
    campaignId: CAMPAIGN.id,
    leadId: 'lead-1',
    leadName: 'Alice Smith',
    emailAddress: 'alice@example.com',
    status: 'pending',
    excludeReason: null,
    sentAt: null,
    openToken: 'token-alice',
    openedAt: null,
    openCount: 0,
  };

  function setupMsw(options: { campaigns?: CampaignSummary[]; recipients?: CampaignRecipientSummary[] } = {}) {
    server.use(
      http.get(CAMPAIGN_PATHS.campaigns, () =>
        HttpResponse.json({ items: options.campaigns ?? [CAMPAIGN] }),
      ),
      http.get(MAILBOX_PATHS.mailboxes, () =>
        HttpResponse.json({ items: [MAILBOX] }),
      ),
      http.get(EMAIL_TEMPLATE_PATHS.templates, () =>
        HttpResponse.json({ items: [TEMPLATE] }),
      ),
      http.get(CAMPAIGN_PATHS.recipients(CAMPAIGN.id), () =>
        HttpResponse.json({ items: options.recipients ?? [RECIPIENT] } satisfies CampaignRecipientListResponse),
      ),
    );
  }

  it('renders campaigns page header and campaign metrics', async () => {
    signedInWith();
    setupMsw();

    renderPage(<CampaignsPage />, { token: 'a-token', path: '/crm/campaigns' });

    expect(await screen.findByRole('heading', { name: 'Email Campaigns' })).toBeInTheDocument();
    expect(await screen.findByText('Summer Blast')).toBeInTheDocument();
    expect(screen.getByText('Total Campaigns')).toBeInTheDocument();
  });

  it('allows creating a campaign draft', async () => {
    signedInWith();
    setupMsw({ campaigns: [] });

    let createSent: unknown;
    server.use(
      http.post(CAMPAIGN_PATHS.campaigns, async ({ request }) => {
        createSent = await request.json();
        return HttpResponse.json(CAMPAIGN, { status: 201 });
      }),
    );

    const { user } = renderPage(<CampaignsPage />, { token: 'a-token', path: '/crm/campaigns' });

    await user.click(await screen.findByRole('button', { name: /\+ new campaign/i }));
    await user.type(screen.getByLabelText(/campaign name/i), 'Summer Blast');
    await user.selectOptions(screen.getByLabelText(/mailbox connection/i), MAILBOX.id);
    await user.selectOptions(screen.getByLabelText(/email template/i), TEMPLATE.id);

    await user.click(screen.getByRole('button', { name: /save campaign draft/i }));

    await waitFor(() =>
      expect(createSent).toEqual({
        name: 'Summer Blast',
        mailboxConnectionId: MAILBOX.id,
        templateId: TEMPLATE.id,
      }),
    );
  });

  it('materializes recipients and displays recipients table', async () => {
    signedInWith();
    setupMsw();

    let materialized = false;
    server.use(
      http.post(CAMPAIGN_PATHS.materialize(CAMPAIGN.id), () => {
        materialized = true;
        return HttpResponse.json({ ...CAMPAIGN, totalLeadsCount: 1 });
      }),
    );

    const { user } = renderPage(<CampaignsPage />, { token: 'a-token', path: '/crm/campaigns' });

    await user.click(await screen.findByText('Summer Blast'));
    expect(screen.getByText('Alice Smith')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /materialize recipients/i }));

    await waitFor(() => expect(materialized).toBe(true));
  });

  it('hides create button for users without write permission', async () => {
    signedInWith([]);
    setupMsw();

    renderPage(<CampaignsPage />, { token: 'a-token', path: '/crm/campaigns' });

    expect(await screen.findByText('Summer Blast')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /\+ new campaign/i })).not.toBeInTheDocument();
  });
});
