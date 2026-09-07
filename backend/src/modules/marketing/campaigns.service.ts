import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  BuildUtmRequest,
  BuildUtmResponse,
  MarketingCampaignDetailResponse,
  MarketingCampaignListResponse,
  MarketingCampaignStatus,
  MarketingCampaignSummary,
} from '@erp/shared';
import { MARKETING_ERROR_CODES } from '@erp/shared';
import { ApiException } from '../../http/api-exception';
import { listQuery } from '../../platform/list';
import { companyApplied, InjectPrisma, type ScopedPrisma } from '../../platform/tenancy';
import type { Valid } from '../../platform/validation';
import { CAMPAIGN_LIST, type CreateCampaignBody, type UpdateCampaignBody } from './schemas';
import { UtmService } from './utm.service';

@Injectable()
export class CampaignsService {
  constructor(
    @InjectPrisma() private readonly prisma: ScopedPrisma,
    private readonly utmService: UtmService,
  ) {}

  async create(input: Valid<typeof CreateCampaignBody>): Promise<MarketingCampaignSummary> {
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

    const campaign = await this.prisma.marketingCampaign.create({
      data: companyApplied<Prisma.MarketingCampaignUncheckedCreateInput>({
        brandId: input.brandId,
        name: input.name.trim(),
        description: input.description?.trim() || null,
        budget: input.budget ?? 0,
        startDate: input.startDate ? new Date(input.startDate) : null,
        endDate: input.endDate ? new Date(input.endDate) : null,
        status: input.status ?? 'ACTIVE',
        utmSource: input.utmSource?.trim() || null,
        utmMedium: input.utmMedium?.trim() || null,
        utmCampaign: input.utmCampaign?.trim() || null,
        utmTerm: input.utmTerm?.trim() || null,
        utmContent: input.utmContent?.trim() || null,
        metadata: (input.metadata as any) ?? undefined,
      }),
    });

    return this.toSummary(campaign, 0, 0, 0, 0, 0, 0);
  }

  async list(query: Record<string, unknown> = {}): Promise<MarketingCampaignListResponse> {
    const slice = listQuery(query, CAMPAIGN_LIST);

    const [rows, total] = await Promise.all([
      this.prisma.marketingCampaign.findMany({
        ...slice.findMany<Prisma.MarketingCampaignFindManyArgs>(),
        include: {
          _count: {
            select: {
              scheduledPosts: true,
              smartLinks: true,
            },
          },
          adSyncs: true,
        },
      }),
      this.prisma.marketingCampaign.count(slice.count<Prisma.MarketingCampaignCountArgs>()),
    ]);

    const items = rows.map((c) => {
      const adSpend = c.adSyncs.reduce((sum, a) => sum + a.spend, 0);
      const adImpressions = c.adSyncs.reduce((sum, a) => sum + a.impressions, 0);
      const adClicks = c.adSyncs.reduce((sum, a) => sum + a.clicks, 0);
      const avgRoas =
        c.adSyncs.length > 0
          ? c.adSyncs.reduce((sum, a) => sum + a.roas, 0) / c.adSyncs.length
          : 0;

      return this.toSummary(
        c,
        c._count.scheduledPosts,
        c._count.smartLinks,
        adSpend,
        adImpressions,
        adClicks,
        avgRoas,
      );
    });

    return slice.respond(items, total);
  }

  async get(id: string): Promise<MarketingCampaignDetailResponse> {
    const campaign = await this.prisma.marketingCampaign.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            scheduledPosts: true,
            smartLinks: true,
          },
        },
        smartLinks: true,
        adSyncs: true,
      },
    });

    if (!campaign) {
      throw new ApiException(
        MARKETING_ERROR_CODES.campaignNotFound,
        'Campaign not found.',
        HttpStatus.NOT_FOUND,
      );
    }

    const adSpend = campaign.adSyncs.reduce((sum, a) => sum + a.spend, 0);
    const adImpressions = campaign.adSyncs.reduce((sum, a) => sum + a.impressions, 0);
    const adClicks = campaign.adSyncs.reduce((sum, a) => sum + a.clicks, 0);
    const avgRoas =
      campaign.adSyncs.length > 0
        ? campaign.adSyncs.reduce((sum, a) => sum + a.roas, 0) / campaign.adSyncs.length
        : 0;

    const summary = this.toSummary(
      campaign,
      campaign._count.scheduledPosts,
      campaign._count.smartLinks,
      adSpend,
      adImpressions,
      adClicks,
      avgRoas,
    );

    return {
      ...summary,
      metadata: (campaign.metadata as Record<string, unknown>) ?? null,
      smartLinks: campaign.smartLinks.map((sl) => ({
        id: sl.id,
        brandId: sl.brandId,
        campaignId: sl.campaignId,
        slug: sl.slug,
        title: sl.title,
        bio: sl.bio,
        avatarUrl: sl.avatarUrl,
        viewCount: sl.viewCount,
        clickCount: sl.clickCount,
        ctr: sl.viewCount > 0 ? Number(((sl.clickCount / sl.viewCount) * 100).toFixed(2)) : 0,
        isActive: sl.isActive,
        buttonLinksCount: Array.isArray(sl.buttonLinks) ? sl.buttonLinks.length : 0,
        shoppableGridCount: Array.isArray(sl.shoppableGrid) ? sl.shoppableGrid.length : 0,
        createdAt: sl.createdAt.toISOString(),
        updatedAt: sl.updatedAt.toISOString(),
      })),
      adSyncs: campaign.adSyncs.map((a) => ({
        id: a.id,
        brandId: a.brandId,
        campaignId: a.campaignId,
        platform: a.platform as any,
        adAccountId: a.adAccountId,
        adAccountName: a.adAccountName,
        spend: a.spend,
        impressions: a.impressions,
        clicks: a.clicks,
        cpc: a.cpc,
        roas: a.roas,
        currency: a.currency,
        syncedAt: a.syncedAt.toISOString(),
        createdAt: a.createdAt.toISOString(),
        updatedAt: a.updatedAt.toISOString(),
      })),
    };
  }

  async update(id: string, input: Valid<typeof UpdateCampaignBody>): Promise<MarketingCampaignSummary> {
    const existing = await this.prisma.marketingCampaign.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new ApiException(
        MARKETING_ERROR_CODES.campaignNotFound,
        'Campaign not found.',
        HttpStatus.NOT_FOUND,
      );
    }

    const updated = await this.prisma.marketingCampaign.update({
      where: { id },
      data: {
        name: input.name !== undefined ? input.name.trim() : undefined,
        description: input.description !== undefined ? input.description.trim() || null : undefined,
        budget: input.budget !== undefined ? input.budget : undefined,
        spent: input.spent !== undefined ? input.spent : undefined,
        startDate: input.startDate !== undefined ? (input.startDate ? new Date(input.startDate) : null) : undefined,
        endDate: input.endDate !== undefined ? (input.endDate ? new Date(input.endDate) : null) : undefined,
        status: input.status !== undefined ? input.status : undefined,
        utmSource: input.utmSource !== undefined ? input.utmSource.trim() || null : undefined,
        utmMedium: input.utmMedium !== undefined ? input.utmMedium.trim() || null : undefined,
        utmCampaign: input.utmCampaign !== undefined ? input.utmCampaign.trim() || null : undefined,
        utmTerm: input.utmTerm !== undefined ? input.utmTerm.trim() || null : undefined,
        utmContent: input.utmContent !== undefined ? input.utmContent.trim() || null : undefined,
        metadata: input.metadata !== undefined ? (input.metadata as any) : undefined,
      },
      include: {
        _count: {
          select: {
            scheduledPosts: true,
            smartLinks: true,
          },
        },
        adSyncs: true,
      },
    });

    const adSpend = updated.adSyncs.reduce((sum, a) => sum + a.spend, 0);
    const adImpressions = updated.adSyncs.reduce((sum, a) => sum + a.impressions, 0);
    const adClicks = updated.adSyncs.reduce((sum, a) => sum + a.clicks, 0);
    const avgRoas =
      updated.adSyncs.length > 0
        ? updated.adSyncs.reduce((sum, a) => sum + a.roas, 0) / updated.adSyncs.length
        : 0;

    return this.toSummary(
      updated,
      updated._count.scheduledPosts,
      updated._count.smartLinks,
      adSpend,
      adImpressions,
      adClicks,
      avgRoas,
    );
  }

  async delete(id: string): Promise<{ deleted: boolean }> {
    const existing = await this.prisma.marketingCampaign.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new ApiException(
        MARKETING_ERROR_CODES.campaignNotFound,
        'Campaign not found.',
        HttpStatus.NOT_FOUND,
      );
    }

    await this.prisma.marketingCampaign.delete({
      where: { id },
    });

    return { deleted: true };
  }

  async buildUtm(req: BuildUtmRequest): Promise<BuildUtmResponse> {
    if (req.campaignId) {
      const campaign = await this.prisma.marketingCampaign.findUnique({
        where: { id: req.campaignId },
      });
      if (campaign) {
        if (!req.source && campaign.utmSource) req.source = campaign.utmSource;
        if (!req.medium && campaign.utmMedium) req.medium = campaign.utmMedium;
        if (!req.campaign && campaign.utmCampaign) req.campaign = campaign.utmCampaign;
      }
    }

    return this.utmService.build(req);
  }

  private toSummary(
    c: any,
    postsCount = 0,
    smartLinksCount = 0,
    adSpend = 0,
    adImpressions = 0,
    adClicks = 0,
    roas = 0,
  ): MarketingCampaignSummary {
    return {
      id: c.id,
      brandId: c.brandId,
      name: c.name,
      description: c.description ?? null,
      budget: c.budget,
      spent: c.spent,
      startDate: c.startDate ? c.startDate.toISOString() : null,
      endDate: c.endDate ? c.endDate.toISOString() : null,
      status: c.status as MarketingCampaignStatus,
      utmSource: c.utmSource ?? null,
      utmMedium: c.utmMedium ?? null,
      utmCampaign: c.utmCampaign ?? null,
      utmTerm: c.utmTerm ?? null,
      utmContent: c.utmContent ?? null,
      postsCount,
      smartLinksCount,
      adSpend: Number(adSpend.toFixed(2)),
      adImpressions,
      adClicks,
      roas: Number(roas.toFixed(2)),
      createdAt: c.createdAt.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
    };
  }
}
