import { describe, expect, it, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { MARKETING_PATHS, type BrandSummary, type ScheduledPostSummary } from '@erp/shared';
import { server } from '../../../test/server';
import { renderPage } from '../../../test/render';
import { SocialCalendarPage } from './SocialCalendarPage';

describe('SocialCalendarPage and Social Media Suite', () => {
  const mockBrand: BrandSummary = {
    id: 'brand-test-1',
    name: 'Velocity Sports',
    slug: 'velocity-sports',
    logoUrl: null,
    brandColors: { primary: '#2563eb' },
    timezone: 'America/New_York',
    customDomain: null,
    storageQuotaMb: 2000,
    socialAccountsCount: 3,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const mockAccounts = [
    {
      id: 'acc-ig',
      brandId: 'brand-test-1',
      platform: 'instagram' as const,
      accountName: '@velocity',
      platformAccountId: 'ig_01',
      maskedAccessToken: '••••••••1111',
      hasRefreshToken: true,
      tokenExpiresAt: new Date(Date.now() + 30 * 86400000).toISOString(),
      isTokenExpired: false,
      daysUntilExpiration: 30,
      status: 'active' as const,
      metadata: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    {
      id: 'acc-li',
      brandId: 'brand-test-1',
      platform: 'linkedin' as const,
      accountName: 'Velocity Global Corp',
      platformAccountId: 'li_02',
      maskedAccessToken: '••••••••2222',
      hasRefreshToken: true,
      tokenExpiresAt: new Date(Date.now() + 30 * 86400000).toISOString(),
      isTokenExpired: false,
      daysUntilExpiration: 30,
      status: 'active' as const,
      metadata: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    {
      id: 'acc-x',
      brandId: 'brand-test-1',
      platform: 'x' as const,
      accountName: '@Velocity_HQ',
      platformAccountId: 'x_03',
      maskedAccessToken: '••••••••3333',
      hasRefreshToken: true,
      tokenExpiresAt: new Date(Date.now() + 30 * 86400000).toISOString(),
      isTokenExpired: false,
      daysUntilExpiration: 30,
      status: 'active' as const,
      metadata: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ];

  const nowIso = new Date().toISOString();

  const mockPosts: ScheduledPostSummary[] = [
    {
      id: 'post-1',
      brandId: 'brand-test-1',
      socialAccountId: 'acc-ig',
      socialAccount: {
        id: 'acc-ig',
        platform: 'instagram',
        accountName: '@velocity',
      },
      campaignId: null,
      autolistItemId: null,
      content: 'Unveiling the lightweight aerodynamic runner. #running #velocity',
      mediaUrls: [
        'https://images.unsplash.com/photo-1542291026-7eec264c27ff?auto=format&fit=crop&w=600&q=80',
      ],
      platformConfig: { firstComment: '#fitness #marathon' },
      scheduledAt: nowIso,
      publishedAt: null,
      status: 'SCHEDULED',
      failureReason: null,
      externalPostId: null,
      metrics: null,
      createdAt: nowIso,
      updatedAt: nowIso,
    },
    {
      id: 'post-2',
      brandId: 'brand-test-1',
      socialAccountId: 'acc-li',
      socialAccount: {
        id: 'acc-li',
        platform: 'linkedin',
        accountName: 'Velocity Global Corp',
      },
      campaignId: null,
      autolistItemId: null,
      content: 'Why sustainable materials are reshaping high-performance athletics.',
      mediaUrls: [],
      platformConfig: null,
      scheduledAt: nowIso,
      publishedAt: null,
      status: 'SCHEDULED',
      failureReason: null,
      externalPostId: null,
      metrics: null,
      createdAt: nowIso,
      updatedAt: nowIso,
    },
  ];

  beforeEach(() => {
    server.use(
      http.get(MARKETING_PATHS.brandSocialAccounts('brand-test-1'), () =>
        HttpResponse.json({
          items: mockAccounts,
          page: { number: 1, size: 25, total: 3, pages: 1 },
        }),
      ),
      http.get(MARKETING_PATHS.posts, () =>
        HttpResponse.json({
          items: mockPosts,
          page: { number: 1, size: 25, total: 2, pages: 1 },
        }),
      ),
      http.get(MARKETING_PATHS.expiringAccounts('brand-test-1'), () =>
        HttpResponse.json({ thresholdDays: 7, accounts: [] }),
      ),
    );
  });

  it('renders the Month view with scheduled post chips and toolbar navigation', async () => {
    renderPage(<SocialCalendarPage brand={mockBrand} />, { path: '/marketing' });

    // Header toolbar
    expect(await screen.findByText('Today')).toBeInTheDocument();
    expect(screen.getByText('Schedule Post')).toBeInTheDocument();
    expect(screen.getByText('Instagram Grid')).toBeInTheDocument();
    expect(screen.getByText('Engagement Heatmap Active:')).toBeInTheDocument();

    // Day headers
    expect(screen.getByText('Mon')).toBeInTheDocument();
    expect(screen.getByText('Fri')).toBeInTheDocument();
    expect(screen.getByText('Sun')).toBeInTheDocument();

    // Shows scheduled post chip
    expect(
      await screen.findByText(/Unveiling the lightweight aerodynamic runner/i),
    ).toBeInTheDocument();
  });

  it('switches between Month, Week, and Day views', async () => {
    const { user } = renderPage(<SocialCalendarPage brand={mockBrand} />, { path: '/marketing' });
    await screen.findByText('Today');

    // Switch to Week view
    const weekBtn = screen.getByRole('button', { name: /^week$/i });
    await user.click(weekBtn);

    expect(await screen.findByText(/Week of/i)).toBeInTheDocument();
    expect(screen.getAllByText('🔥 Peak').length).toBeGreaterThanOrEqual(1);

    // Switch to Day view
    const dayBtn = screen.getByRole('button', { name: /^day$/i });
    await user.click(dayBtn);

    expect(await screen.findByText(/Hourly Engagement Heatmap/i)).toBeInTheDocument();
    expect(screen.getByText('+ Add Post Today')).toBeInTheDocument();
    expect(screen.getAllByText('Publish Now').length).toBeGreaterThanOrEqual(1);
  });

  it('opens PostComposerModal with multi-account selection and platform tabs', async () => {
    let createdPayload: any = null;

    server.use(
      http.post(MARKETING_PATHS.posts, async ({ request }) => {
        createdPayload = await request.json();
        return HttpResponse.json({
          id: 'post-new-1',
          ...createdPayload,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      }),
    );

    const { user } = renderPage(<SocialCalendarPage brand={mockBrand} />, { path: '/marketing' });
    await screen.findByText('Today');

    // Open Composer
    const scheduleBtn = screen.getByRole('button', { name: /Schedule Post/i });
    await user.click(scheduleBtn);

    const modal = screen.getByRole('dialog');
    expect(await within(modal).findByText('Multi-Network Post Composer')).toBeInTheDocument();
    expect(within(modal).getByText(/Base \(All Channels\)/i)).toBeInTheDocument();
    expect(within(modal).getByText('Brand Asset Library')).toBeInTheDocument();
    // Renamed with ticket 14: the panel is computed from the tenant's own posting history and
    // is not an inference, so it no longer claims to be one (14f).
    expect(within(modal).getByText('Best times to post')).toBeInTheDocument();

    // Shows multi-accounts checkboxes
    expect(within(modal).getByText('@velocity')).toBeInTheDocument();
    expect(within(modal).getByText('Velocity Global Corp')).toBeInTheDocument();
    expect(within(modal).getByText('@Velocity_HQ')).toBeInTheDocument();

    // Type content in composer
    const textarea = within(modal).getByPlaceholderText(/Write your primary post caption/i);
    await user.type(textarea, 'Exciting product drop incoming this Friday!');

    // Switch to Instagram tab to check format guide and character counter
    const igTab = within(modal).getByRole('button', { name: /Customize Instagram/i });
    await user.click(igTab);
    expect(await within(modal).findByText(/Format Guide:/i)).toBeInTheDocument();
    expect(within(modal).getByText(/Schedule First Comment/i)).toBeInTheDocument();

    // Submit the post
    const submitBtn = within(modal).getByRole('button', { name: /Schedule Broadcast/i });
    await user.click(submitBtn);

    await waitFor(() => {
      expect(createdPayload).not.toBeNull();
      expect(createdPayload.content).toContain('Exciting product drop incoming this Friday!');
    });
  });

  it('opens InstagramGridPreviewModal and renders 3x3 grid simulator and mobile feed', async () => {
    const { user } = renderPage(<SocialCalendarPage brand={mockBrand} />, { path: '/marketing' });
    await screen.findByText('Today');

    // Click Instagram Grid button
    const igGridBtn = screen.getByRole('button', { name: /Instagram Grid/i });
    await user.click(igGridBtn);

    const igModal = screen.getByRole('dialog');
    expect(
      within(igModal).getByText('Instagram 9-Grid Simulator & Feed Preview'),
    ).toBeInTheDocument();
    expect(within(igModal).getByText('@velocity-sports')).toBeInTheDocument();
    expect(within(igModal).getByText('14.8K')).toBeInTheDocument();
    expect(within(igModal).getByText(/tiles below, or use the arrow buttons on a tile/i)).toBeInTheDocument();

    // Switch to Mobile Feed view
    const mobileFeedTab = within(igModal).getByRole('button', { name: /Mobile Feed/i });
    await user.click(mobileFeedTab);

    expect(await within(igModal).findByText('San Francisco, California')).toBeInTheDocument();
    expect(within(igModal).getByText(/Done Previewing/i)).toBeInTheDocument();

    // Close modal
    await user.click(within(igModal).getByRole('button', { name: /Done Previewing/i }));
    expect(screen.queryByText('Instagram 9-Grid Simulator & Feed Preview')).not.toBeInTheDocument();
  });
});
