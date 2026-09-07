import { describe, expect, it, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { MARKETING_PATHS, type MarketingListResponse, type MarketingSummary } from '@erp/shared';
import { server } from '../../../test/server';
import { renderPage } from '../../../test/render';
import { MarketingPage } from './MarketingPage';

/**
 * The screen from the user's side.
 *
 * Requests are intercepted at the network boundary and their query strings captured, because
 * "sorted" and "filtered" are only true if the *server* was asked: a screen that reordered
 * rows it was already holding would pass a weaker test and be wrong on page two.
 */
describe('MarketingPage', () => {
  const PAGE_SIZE = 25;

  function row(name: string, overrides: Partial<MarketingSummary> = {}): MarketingSummary {
    return { id: `id-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, name, status: 'active', ...overrides };
  }

  function page(items: MarketingSummary[], total = items.length): MarketingListResponse {
    return { items, page: { number: 1, size: PAGE_SIZE, total, pages: Math.ceil(total / PAGE_SIZE) } };
  }

  function listing(respond: (parameters: URLSearchParams) => MarketingListResponse): { asked: string[] } {
    const asked: string[] = [];

    server.use(
      http.get(MARKETING_PATHS.marketings, ({ request }) => {
        const url = new URL(request.url);
        asked.push(url.search);
        return HttpResponse.json(respond(url.searchParams));
      }),
    );

    return { asked };
  }

  beforeEach(() => {
    server.use(
      http.get(MARKETING_PATHS.brands, () =>
        HttpResponse.json({ items: [], page: { number: 1, size: 25, total: 0, pages: 0 } }),
      ),
    );
  });

  it('shows what is there', async () => {
    listing(() => page([row('First'), row('Second', { status: 'inactive' })]));

    renderPage(<MarketingPage />, { path: '/marketing' });

    expect(await screen.findByText('First')).toBeInTheDocument();
    expect(screen.getByText('Inactive')).toBeInTheDocument();
  });

  it('guides the first action rather than showing an empty box', async () => {
    listing(() => page([]));

    renderPage(<MarketingPage />, { path: '/marketing' });

    // Nothing is seeded in this system, so this is the first thing a real user sees.
    expect(await screen.findByText(/nothing here yet/i)).toBeInTheDocument();
  });

  it('asks the server to sort when a column heading is clicked', async () => {
    const { asked } = listing(() => page([row('First')]));

    const { user } = renderPage(<MarketingPage />, { path: '/marketing' });
    await screen.findByText('First');

    await user.click(screen.getByRole('button', { name: /^name$/i }));
    await waitFor(() => expect(asked.at(-1)).toContain('sort=name'));
  });

  it('creates one and refreshes the list', async () => {
    let sent: unknown;
    let created = false;

    server.use(
      http.get(MARKETING_PATHS.marketings, () =>
        HttpResponse.json(created ? page([row('First')]) : page([])),
      ),
      http.post(MARKETING_PATHS.marketings, async ({ request }) => {
        sent = await request.json();
        created = true;
        return HttpResponse.json(row('First'), { status: 201 });
      }),
    );

    const { user } = renderPage(<MarketingPage />, { path: '/marketing' });
    await screen.findByText(/nothing here yet/i);

    await user.type(screen.getByLabelText(/^name$/i), 'First');
    await user.click(screen.getByRole('button', { name: /add marketing/i }));

    await waitFor(() => expect(sent).toEqual({ name: 'First' }));
    expect(await screen.findByRole('cell', { name: 'First' })).toBeInTheDocument();
  });

  it('puts a server message beside the input it belongs to', async () => {
    server.use(
      http.get(MARKETING_PATHS.marketings, () => HttpResponse.json(page([]))),
      http.post(MARKETING_PATHS.marketings, () =>
        HttpResponse.json(
          {
            code: 'validation_failed',
            message: 'Some of the details you entered need attention.',
            fields: { name: 'Enter a name.' },
          },
          { status: 422 },
        ),
      ),
    );

    const { user } = renderPage(<MarketingPage />, { path: '/marketing' });
    await screen.findByText(/nothing here yet/i);

    await user.click(screen.getByRole('button', { name: /add marketing/i }));

    const name = await screen.findByLabelText(/^name$/i);
    expect(name).toHaveAttribute('aria-invalid', 'true');
    expect(name).toHaveAccessibleDescription(/enter a name/i);
  });

  it('renders Brand & OAuth Vault tab and shows active brand and social channels', async () => {
    const mockBrand = {
      id: 'brand-1',
      name: 'Nike Global',
      slug: 'nike-global',
      logoUrl: null,
      brandColors: { primary: '#ef4444' },
      timezone: 'UTC',
      customDomain: null,
      storageQuotaMb: 1000,
      socialAccountsCount: 2,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const mockAccounts = [
      {
        id: 'acc-1',
        brandId: 'brand-1',
        platform: 'instagram' as const,
        accountName: '@nikerunning',
        platformAccountId: 'ig_123',
        maskedAccessToken: '••••••••1234',
        hasRefreshToken: true,
        tokenExpiresAt: new Date(Date.now() + 3 * 24 * 3600 * 1000).toISOString(), // 3 days (expiring soon)
        isTokenExpired: false,
        daysUntilExpiration: 3,
        status: 'expiring' as const,
        metadata: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ];

    server.use(
      http.get(MARKETING_PATHS.marketings, () => HttpResponse.json(page([]))),
      http.get(MARKETING_PATHS.brands, () =>
        HttpResponse.json({
          items: [mockBrand],
          page: { number: 1, size: 25, total: 1, pages: 1 },
        }),
      ),
      http.get(MARKETING_PATHS.brandSocialAccounts('brand-1'), () =>
        HttpResponse.json({
          items: mockAccounts,
          page: { number: 1, size: 25, total: 1, pages: 1 },
        }),
      ),
      http.get(MARKETING_PATHS.expiringAccounts('brand-1'), () =>
        HttpResponse.json({
          thresholdDays: 7,
          accounts: mockAccounts,
        }),
      ),
    );

    renderPage(<MarketingPage />, { path: '/marketing' });

    // Header and Brand Switcher
    expect(await screen.findByText('Multi-Network Suite')).toBeInTheDocument();
    expect((await screen.findAllByText('Nike Global')).length).toBeGreaterThanOrEqual(1);

    // 7-day expiration alert banner
    expect(await screen.findByText(/1 Connected Account Expiring Soon/i)).toBeInTheDocument();

    // Vault cards
    expect(await screen.findByText('Encrypted OAuth Credential Vault')).toBeInTheDocument();
    expect(screen.getByText('@nikerunning')).toBeInTheDocument();
    expect(screen.getByText('••••••••1234')).toBeInTheDocument();
    expect(screen.getByText(/3 days remaining/i)).toBeInTheDocument();
  });

  it('renders the Job Queue & Tasks tab and displays scheduled jobs', async () => {
    const mockJobs = [
      {
        id: 'job-12345678-abcd',
        companyId: 'company-1',
        type: 'publish_social_post',
        payload: { text: 'Launching Spring Campaign!' },
        scheduledAt: new Date(Date.now() + 3600000).toISOString(),
        status: 'PENDING' as const,
        attempts: 0,
        maxAttempts: 3,
        lastError: null,
        lockedAt: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: 'job-87654321-efgh',
        companyId: 'company-1',
        type: 'sync_ad_metrics',
        payload: { platform: 'meta' },
        scheduledAt: new Date().toISOString(),
        status: 'COMPLETED' as const,
        attempts: 1,
        maxAttempts: 3,
        lastError: null,
        lockedAt: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ];

    server.use(
      http.get(MARKETING_PATHS.marketings, () => HttpResponse.json(page([]))),
      http.get(MARKETING_PATHS.brands, () =>
        HttpResponse.json({
          items: [],
          page: { number: 1, size: 25, total: 0, pages: 0 },
        }),
      ),
      http.get(MARKETING_PATHS.jobs, () =>
        HttpResponse.json({
          items: mockJobs,
          page: { number: 1, size: 25, total: 2, pages: 1 },
        }),
      ),
    );

    const { user } = renderPage(<MarketingPage />, { path: '/marketing' });

    // Click Queue & Tasks tab
    const queueTab = await screen.findByRole('button', { name: /Queue & Tasks/i });
    await user.click(queueTab);

    // Queue Monitor view appears
    expect(await screen.findByText(/Postgres Background Task Queue/i)).toBeInTheDocument();
    expect(await screen.findByText('Publish Social Post')).toBeInTheDocument();
    expect(screen.getByText('Sync Ad Metrics')).toBeInTheDocument();

    // Metric counts
    expect(screen.getByText('Total Tasks')).toBeInTheDocument();
    expect(screen.getAllByText('Pending').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Completed').length).toBeGreaterThanOrEqual(1);
  });

  it('renders Publishing & Autolists tab and displays scheduled posts and autolist actions', async () => {
    const mockBrand = {
      id: 'brand-1',
      name: 'Acme Corp',
      slug: 'acme-corp',
      logoUrl: null,
      brandColors: null,
      timezone: 'UTC',
      customDomain: null,
      storageQuotaMb: 1000,
      socialAccountsCount: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const mockPosts = [
      {
        id: 'post-1',
        brandId: 'brand-1',
        socialAccountId: 'acc-1',
        socialAccount: {
          id: 'acc-1',
          platform: 'instagram' as const,
          accountName: '@acme',
        },
        campaignId: null,
        autolistItemId: null,
        content: 'Our latest seasonal drop is now live! #drop #summer',
        mediaUrls: [],
        platformConfig: null,
        scheduledAt: new Date(Date.now() + 7200000).toISOString(),
        publishedAt: null,
        status: 'SCHEDULED' as const,
        failureReason: null,
        externalPostId: null,
        metrics: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ];

    server.use(
      http.get(MARKETING_PATHS.marketings, () => HttpResponse.json(page([]))),
      http.get(MARKETING_PATHS.brands, () =>
        HttpResponse.json({
          items: [mockBrand],
          page: { number: 1, size: 25, total: 1, pages: 1 },
        }),
      ),
      http.get(MARKETING_PATHS.brandSocialAccounts('brand-1'), () =>
        HttpResponse.json({
          items: [{ id: 'acc-1', brandId: 'brand-1', platform: 'instagram', accountName: '@acme' }],
          page: { number: 1, size: 25, total: 1, pages: 1 },
        }),
      ),
      http.get(MARKETING_PATHS.posts, () =>
        HttpResponse.json({
          items: mockPosts,
          page: { number: 1, size: 25, total: 1, pages: 1 },
        }),
      ),
      http.get(MARKETING_PATHS.autolists, () =>
        HttpResponse.json({
          items: [],
          page: { number: 1, size: 25, total: 0, pages: 0 },
        }),
      ),
      http.get(MARKETING_PATHS.expiringAccounts('brand-1'), () =>
        HttpResponse.json({ thresholdDays: 7, accounts: [] }),
      ),
    );

    const { user } = renderPage(<MarketingPage />, { path: '/marketing' });

    // Click Publishing & Autolists tab
    const publishingTab = await screen.findByRole('button', { name: /Publishing & Autolists/i });
    await user.click(publishingTab);

    // Shows scheduled posts
    expect(await screen.findByText(/Our latest seasonal drop is now live!/i)).toBeInTheDocument();
    expect(screen.getByText('Schedule Post')).toBeInTheDocument();
    expect(screen.getByText('Publish Now')).toBeInTheDocument();

    // Toggle to Autolists subtab
    const autolistsSubTab = screen.getByRole('button', { name: /Evergreen Autolists/i });
    await user.click(autolistsSubTab);

    expect(await screen.findByText('Create Autolist')).toBeInTheDocument();
    expect(screen.getByText(/No autolists created yet/i)).toBeInTheDocument();
  });

  it('renders Calendar & Planner tab with visual calendar and scheduling controls', async () => {
    const mockBrand = {
      id: 'brand-1',
      name: 'Acme Corp',
      slug: 'acme-corp',
      logoUrl: null,
      brandColors: null,
      timezone: 'UTC',
      customDomain: null,
      storageQuotaMb: 1000,
      socialAccountsCount: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    server.use(
      http.get(MARKETING_PATHS.marketings, () => HttpResponse.json(page([]))),
      http.get(MARKETING_PATHS.brands, () =>
        HttpResponse.json({
          items: [mockBrand],
          page: { number: 1, size: 25, total: 1, pages: 1 },
        }),
      ),
      http.get(MARKETING_PATHS.brandSocialAccounts('brand-1'), () =>
        HttpResponse.json({
          items: [{ id: 'acc-1', brandId: 'brand-1', platform: 'instagram', accountName: '@acme' }],
          page: { number: 1, size: 25, total: 1, pages: 1 },
        }),
      ),
      http.get(MARKETING_PATHS.posts, () =>
        HttpResponse.json({
          items: [
            {
              id: 'post-cal-1',
              brandId: 'brand-1',
              socialAccountId: 'acc-1',
              socialAccount: {
                id: 'acc-1',
                platform: 'instagram' as const,
                accountName: '@acme',
              },
              campaignId: null,
              autolistItemId: null,
              content: 'Global Brand Announcement #summit',
              mediaUrls: [],
              platformConfig: null,
              scheduledAt: new Date().toISOString(),
              publishedAt: null,
              status: 'SCHEDULED' as const,
              failureReason: null,
              externalPostId: null,
              metrics: null,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          ],
          page: { number: 1, size: 25, total: 1, pages: 1 },
        }),
      ),
      http.get(MARKETING_PATHS.expiringAccounts('brand-1'), () =>
        HttpResponse.json({ thresholdDays: 7, accounts: [] }),
      ),
    );

    const { user } = renderPage(<MarketingPage />, { path: '/marketing' });

    // Click Calendar & Planner tab
    const calendarTab = await screen.findByRole('button', { name: /Calendar & Planner/i });
    await user.click(calendarTab);

    // Shows Calendar controls
    expect(await screen.findByText('Today')).toBeInTheDocument();
    expect(screen.getByText('Instagram Grid')).toBeInTheDocument();
    expect(screen.getByText('Engagement Heatmap Active:')).toBeInTheDocument();
    expect(screen.getByText(/Global Brand Announcement/i)).toBeInTheDocument();
  });

  it('switches to Campaigns & Attribution tab and displays UTM and SmartLink sub-sections', async () => {
    server.use(
      http.get(MARKETING_PATHS.brands, () =>
        HttpResponse.json({
          items: [
            {
              id: 'brand-1',
              name: 'Apex Athletics',
              slug: 'apex-athletics',
              timezone: 'UTC',
              storageQuotaMb: 1000,
              socialAccountsCount: 2,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          ],
          page: { number: 1, size: 25, total: 1, pages: 1 },
        }),
      ),
      http.get(MARKETING_PATHS.campaigns, () =>
        HttpResponse.json({
          items: [
            {
              id: 'camp-1',
              brandId: 'brand-1',
              name: 'Spring Marathon 2026',
              description: 'Primary Spring push',
              budget: 4000,
              spent: 0,
              startDate: null,
              endDate: null,
              status: 'ACTIVE',
              utmSource: null,
              utmMedium: null,
              utmCampaign: null,
              utmTerm: null,
              utmContent: null,
              postsCount: 5,
              smartLinksCount: 1,
              adSpend: 1200,
              adImpressions: 45000,
              adClicks: 1800,
              roas: 3.8,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          ],
          page: { number: 1, size: 25, total: 1, pages: 1 },
        }),
      ),
      http.get(MARKETING_PATHS.smartLinks, () =>
        HttpResponse.json({
          items: [],
          page: { number: 1, size: 25, total: 0, pages: 0 },
        }),
      ),
      http.get(MARKETING_PATHS.adSyncs, () =>
        HttpResponse.json({
          items: [],
          page: { number: 1, size: 25, total: 0, pages: 0 },
        }),
      ),
      http.get(MARKETING_PATHS.brandSocialAccounts('brand-1'), () =>
        HttpResponse.json({
          items: [],
          page: { number: 1, size: 25, total: 0, pages: 0 },
        }),
      ),
      http.get(MARKETING_PATHS.expiringAccounts('brand-1'), () =>
        HttpResponse.json({ thresholdDays: 7, accounts: [] }),
      ),
      http.get(MARKETING_PATHS.marketings, () =>
        HttpResponse.json({ items: [], page: { number: 1, size: 25, total: 0, pages: 0 } }),
      ),
    );

    const { user } = renderPage(<MarketingPage />, { path: '/marketing' });

    // Click Campaigns & Attribution tab
    const campaignsTab = await screen.findByRole('button', { name: /Campaigns & Attribution/i });
    await user.click(campaignsTab);

    // Verify campaign displays
    expect(await screen.findByText('Spring Marathon 2026')).toBeInTheDocument();
    expect(screen.getByText(/Primary Spring push/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /UTM Link Builder/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /SmartLinks/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Paid Ad Sync/i })).toBeInTheDocument();
  });

  it('renders Inbound & CRM Handoff tab and displays forms, webhooks, and nurture flows', async () => {
    server.use(
      http.get(MARKETING_PATHS.brands, () =>
        HttpResponse.json({
          items: [
            {
              id: 'brand-1',
              companyId: 'company-1',
              name: 'Apex Athletics',
              slug: 'apex-athletics',
              timezone: 'UTC',
              storageQuotaMb: 1000,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          ],
          page: { number: 1, size: 25, total: 1, pages: 1 },
        }),
      ),
      http.get(MARKETING_PATHS.forms, () =>
        HttpResponse.json({
          items: [
            {
              id: 'form-1',
              brandId: 'brand-1',
              name: 'Enterprise Demo Request',
              description: 'Captured via company landing page',
              schemaFields: [
                { name: 'name', label: 'Name', type: 'text', required: true },
                { name: 'email', label: 'Email', type: 'email', required: true },
              ],
              embedCode: '<form></form>',
              submitCount: 42,
              isActive: true,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          ],
          page: { number: 1, size: 25, total: 1, pages: 1 },
        }),
      ),
      http.get(MARKETING_PATHS.nurtureSequences, () =>
        HttpResponse.json({
          items: [
            {
              id: 'seq-1',
              brandId: 'brand-1',
              name: 'Inbound Welcome Series',
              description: 'Follow-up email drip',
              triggerEvent: 'marketing.lead.captured',
              steps: [
                { orderIndex: 0, delayMinutes: 0, emailSubject: 'Welcome!', emailBody: 'Hi' },
              ],
              status: 'ACTIVE',
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          ],
          page: { number: 1, size: 25, total: 1, pages: 1 },
        }),
      ),
      http.get(MARKETING_PATHS.brandSocialAccounts('brand-1'), () =>
        HttpResponse.json({ items: [], page: { number: 1, size: 25, total: 0, pages: 0 } }),
      ),
      http.get(MARKETING_PATHS.expiringAccounts('brand-1'), () =>
        HttpResponse.json({ thresholdDays: 7, accounts: [] }),
      ),
      http.get(MARKETING_PATHS.marketings, () =>
        HttpResponse.json({ items: [], page: { number: 1, size: 25, total: 0, pages: 0 } }),
      ),
    );

    const { user } = renderPage(<MarketingPage />, { path: '/marketing' });

    // Click Inbound & CRM tab
    const leadGenTab = await screen.findByRole('button', { name: /Inbound & CRM/i });
    await user.click(leadGenTab);

    // Verify inbound components rendered
    expect(await screen.findByText('Inbound Lead Gen & CRM Handoff')).toBeInTheDocument();
    expect(screen.getByText('Enterprise Demo Request')).toBeInTheDocument();
    expect(screen.getByText(/42 leads/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /\+ New Web Form/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Ad Webhooks/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Nurture Sequences/i })).toBeInTheDocument();
  });

  it('renders the Social Inbox & DMs tab with conversations and flows', async () => {
    server.use(
      http.get(MARKETING_PATHS.brands, () =>
        HttpResponse.json({
          items: [
            {
              id: 'brand-1',
              name: 'Apex Brand',
              slug: 'apex-brand',
              timezone: 'UTC',
              storageQuotaMb: 1000,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          ],
          page: { number: 1, size: 25, total: 1, pages: 1 },
        }),
      ),
      http.get(MARKETING_PATHS.inboxConversations, () =>
        HttpResponse.json({
          items: [
            {
              conversationId: 'conv-123',
              brandId: 'brand-1',
              socialAccountId: null,
              senderId: 'user-789',
              senderName: 'Marcus Vance',
              senderAvatar: null,
              platform: 'instagram',
              latestMessageContent: 'Can you send the guide?',
              latestMessageAt: new Date().toISOString(),
              unreadCount: 1,
              totalMessages: 2,
              status: 'unread',
            },
          ],
          page: { number: 1, size: 25, total: 1, pages: 1 },
        }),
      ),
      http.get(MARKETING_PATHS.inboxMessages, () =>
        HttpResponse.json({
          items: [
            {
              id: 'msg-1',
              brandId: 'brand-1',
              socialAccountId: null,
              conversationId: 'conv-123',
              senderId: 'user-789',
              senderName: 'Marcus Vance',
              senderAvatar: null,
              recipientId: null,
              content: 'Can you send the guide?',
              direction: 'inbound',
              status: 'unread',
              metadata: null,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          ],
          page: { number: 1, size: 25, total: 1, pages: 1 },
        }),
      ),
      http.get(MARKETING_PATHS.dmFlows, () =>
        HttpResponse.json({
          items: [],
          page: { number: 1, size: 25, total: 0, pages: 0 },
        }),
      ),
      http.get(MARKETING_PATHS.marketings, () =>
        HttpResponse.json({ items: [], page: { number: 1, size: 25, total: 0, pages: 0 } }),
      ),
    );

    const { user } = renderPage(<MarketingPage />, { path: '/marketing' });

    // Click Social Inbox & DMs tab
    const inboxTab = await screen.findByRole('button', { name: /Social Inbox & DMs/i });
    await user.click(inboxTab);

    // Verify inbox view rendered
    expect(await screen.findByText('Unified Social Inbox & DM Automation')).toBeInTheDocument();
    expect((await screen.findAllByText(/Marcus Vance/i))[0]).toBeInTheDocument();
    expect(screen.getAllByText('Can you send the guide?')[0]).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Convert to CRM Lead/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Send Reply/i })).toBeInTheDocument();
  });

  it('switches to tracking & analytics tab and displays tracked sites and analytics metrics', async () => {
    server.use(
      http.get(MARKETING_PATHS.brands, () =>
        HttpResponse.json({
          items: [{ id: 'brand-1', name: 'Apex Athletics', slug: 'apex-athletics' }],
          page: { number: 1, size: 25, total: 1, pages: 1 },
        }),
      ),
      http.get(MARKETING_PATHS.brandSocialAccounts('brand-1'), () =>
        HttpResponse.json({ items: [], page: { number: 1, size: 25, total: 0, pages: 0 } }),
      ),
      http.get(MARKETING_PATHS.expiringAccounts('brand-1'), () =>
        HttpResponse.json({ thresholdDays: 7, accounts: [] }),
      ),
      http.get(MARKETING_PATHS.trackingSites, () =>
        HttpResponse.json({
          items: [
            {
              id: 'site-1',
              brandId: 'brand-1',
              name: 'Apex Online Store',
              domain: 'store.apexathletics.com',
              pixelKey: 'pix_apex_123',
              isActive: true,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              _count: { pageViews: 42 },
            },
          ],
          page: { number: 1, size: 25, total: 1, pages: 1 },
        }),
      ),
      http.get(MARKETING_PATHS.trackingSiteAnalytics('site-1'), () =>
        HttpResponse.json({
          siteId: 'site-1',
          totalPageviews: 42,
          totalVisitors: 28,
          totalSessions: 30,
          daily: [
            {
              date: '2026-09-06',
              pageviews: 42,
              visitors: 28,
              sessions: 30,
            },
          ],
          topPages: [{ path: '/products/gear', pageviews: 24 }],
          topReferrers: [{ referrer: 'google.com', pageviews: 30 }],
          campaigns: [{ utmCampaign: 'Spring_Sale', pageviews: 42, visitors: 28 }],
          devices: [{ device: 'mobile', count: 35 }],
        }),
      ),
      http.get(MARKETING_PATHS.analyticsOverview, () =>
        HttpResponse.json({
          brandId: 'brand-1',
          totalPageviews: 42,
          totalVisitors: 28,
          totalSessions: 30,
          daily: [],
          topPages: [],
          topReferrers: [],
          campaigns: [],
          devices: [],
        }),
      ),
      http.get(MARKETING_PATHS.marketings, () =>
        HttpResponse.json({ items: [], page: { number: 1, size: 25, total: 0, pages: 0 } }),
      ),
    );

    const { user } = renderPage(<MarketingPage />, { path: '/marketing' });

    // Click Tracking & Analytics tab
    const analyticsTab = await screen.findByRole('button', { name: /Tracking & Analytics/i });
    await user.click(analyticsTab);

    // Verify Tracking & Analytics view rendered
    expect(await screen.findByText('First-Party Web Tracking & Visitor Analytics')).toBeInTheDocument();
    expect((await screen.findAllByText('Apex Online Store'))[0]).toBeInTheDocument();
    expect((await screen.findAllByText('store.apexathletics.com'))[0]).toBeInTheDocument();
    expect((await screen.findAllByText('42'))[0]).toBeInTheDocument();
    expect((await screen.findAllByText('28'))[0]).toBeInTheDocument();
    expect(await screen.findByText('Spring_Sale')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Register Tracked Site/i })).toBeInTheDocument();
  });
});



