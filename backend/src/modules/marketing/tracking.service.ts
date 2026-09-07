import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import type {
  TrackingSiteSummary,
  TrackingSiteListResponse,
  TrackingAnalyticsResponse,
  DailyAnalyticsItem,
  PageAnalyticsItem,
  ReferrerAnalyticsItem,
  UtmCampaignAnalyticsItem,
  DeviceAnalyticsItem,
  CreateTrackingSiteRequest,
  CollectEventRequest,
} from '@erp/shared';
import { MARKETING_ERROR_CODES } from '@erp/shared';
import { ApiException } from '../../http/api-exception';
import { companyApplied, InjectPrisma, Tenancy, type ScopedPrisma } from '../../platform/tenancy';
import type { Valid } from '../../platform/validation';
import type { CollectEventBody, CreateTrackingSiteBody } from './schemas';
import { MARKETING_SECRET_VARS, marketingSecret } from './vault-secrets';

const BOT_REGEX =
  /bot|crawler|spider|slurp|googlebot|bingbot|yandex|baiduspider|duckduckbot|facebot|facebookexternalhit|ia_archiver|lighthouse|headlesschrome/i;

@Injectable()
export class TrackingService {
  constructor(
    @InjectPrisma() private readonly prisma: ScopedPrisma,
    private readonly tenancy: Tenancy,
  ) {}

  /**
   * Create a new tracking site for a brand.
   */
  async createSite(input: CreateTrackingSiteRequest): Promise<TrackingSiteSummary> {
    const brand = await this.prisma.marketingBrand.findUnique({
      where: { id: input.brandId },
    });
    if (!brand) {
      throw new ApiException(
        MARKETING_ERROR_CODES.brandNotFound,
        'Brand not found.',
        HttpStatus.NOT_FOUND,
      );
    }

    const created = await this.prisma.trackingSite.create({
      data: companyApplied<Prisma.TrackingSiteUncheckedCreateInput>({
        brandId: input.brandId,
        name: input.name,
        domain: input.domain.replace(/^https?:\/\//i, '').replace(/\/.*$/, '').toLowerCase(),
        isActive: input.isActive ?? true,
      }),
    });

    return this.toSummary(created);
  }

  /**
   * List tracking sites, optionally scoped to a brand.
   */
  async listSites(brandId?: string): Promise<TrackingSiteListResponse> {
    const where: Prisma.TrackingSiteWhereInput = brandId ? { brandId } : {};

    const [items, total] = await Promise.all([
      this.prisma.trackingSite.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        include: {
          _count: {
            select: { pageViews: true },
          },
        },
      }),
      this.prisma.trackingSite.count({ where }),
    ]);

    return {
      items: items.map((site) => this.toSummary(site, site._count?.pageViews)),
      page: {
        number: 1,
        size: items.length,
        total,
        pages: total > 0 ? 1 : 0,
      },
    };
  }

  /**
   * Get tracking site by ID.
   */
  async getSite(id: string): Promise<TrackingSiteSummary> {
    const site = await this.prisma.trackingSite.findUnique({
      where: { id },
      include: {
        _count: {
          select: { pageViews: true },
        },
      },
    });

    if (!site) {
      throw new ApiException(
        MARKETING_ERROR_CODES.trackingSiteNotFound,
        'Tracking site not found.',
        HttpStatus.NOT_FOUND,
      );
    }

    return this.toSummary(site, site._count?.pageViews);
  }

  /**
   * Delete a tracking site.
   */
  async deleteSite(id: string): Promise<void> {
    const site = await this.prisma.trackingSite.findUnique({
      where: { id },
    });

    if (!site) {
      throw new ApiException(
        MARKETING_ERROR_CODES.trackingSiteNotFound,
        'Tracking site not found.',
        HttpStatus.NOT_FOUND,
      );
    }

    await this.prisma.trackingSite.delete({
      where: { id },
    });
  }

  /**
   * Ultra-lightweight first-party JavaScript tracking pixel (< 2.2 KB).
   */
  getPixelScript(): string {
    return `(function(w,d){'use strict';try{var s=d.currentScript||d.querySelector('script[data-site]');var k=s?s.getAttribute('data-site'):null;if(!k)return;var V='_erp_vid',S='_erp_sid',E='_erp_sid_exp';function u(){return'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,function(c){var r=Math.random()*16|0,v=c==='x'?r:(r&0x3|0x8);return v.toString(16);});}var vid='';try{vid=w.localStorage.getItem(V);if(!vid){vid=u();w.localStorage.setItem(V,vid);}}catch(e){vid=u();}var now=Date.now(),sid='';try{var exp=parseInt(w.sessionStorage.getItem(E)||'0',10);sid=w.sessionStorage.getItem(S);if(!sid||now>exp){sid=u();w.sessionStorage.setItem(S,sid);}w.sessionStorage.setItem(E,(now+1800000).toString());}catch(e){sid=u();}var p=new URLSearchParams(w.location.search);var payload={pixelKey:k,visitorId:vid,sessionId:sid,path:w.location.pathname+(w.location.search||''),referrer:d.referrer||undefined,utmSource:p.get('utm_source')||undefined,utmMedium:p.get('utm_medium')||undefined,utmCampaign:p.get('utm_campaign')||undefined,utmTerm:p.get('utm_term')||undefined,utmContent:p.get('utm_content')||undefined,screen:w.screen?w.screen.width+'x'+w.screen.height:undefined};var ep=s.getAttribute('data-endpoint')||(s.src?new URL(s.src).origin+'/api/marketing/collect':'/api/marketing/collect');var json=JSON.stringify(payload);if(w.navigator&&w.navigator.sendBeacon){w.navigator.sendBeacon(ep,new Blob([json],{type:'application/json'}));}else if(w.fetch){w.fetch(ep,{method:'POST',headers:{'Content-Type':'application/json'},body:json,keepalive:true,credentials:'omit'}).catch(function(){});}else{var x=new XMLHttpRequest();x.open('POST',ep,true);x.setRequestHeader('Content-Type','application/json');x.send(json);}}catch(e){}})(window,document);`;
  }

  /**
   * Ingest a real-time tracking beacon.
   * Public endpoint with bot filtering and cookieless GDPR hash.
   */
  async recordBeacon(
    dto: CollectEventRequest,
    meta: { userAgent?: string; referer?: string; ip?: string },
  ): Promise<void> {
    // 1. Bot filtering
    if (meta.userAgent && BOT_REGEX.test(meta.userAgent)) {
      return;
    }

    // 2. Resolve tracking site via withoutCompanyScope
    const site = await this.tenancy.withoutCompanyScope(
      'marketing.tracking.resolve_site',
      async () => {
        return (this.prisma as any).trackingSite.findUnique({
          where: { pixelKey: dto.pixelKey },
        });
      },
    );

    if (!site || !site.isActive) {
      return;
    }

    // 3. Classify device
    let device = dto.device;
    if (!device && meta.userAgent) {
      if (/ipad|tablet|playbook|silk/i.test(meta.userAgent)) {
        device = 'tablet';
      } else if (/mobile|iphone|android|phone|ipod/i.test(meta.userAgent)) {
        device = 'mobile';
      } else {
        device = 'desktop';
      }
    }

    // 4. Ingest pageview event
    await this.tenancy.withoutCompanyScope(
      'marketing.tracking.record_event',
      async () => {
        await (this.prisma as any).pageViewEvent.create({
          data: {
            companyId: site.companyId,
            trackingSiteId: site.id,
            visitorId: dto.visitorId,
            sessionId: dto.sessionId || null,
            path: dto.path,
            referrer: dto.referrer || meta.referer || null,
            utmSource: dto.utmSource || null,
            utmMedium: dto.utmMedium || null,
            utmCampaign: dto.utmCampaign || null,
            utmTerm: dto.utmTerm || null,
            utmContent: dto.utmContent || null,
            country: dto.country || null,
            device: device || 'desktop',
            browser: dto.browser || null,
            ipHash: meta.ip ? this.hashIp(meta.ip) : null,
            timestamp: new Date(),
          },
        });
      },
    );
  }

  /**
   * Aggregate analytics for a single site.
   */
  async getSiteAnalytics(
    siteId: string,
    query: { startDate?: string; endDate?: string },
  ): Promise<TrackingAnalyticsResponse> {
    const site = await this.prisma.trackingSite.findUnique({
      where: { id: siteId },
    });
    if (!site) {
      throw new ApiException(
        MARKETING_ERROR_CODES.trackingSiteNotFound,
        'Tracking site not found.',
        HttpStatus.NOT_FOUND,
      );
    }

    const where: Prisma.PageViewEventWhereInput = {
      trackingSiteId: siteId,
    };

    if (query.startDate || query.endDate) {
      where.timestamp = {};
      if (query.startDate) {
        where.timestamp.gte = new Date(query.startDate);
      }
      if (query.endDate) {
        where.timestamp.lte = new Date(query.endDate);
      }
    }

    const events = await this.prisma.pageViewEvent.findMany({
      where,
      orderBy: { timestamp: 'asc' },
    });

    return this.aggregateEvents(events, { siteId, brandId: site.brandId });
  }

  /**
   * Aggregate daily visitor, session, and pageview counts across brand and campaigns.
   */
  async getAnalyticsOverview(
    brandId: string,
    options: {
      campaignId?: string;
      utmCampaign?: string;
      startDate?: string;
      endDate?: string;
    } = {},
  ): Promise<TrackingAnalyticsResponse> {
    const brand = await this.prisma.marketingBrand.findUnique({
      where: { id: brandId },
    });
    if (!brand) {
      throw new ApiException(
        MARKETING_ERROR_CODES.brandNotFound,
        'Brand not found.',
        HttpStatus.NOT_FOUND,
      );
    }

    // Resolve sites for brand
    const sites = await this.prisma.trackingSite.findMany({
      where: { brandId },
      select: { id: true },
    });

    if (sites.length === 0) {
      return {
        brandId,
        totalPageviews: 0,
        totalVisitors: 0,
        totalSessions: 0,
        daily: [],
        topPages: [],
        topReferrers: [],
        campaigns: [],
        devices: [],
      };
    }

    const siteIds = sites.map((s) => s.id);

    // Resolve campaign UTM filter if campaignId is passed
    let targetUtm = options.utmCampaign;
    if (options.campaignId && !targetUtm) {
      const campaign = await this.prisma.marketingCampaign.findUnique({
        where: { id: options.campaignId },
      });
      if (campaign) {
        targetUtm = campaign.name;
      }
    }

    const where: Prisma.PageViewEventWhereInput = {
      trackingSiteId: { in: siteIds },
    };

    if (targetUtm) {
      where.utmCampaign = { equals: targetUtm, mode: 'insensitive' };
    }

    if (options.startDate || options.endDate) {
      where.timestamp = {};
      if (options.startDate) {
        where.timestamp.gte = new Date(options.startDate);
      }
      if (options.endDate) {
        where.timestamp.lte = new Date(options.endDate);
      }
    }

    const events = await this.prisma.pageViewEvent.findMany({
      where,
      orderBy: { timestamp: 'asc' },
    });

    return this.aggregateEvents(events, { brandId });
  }

  /**
   * Helper to aggregate event logs into daily metrics, top pages, referrers, campaigns, and devices.
   */
  private aggregateEvents(
    events: any[],
    context: { siteId?: string; brandId?: string },
  ): TrackingAnalyticsResponse {
    const totalPageviews = events.length;
    const visitorSet = new Set<string>();
    const sessionSet = new Set<string>();

    const dailyMap = new Map<
      string,
      { pageviews: number; visitors: Set<string>; sessions: Set<string> }
    >();
    const pagesMap = new Map<string, number>();
    const referrersMap = new Map<string, number>();
    const campaignsMap = new Map<
      string,
      { pageviews: number; visitors: Set<string> }
    >();
    const devicesMap = new Map<string, number>();

    for (const ev of events) {
      visitorSet.add(ev.visitorId);
      const sid = ev.sessionId || ev.visitorId;
      sessionSet.add(sid);

      // Daily date key (YYYY-MM-DD)
      const d = new Date(ev.timestamp);
      const dateKey: string = !isNaN(d.getTime())
        ? (d.toISOString().split('T')[0] ?? 'unknown')
        : 'unknown';

      if (!dailyMap.has(dateKey)) {
        dailyMap.set(dateKey, {
          pageviews: 0,
          visitors: new Set(),
          sessions: new Set(),
        });
      }
      const dayData = dailyMap.get(dateKey)!;
      dayData.pageviews += 1;
      dayData.visitors.add(ev.visitorId);
      dayData.sessions.add(sid);

      // Pages
      const path = ev.path || '/';
      pagesMap.set(path, (pagesMap.get(path) || 0) + 1);

      // Referrers
      if (ev.referrer) {
        try {
          const refHost = new URL(ev.referrer).hostname || ev.referrer;
          referrersMap.set(refHost, (referrersMap.get(refHost) || 0) + 1);
        } catch {
          referrersMap.set(ev.referrer, (referrersMap.get(ev.referrer) || 0) + 1);
        }
      }

      // Campaigns
      if (ev.utmCampaign) {
        if (!campaignsMap.has(ev.utmCampaign)) {
          campaignsMap.set(ev.utmCampaign, { pageviews: 0, visitors: new Set() });
        }
        const c = campaignsMap.get(ev.utmCampaign)!;
        c.pageviews += 1;
        c.visitors.add(ev.visitorId);
      }

      // Devices
      const dev = ev.device || 'desktop';
      devicesMap.set(dev, (devicesMap.get(dev) || 0) + 1);
    }

    const daily: DailyAnalyticsItem[] = Array.from(dailyMap.entries())
      .map(([date, data]) => ({
        date,
        pageviews: data.pageviews,
        visitors: data.visitors.size,
        sessions: data.sessions.size,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    const topPages: PageAnalyticsItem[] = Array.from(pagesMap.entries())
      .map(([path, pageviews]) => ({ path, pageviews }))
      .sort((a, b) => b.pageviews - a.pageviews)
      .slice(0, 15);

    const topReferrers: ReferrerAnalyticsItem[] = Array.from(referrersMap.entries())
      .map(([referrer, pageviews]) => ({ referrer, pageviews }))
      .sort((a, b) => b.pageviews - a.pageviews)
      .slice(0, 15);

    const campaigns: UtmCampaignAnalyticsItem[] = Array.from(campaignsMap.entries())
      .map(([utmCampaign, data]) => ({
        utmCampaign,
        pageviews: data.pageviews,
        visitors: data.visitors.size,
      }))
      .sort((a, b) => b.pageviews - a.pageviews);

    const devices: DeviceAnalyticsItem[] = Array.from(devicesMap.entries())
      .map(([device, count]) => ({ device, count }))
      .sort((a, b) => b.count - a.count);

    return {
      siteId: context.siteId,
      brandId: context.brandId,
      totalPageviews,
      totalVisitors: visitorSet.size,
      totalSessions: sessionSet.size,
      daily,
      topPages,
      topReferrers,
      campaigns,
      devices,
    };
  }

  /**
   * The pseudonymous visitor hash.
   *
   * The date is a *rotation input*, not the secret. Rotating daily was the right instinct and
   * the original implementation stopped one step short: the salt **was** the date, so it was
   * public. IPv4 is 2^32 addresses; a database dump plus a known salt de-anonymises every
   * visitor in seconds on a laptop — on the one column this module sells as a cookieless,
   * GDPR-safe hash. The pepper is what makes the hash actually one-way to somebody holding
   * only the rows.
   *
   * The pepper is deliberately **not** rotated on a schedule, and that is a trade rather than
   * an oversight: rotating it makes the same visitor look like two, so unique-visitor counts
   * break across the boundary. It is never logged and never appears in a DTO. No raw IP is
   * persisted anywhere, including inside `rawPayload` blobs.
   */
  private hashIp(ip: string): string {
    const day = new Date().toISOString().split('T')[0];
    const pepper = marketingSecret(MARKETING_SECRET_VARS.analyticsPepper);
    return createHash('sha256')
      .update(`${ip}:${day}:${pepper}`)
      .digest('hex')
      .substring(0, 16);
  }

  private toSummary(site: any, pageViewCount?: number): TrackingSiteSummary {
    return {
      id: site.id,
      brandId: site.brandId,
      name: site.name,
      domain: site.domain,
      pixelKey: site.pixelKey,
      isActive: site.isActive,
      createdAt: site.createdAt instanceof Date ? site.createdAt.toISOString() : site.createdAt,
      updatedAt: site.updatedAt instanceof Date ? site.updatedAt.toISOString() : site.updatedAt,
      _count: {
        pageViews: pageViewCount ?? site._count?.pageViews ?? 0,
      },
    };
  }
}
