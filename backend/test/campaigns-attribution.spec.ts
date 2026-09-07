import { CampaignsService } from '../src/modules/marketing/campaigns.service';
import { SmartLinksService } from '../src/modules/marketing/smart-links.service';
import { AdSyncService } from '../src/modules/marketing/ad-sync.service';
import { UtmService } from '../src/modules/marketing/utm.service';
import { Tenancy } from '../src/platform/tenancy';
import { ApiException } from '../src/http/api-exception';
import { MARKETING_ERROR_CODES } from '@erp/shared';

describe('Campaigns, Attribution & SmartLinks Engine (Ticket 06)', () => {
  let mockBrands: any[];
  let mockCampaigns: any[];
  let mockSmartLinks: any[];
  let mockSmartLinkClicks: any[];
  let mockAdSyncs: any[];
  let mockScheduledPosts: any[];

  let mockPrisma: any;
  let tenancy: Tenancy;
  let utmService: UtmService;
  let campaignsService: CampaignsService;
  let smartLinksService: SmartLinksService;
  let adSyncService: AdSyncService;

  beforeEach(() => {
    mockBrands = [
      {
        id: 'brand-1',
        companyId: 'company-1',
        name: 'Apex Athletics',
        slug: 'apex-athletics',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];
    mockCampaigns = [];
    mockSmartLinks = [];
    mockSmartLinkClicks = [];
    mockAdSyncs = [];
    mockScheduledPosts = [];

    // Tenancy setup
    tenancy = new Tenancy();
    (tenancy as any).currentCompanyId = 'company-1';

    // Mock Prisma with company scoping emulation
    mockPrisma = {
      marketingBrand: {
        findUnique: jest.fn(async ({ where }) => {
          return mockBrands.find((b) => b.id === where.id) || null;
        }),
        findFirst: jest.fn(async ({ where }) => {
          return mockBrands.find((b) => (!where.id || b.id === where.id) && (!where.slug || b.slug === where.slug)) || null;
        }),
      },
      marketingCampaign: {
        create: jest.fn(async ({ data }) => {
          const item = {
            id: `camp-${mockCampaigns.length + 1}`,
            companyId: 'company-1',
            spent: 0,
            ...data,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          mockCampaigns.push(item);
          return item;
        }),
        findMany: jest.fn(async () => {
          return mockCampaigns.map((c) => ({
            ...c,
            _count: {
              scheduledPosts: mockScheduledPosts.filter((p) => p.campaignId === c.id).length,
              smartLinks: mockSmartLinks.filter((s) => s.campaignId === c.id).length,
            },
            adSyncs: mockAdSyncs.filter((a) => a.campaignId === c.id),
          }));
        }),
        findUnique: jest.fn(async ({ where }) => {
          const c = mockCampaigns.find((item) => item.id === where.id);
          if (!c) return null;
          return {
            ...c,
            _count: {
              scheduledPosts: mockScheduledPosts.filter((p) => p.campaignId === c.id).length,
              smartLinks: mockSmartLinks.filter((s) => s.campaignId === c.id).length,
            },
            smartLinks: mockSmartLinks.filter((s) => s.campaignId === c.id),
            adSyncs: mockAdSyncs.filter((a) => a.campaignId === c.id),
          };
        }),
        update: jest.fn(async ({ where, data }) => {
          const idx = mockCampaigns.findIndex((c) => c.id === where.id);
          if (idx === -1) return null;
          mockCampaigns[idx] = { ...mockCampaigns[idx], ...data, updatedAt: new Date() };
          const c = mockCampaigns[idx];
          return {
            ...c,
            _count: {
              scheduledPosts: mockScheduledPosts.filter((p) => p.campaignId === c.id).length,
              smartLinks: mockSmartLinks.filter((s) => s.campaignId === c.id).length,
            },
            adSyncs: mockAdSyncs.filter((a) => a.campaignId === c.id),
          };
        }),
        delete: jest.fn(async ({ where }) => {
          const idx = mockCampaigns.findIndex((c) => c.id === where.id);
          if (idx !== -1) mockCampaigns.splice(idx, 1);
          return { id: where.id };
        }),
        count: jest.fn(async () => mockCampaigns.length),
      },
      smartLink: {
        create: jest.fn(async ({ data }) => {
          const item = {
            id: `link-${mockSmartLinks.length + 1}`,
            companyId: 'company-1',
            ...data,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          mockSmartLinks.push(item);
          return item;
        }),
        findMany: jest.fn(async () => mockSmartLinks),
        findUnique: jest.fn(async ({ where }) => {
          if (where.id) return mockSmartLinks.find((l) => l.id === where.id) || null;
          if (where.slug) return mockSmartLinks.find((l) => l.slug === where.slug) || null;
          return null;
        }),
        update: jest.fn(async ({ where, data }) => {
          const idx = mockSmartLinks.findIndex((l) => l.id === where.id);
          if (idx === -1) return null;
          const current = mockSmartLinks[idx];
          const viewCount = data.viewCount?.increment ? current.viewCount + data.viewCount.increment : (data.viewCount ?? current.viewCount);
          const clickCount = data.clickCount?.increment ? current.clickCount + data.clickCount.increment : (data.clickCount ?? current.clickCount);
          mockSmartLinks[idx] = {
            ...current,
            ...data,
            viewCount,
            clickCount,
            updatedAt: new Date(),
          };
          return mockSmartLinks[idx];
        }),
        delete: jest.fn(async ({ where }) => {
          const idx = mockSmartLinks.findIndex((l) => l.id === where.id);
          if (idx !== -1) mockSmartLinks.splice(idx, 1);
          return { id: where.id };
        }),
        count: jest.fn(async () => mockSmartLinks.length),
      },
      // Clicks are rows now, not a JSON array on the link (ticket 12.3e).
      smartLinkClick: {
        create: jest.fn(async ({ data }: any) => {
          const row = {
            id: `click-${mockSmartLinkClicks.length + 1}`,
            ...data,
            clickedAt: new Date(),
          };
          mockSmartLinkClicks.push(row);
          return row;
        }),
        findMany: jest.fn(async ({ where }: any) =>
          mockSmartLinkClicks
            .filter((c) => !where?.smartLinkId || c.smartLinkId === where.smartLinkId)
            .slice()
            .reverse(),
        ),
        groupBy: jest.fn(async ({ where }: any) => {
          const counts = new Map<string | null, number>();
          for (const click of mockSmartLinkClicks) {
            if (where?.smartLinkId && click.smartLinkId !== where.smartLinkId) continue;
            const key = click.buttonId ?? null;
            counts.set(key, (counts.get(key) ?? 0) + 1);
          }
          return Array.from(counts.entries()).map(([buttonId, count]) => ({
            buttonId,
            _count: { _all: count },
          }));
        }),
      },
      adAccountSync: {
        create: jest.fn(async ({ data }) => {
          const item = {
            id: `adsync-${mockAdSyncs.length + 1}`,
            companyId: 'company-1',
            ...data,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          mockAdSyncs.push(item);
          return item;
        }),
        findMany: jest.fn(async () => mockAdSyncs),
        findUnique: jest.fn(async ({ where }) => {
          return mockAdSyncs.find((a) => a.id === where.id) || null;
        }),
        update: jest.fn(async ({ where, data }) => {
          const idx = mockAdSyncs.findIndex((a) => a.id === where.id);
          if (idx === -1) return null;
          mockAdSyncs[idx] = { ...mockAdSyncs[idx], ...data, updatedAt: new Date() };
          return mockAdSyncs[idx];
        }),
        delete: jest.fn(async ({ where }) => {
          const idx = mockAdSyncs.findIndex((a) => a.id === where.id);
          if (idx !== -1) mockAdSyncs.splice(idx, 1);
          return { id: where.id };
        }),
        count: jest.fn(async () => mockAdSyncs.length),
      },
    };

    utmService = new UtmService();
    campaignsService = new CampaignsService(mockPrisma, utmService);
    smartLinksService = new SmartLinksService(mockPrisma, tenancy);
    adSyncService = new AdSyncService(mockPrisma);
  });

  // ─── 1. UTM Link Builder ────────────────────────────────────────────────────────
  describe('UTM Link Builder Service', () => {
    it('generates normalized UTM links with query parameters', () => {
      const result = utmService.build({
        url: 'https://apexathletics.com/drops',
        source: 'Instagram',
        medium: 'Social Bio',
        campaign: 'Summer 2026',
        term: 'running shoes',
        content: 'hero banner',
      });

      expect(result.utmUrl).toContain('https://apexathletics.com/drops?');
      expect(result.utmUrl).toContain('utm_source=instagram');
      expect(result.utmUrl).toContain('utm_medium=social_bio');
      expect(result.utmUrl).toContain('utm_campaign=summer_2026');
      expect(result.utmUrl).toContain('utm_term=running_shoes');
      expect(result.utmUrl).toContain('utm_content=hero_banner');

      expect(result.channelPresets).toHaveLength(9);
      const igBio = result.channelPresets?.find((p) => p.channel === 'Instagram Bio');
      expect(igBio?.url).toContain('utm_source=instagram');
      expect(igBio?.url).toContain('utm_medium=bio');
    });

    it('parses UTM parameters from an existing URL', () => {
      const parsed = utmService.parse('https://example.com/promo?utm_source=tiktok&utm_medium=cpc&utm_campaign=black_friday');
      expect(parsed).toEqual({
        url: 'https://example.com/promo',
        source: 'tiktok',
        medium: 'cpc',
        campaign: 'black_friday',
        term: undefined,
        content: undefined,
      });
    });

    it('throws ApiException when destination URL is invalid', () => {
      expect(() => utmService.build({
        url: '',
        source: 'ig',
        medium: 'bio',
        campaign: 'camp',
      })).toThrow(ApiException);
    });
  });

  // ─── 2. Marketing Campaigns Service ─────────────────────────────────────────────
  describe('Marketing Campaigns Service', () => {
    it('creates a new campaign and calculates progress', async () => {
      const campaign = await campaignsService.create({
        brandId: 'brand-1',
        name: 'Fall Marathon Kickoff',
        budget: 5000,
        utmSource: 'meta',
        utmMedium: 'cpc',
        utmCampaign: 'fall_marathon',
      } as any);

      expect(campaign.id).toBe('camp-1');
      expect(campaign.name).toBe('Fall Marathon Kickoff');
      expect(campaign.budget).toBe(5000);
      expect(campaign.status).toBe('ACTIVE');
      expect(campaign.utmCampaign).toBe('fall_marathon');

      const detail = await campaignsService.get('camp-1');
      expect(detail.id).toBe('camp-1');
      expect(detail.postsCount).toBe(0);
      expect(detail.smartLinksCount).toBe(0);
      expect(detail.adSpend).toBe(0);
    });

    it('rejects creation if brand does not exist', async () => {
      await expect(
        campaignsService.create({
          brandId: 'non-existent',
          name: 'Invalid Brand Campaign',
        } as any),
      ).rejects.toThrow(ApiException);
    });

    it('updates campaign details and status', async () => {
      await campaignsService.create({
        brandId: 'brand-1',
        name: 'Spring Sprint',
        budget: 2000,
      } as any);

      const updated = await campaignsService.update('camp-1', {
        budget: 2500,
        status: 'PAUSED',
      } as any);

      expect(updated.budget).toBe(2500);
      expect(updated.status).toBe('PAUSED');
    });
  });

  // ─── 3. SmartLinks (Link-in-Bio) & Public Analytics ─────────────────────────────
  describe('SmartLinks & Public Route Serving', () => {
    it('creates a branded SmartLink page with buttons and shoppable grid', async () => {
      const link = await smartLinksService.create({
        brandId: 'brand-1',
        slug: 'apex-bio',
        title: 'Apex Athletics Links',
        bio: 'Engineered for performance.',
        buttonLinks: [
          { id: 'btn-1', title: 'Shop Running Shoes', url: 'https://apex.com/shoes' },
          { id: 'btn-2', title: 'Join VIP Club', url: 'https://apex.com/vip' },
        ],
        shoppableGrid: [
          { id: 'grid-1', imageUrl: 'https://apex.com/p1.jpg', productUrl: 'https://apex.com/p1', price: '$120' },
        ],
      } as any);

      expect(link.slug).toBe('apex-bio');
      expect(link.title).toBe('Apex Athletics Links');
      expect(link.buttonLinksCount).toBe(2);
      expect(link.shoppableGridCount).toBe(1);
    });

    it('refuses duplicate slug with 409 conflict', async () => {
      await smartLinksService.create({
        brandId: 'brand-1',
        slug: 'official',
        title: 'First Page',
      } as any);

      await expect(
        smartLinksService.create({
          brandId: 'brand-1',
          slug: 'official',
          title: 'Duplicate Page',
        } as any),
      ).rejects.toThrow(ApiException);
    });

    it('serves public page, increments views, and records button click analytics', async () => {
      await smartLinksService.create({
        brandId: 'brand-1',
        slug: 'store',
        title: 'Apex Store',
        buttonLinks: [
          { id: 'btn-app', title: 'Download iOS App', url: 'https://apple.co/apex', clicks: 0 },
        ],
      } as any);

      // Public view without auth
      const publicPage = await smartLinksService.getPublicPage('store');
      expect(publicPage.slug).toBe('store');
      expect(publicPage.viewCount).toBe(1);

      // Record a public button click
      const clickRes = await smartLinksService.recordPublicClick('store', { buttonId: 'btn-app' });
      expect(clickRes.recorded).toBe(true);
      expect(clickRes.targetUrl).toBe('https://apple.co/apex');

      // Check admin analytics detail
      const detail = await smartLinksService.get(publicPage.id);
      expect(detail.viewCount).toBe(1);
      expect(detail.clickCount).toBe(1);
      expect(detail.ctr).toBe(100);
      expect(detail.analytics.clicksByButton['btn-app']).toBe(1);
    });

    it('renders responsive HTML bio page with CSS and JS tracking', async () => {
      const link = await smartLinksService.create({
        brandId: 'brand-1',
        slug: 'links',
        title: 'Apex Official',
        bio: 'Check out our new season.',
        buttonLinks: [{ id: 'b1', title: 'New Arrivals', url: 'https://apex.com/new' }],
        shoppableGrid: [{ id: 'g1', imageUrl: 'https://apex.com/img.jpg', productUrl: 'https://apex.com/p' }],
      } as any);

      const detail = await smartLinksService.get(link.id);
      const html = smartLinksService.renderHtml(detail);
      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('<title>Apex Official</title>');
      expect(html).toContain('New Arrivals');
      expect(html).toContain('Shop The Feed');
      expect(html).toContain('navigator.sendBeacon');
    });
  });

  // ─── 4. Cross-Network Paid Ad Performance Sync ──────────────────────────────────
  describe('Paid Ad Account Performance Sync', () => {
    it('creates an ad account sync and computes CPC', async () => {
      const adSync = await adSyncService.create({
        brandId: 'brand-1',
        platform: 'meta',
        adAccountName: 'Meta Ads - Scale',
        spend: 1000,
        impressions: 40000,
        clicks: 1250,
        roas: 3.5,
      } as any);

      expect(adSync.platform).toBe('meta');
      expect(adSync.spend).toBe(1000);
      expect(adSync.clicks).toBe(1250);
      expect(adSync.cpc).toBe(0.8); // 1000 / 1250
      expect(adSync.roas).toBe(3.5);
    });

    it('performs live syncNow simulation updating metrics', async () => {
      const adSync = await adSyncService.create({
        brandId: 'brand-1',
        platform: 'google',
        spend: 500,
        impressions: 10000,
        clicks: 400,
      } as any);

      const syncResult = await adSyncService.syncNow(adSync.id);
      expect(syncResult.synced).toBe(true);
      expect(syncResult.adSync.spend).toBeGreaterThan(500);
      expect(syncResult.adSync.impressions).toBeGreaterThan(10000);
      expect(syncResult.adSync.clicks).toBeGreaterThan(400);
      expect(syncResult.adSync.cpc).toBeGreaterThan(0);
    });
  });
});
