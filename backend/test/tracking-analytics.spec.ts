import { TrackingService } from '../src/modules/marketing/tracking.service';
import { Tenancy } from '../src/platform/tenancy';
import { ApiException } from '../src/http/api-exception';
import { MARKETING_ERROR_CODES } from '@erp/shared';

describe('Tracking Pixel & Visitor Analytics Engine (Ticket 09)', () => {
  let mockBrands: any[];
  let mockTrackingSites: any[];
  let mockPageViewEvents: any[];
  let mockCampaigns: any[];

  let mockPrisma: any;
  let tenancy: Tenancy;
  let trackingService: TrackingService;

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
    mockTrackingSites = [];
    mockPageViewEvents = [];
    mockCampaigns = [
      {
        id: 'camp-1',
        companyId: 'company-1',
        brandId: 'brand-1',
        name: 'Spring_Launch_2026',
      },
    ];

    tenancy = new Tenancy();
    (tenancy as any).currentCompanyId = 'company-1';

    // Mock Prisma with company scoping emulation
    mockPrisma = {
      marketingBrand: {
        findUnique: jest.fn(async ({ where }) => {
          return mockBrands.find((b) => b.id === where.id) || null;
        }),
      },
      marketingCampaign: {
        findUnique: jest.fn(async ({ where }) => {
          return mockCampaigns.find((c) => c.id === where.id) || null;
        }),
      },
      trackingSite: {
        create: jest.fn(async ({ data }) => {
          const site = {
            id: `site-${mockTrackingSites.length + 1}`,
            companyId: 'company-1',
            pixelKey: `pix_${Math.random().toString(36).substring(2, 10)}`,
            createdAt: new Date(),
            updatedAt: new Date(),
            ...data,
          };
          mockTrackingSites.push(site);
          return site;
        }),
        findMany: jest.fn(async ({ where }) => {
          return mockTrackingSites
            .filter((s) => !where?.brandId || s.brandId === where.brandId)
            .map((s) => ({
              ...s,
              _count: {
                pageViews: mockPageViewEvents.filter((e) => e.trackingSiteId === s.id).length,
              },
            }));
        }),
        findUnique: jest.fn(async ({ where }) => {
          const s = mockTrackingSites.find(
            (item) =>
              (where.id && item.id === where.id) ||
              (where.pixelKey && item.pixelKey === where.pixelKey),
          );
          if (!s) return null;
          return {
            ...s,
            _count: {
              pageViews: mockPageViewEvents.filter((e) => e.trackingSiteId === s.id).length,
            },
          };
        }),
        count: jest.fn(async ({ where }) => {
          return mockTrackingSites.filter((s) => !where?.brandId || s.brandId === where.brandId).length;
        }),
        delete: jest.fn(async ({ where }) => {
          const idx = mockTrackingSites.findIndex((s) => s.id === where.id);
          if (idx !== -1) {
            mockTrackingSites.splice(idx, 1);
          }
          return { id: where.id };
        }),
      },
      pageViewEvent: {
        create: jest.fn(async ({ data }) => {
          const event = {
            id: `ev-${mockPageViewEvents.length + 1}`,
            createdAt: new Date(),
            timestamp: new Date(),
            ...data,
          };
          mockPageViewEvents.push(event);
          return event;
        }),
        findMany: jest.fn(async ({ where }) => {
          return mockPageViewEvents.filter((ev) => {
            if (where.trackingSiteId) {
              if (typeof where.trackingSiteId === 'string') {
                if (ev.trackingSiteId !== where.trackingSiteId) return false;
              } else if (where.trackingSiteId.in) {
                if (!where.trackingSiteId.in.includes(ev.trackingSiteId)) return false;
              }
            }
            if (where.utmCampaign && where.utmCampaign.equals) {
              if (ev.utmCampaign?.toLowerCase() !== where.utmCampaign.equals.toLowerCase()) {
                return false;
              }
            }
            return true;
          });
        }),
      },
    };

    trackingService = new TrackingService(mockPrisma as any, tenancy);
  });

  describe('1. Tracking Site Management', () => {
    it('creates a tracking site for a valid brand', async () => {
      const site = await trackingService.createSite({
        brandId: 'brand-1',
        name: 'Apex Main Store',
        domain: 'https://store.apexathletics.com/shop',
        isActive: true,
      });

      expect(site.id).toBeDefined();
      expect(site.name).toBe('Apex Main Store');
      expect(site.domain).toBe('store.apexathletics.com');
      expect(site.pixelKey).toBeDefined();
      expect(site.isActive).toBe(true);
    });

    it('rejects site creation if brand does not exist', async () => {
      await expect(
        trackingService.createSite({
          brandId: 'non-existent-brand',
          name: 'Apex Athletics',
          domain: 'apex.com',
          isActive: true,
        }),
      ).rejects.toThrow(ApiException);
    });

    it('lists tracking sites with pageview count metrics', async () => {
      const site = await trackingService.createSite({
        brandId: 'brand-1',
        name: 'Apex Blog',
        domain: 'blog.apex.com',
      });

      const list = await trackingService.listSites('brand-1');
      expect(list.items.length).toBe(1);
      expect(list.items[0]?.id).toBe(site.id);
      expect(list.items[0]?._count?.pageViews).toBe(0);
    });

    it('deletes a tracking site by id', async () => {
      const site = await trackingService.createSite({
        brandId: 'brand-1',
        name: 'Apex Promo Page',
        domain: 'promo.apex.com',
      });

      await trackingService.deleteSite(site.id);
      const list = await trackingService.listSites('brand-1');
      expect(list.items.length).toBe(0);
    });
  });

  describe('2. Client Pixel Script (pixel.js)', () => {
    it('serves ultra-lightweight client snippet (< 2.2 KB)', () => {
      const script = trackingService.getPixelScript();
      expect(typeof script).toBe('string');
      expect(script.length).toBeLessThan(2200);
      expect(script).toContain('data-site');
      expect(script).toContain('/api/marketing/collect');
      expect(script).toContain('sendBeacon');
    });
  });

  describe('3. Beacon Ingestion & Bot Filtering', () => {
    let site: any;

    beforeEach(async () => {
      site = await trackingService.createSite({
        brandId: 'brand-1',
        name: 'Store',
        domain: 'store.apex.com',
      });
    });

    it('records a valid pageview beacon', async () => {
      await trackingService.recordBeacon(
        {
          pixelKey: site.pixelKey,
          visitorId: 'vis-12345',
          sessionId: 'ses-67890',
          path: '/products/running-shoes',
          referrer: 'https://www.google.com/search?q=running+shoes',
          utmSource: 'google',
          utmMedium: 'cpc',
          utmCampaign: 'Spring_Launch_2026',
        },
        {
          userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)',
          ip: '192.168.1.1',
        },
      );

      expect(mockPageViewEvents.length).toBe(1);
      const ev = mockPageViewEvents[0];
      expect(ev.trackingSiteId).toBe(site.id);
      expect(ev.visitorId).toBe('vis-12345');
      expect(ev.path).toBe('/products/running-shoes');
      expect(ev.utmCampaign).toBe('Spring_Launch_2026');
      expect(ev.device).toBe('mobile');
    });

    it('filters out bot and crawler user agents without saving', async () => {
      await trackingService.recordBeacon(
        {
          pixelKey: site.pixelKey,
          visitorId: 'bot-visitor',
          path: '/robots.txt',
        },
        {
          userAgent: 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
        },
      );

      expect(mockPageViewEvents.length).toBe(0);
    });

    it('gracefully ignores beacon if pixelKey does not match an active site', async () => {
      await trackingService.recordBeacon(
        {
          pixelKey: 'invalid-pixel-key',
          visitorId: 'vis-test',
          path: '/home',
        },
        { userAgent: 'Mozilla/5.0 Chrome/120.0.0.0' },
      );

      expect(mockPageViewEvents.length).toBe(0);
    });
  });

  describe('4. Daily Visitor, Session & Pageview Aggregations', () => {
    let site: any;

    beforeEach(async () => {
      site = await trackingService.createSite({
        brandId: 'brand-1',
        name: 'Apex Store',
        domain: 'store.apex.com',
      });

      const today = new Date();
      // Record 3 events: 2 visitors, 2 sessions
      mockPageViewEvents.push(
        {
          id: 'ev-1',
          companyId: 'company-1',
          trackingSiteId: site.id,
          visitorId: 'user-A',
          sessionId: 'session-1',
          path: '/home',
          referrer: 'https://facebook.com',
          utmCampaign: 'Spring_Launch_2026',
          device: 'mobile',
          timestamp: today,
        },
        {
          id: 'ev-2',
          companyId: 'company-1',
          trackingSiteId: site.id,
          visitorId: 'user-A',
          sessionId: 'session-1',
          path: '/pricing',
          referrer: 'https://facebook.com',
          utmCampaign: 'Spring_Launch_2026',
          device: 'mobile',
          timestamp: today,
        },
        {
          id: 'ev-3',
          companyId: 'company-1',
          trackingSiteId: site.id,
          visitorId: 'user-B',
          sessionId: 'session-2',
          path: '/home',
          referrer: 'https://google.com',
          utmCampaign: 'Summer_Sale',
          device: 'desktop',
          timestamp: today,
        },
      );
    });

    it('aggregates daily visitor, session, and pageview counts for a site', async () => {
      const analytics = await trackingService.getSiteAnalytics(site.id, {});

      expect(analytics.totalPageviews).toBe(3);
      expect(analytics.totalVisitors).toBe(2);
      expect(analytics.totalSessions).toBe(2);

      // Daily breakdown
      expect(analytics.daily.length).toBe(1);
      expect(analytics.daily[0]?.pageviews).toBe(3);
      expect(analytics.daily[0]?.visitors).toBe(2);
      expect(analytics.daily[0]?.sessions).toBe(2);

      // Top pages
      expect(analytics.topPages.length).toBe(2);
      expect(analytics.topPages[0]?.path).toBe('/home');
      expect(analytics.topPages[0]?.pageviews).toBe(2);

      // Campaigns
      expect(analytics.campaigns.length).toBe(2);
      const spring = analytics.campaigns.find((c: any) => c.utmCampaign === 'Spring_Launch_2026');
      expect(spring?.pageviews).toBe(2);
      expect(spring?.visitors).toBe(1);

      // Devices
      const mobile = analytics.devices.find((d: any) => d.device === 'mobile');
      expect(mobile?.count).toBe(2);
    });

    it('aggregates overview filtered by campaign', async () => {
      const overview = await trackingService.getAnalyticsOverview('brand-1', {
        campaignId: 'camp-1', // Spring_Launch_2026
      });

      expect(overview.totalPageviews).toBe(2);
      expect(overview.totalVisitors).toBe(1);
      expect(overview.totalSessions).toBe(1);
      expect(overview.campaigns[0]?.utmCampaign).toBe('Spring_Launch_2026');
    });
  });
});
