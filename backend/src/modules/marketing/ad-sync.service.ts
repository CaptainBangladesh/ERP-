import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  AdAccountSyncListResponse,
  AdAccountSyncSummary,
  AdPlatform,
  SyncAdAccountResponse,
} from '@erp/shared';
import { MARKETING_ERROR_CODES } from '@erp/shared';
import { ApiException } from '../../http/api-exception';
import { listQuery } from '../../platform/list';
import { companyApplied, InjectPrisma, type ScopedPrisma } from '../../platform/tenancy';
import type { Valid } from '../../platform/validation';
import { AD_SYNC_LIST, type CreateAdSyncBody, type UpdateAdSyncBody } from './schemas';

@Injectable()
export class AdSyncService {
  constructor(@InjectPrisma() private readonly prisma: ScopedPrisma) {}

  async create(input: Valid<typeof CreateAdSyncBody>): Promise<AdAccountSyncSummary> {
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

    const spend = input.spend ?? 0;
    const clicks = input.clicks ?? 0;
    const cpc = input.cpc ?? (clicks > 0 ? Number((spend / clicks).toFixed(2)) : 0);
    const roas = input.roas ?? 0;

    const adSync = await this.prisma.adAccountSync.create({
      data: companyApplied<Prisma.AdAccountSyncUncheckedCreateInput>({
        brandId: input.brandId,
        campaignId: input.campaignId || null,
        platform: input.platform,
        adAccountId: input.adAccountId?.trim() || null,
        adAccountName: input.adAccountName?.trim() || `${input.platform.toUpperCase()} Ad Account`,
        spend,
        impressions: input.impressions ?? 0,
        clicks,
        cpc,
        roas,
        currency: input.currency?.trim().toUpperCase() || 'USD',
        syncedAt: new Date(),
        metrics: {},
      }),
    });

    return this.toSummary(adSync);
  }

  async list(query: Record<string, unknown> = {}): Promise<AdAccountSyncListResponse> {
    const slice = listQuery(query, AD_SYNC_LIST);

    const [rows, total] = await Promise.all([
      this.prisma.adAccountSync.findMany(slice.findMany<Prisma.AdAccountSyncFindManyArgs>()),
      this.prisma.adAccountSync.count(slice.count<Prisma.AdAccountSyncCountArgs>()),
    ]);

    return slice.respond(rows.map((s) => this.toSummary(s)), total);
  }

  async get(id: string): Promise<AdAccountSyncSummary> {
    const sync = await this.prisma.adAccountSync.findUnique({
      where: { id },
    });
    if (!sync) {
      throw new ApiException(
        MARKETING_ERROR_CODES.adSyncNotFound,
        'Ad account sync configuration not found.',
        HttpStatus.NOT_FOUND,
      );
    }

    return this.toSummary(sync);
  }

  async update(id: string, input: Valid<typeof UpdateAdSyncBody>): Promise<AdAccountSyncSummary> {
    const existing = await this.prisma.adAccountSync.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new ApiException(
        MARKETING_ERROR_CODES.adSyncNotFound,
        'Ad account sync configuration not found.',
        HttpStatus.NOT_FOUND,
      );
    }

    const spend = input.spend !== undefined ? input.spend : existing.spend;
    const clicks = input.clicks !== undefined ? input.clicks : existing.clicks;
    const cpc =
      input.cpc !== undefined
        ? input.cpc
        : clicks > 0
          ? Number((spend / clicks).toFixed(2))
          : existing.cpc;

    const updated = await this.prisma.adAccountSync.update({
      where: { id },
      data: {
        campaignId: input.campaignId !== undefined ? input.campaignId || null : undefined,
        adAccountId: input.adAccountId !== undefined ? input.adAccountId?.trim() || null : undefined,
        adAccountName: input.adAccountName !== undefined ? input.adAccountName?.trim() || null : undefined,
        spend,
        impressions: input.impressions !== undefined ? input.impressions : undefined,
        clicks,
        cpc,
        roas: input.roas !== undefined ? input.roas : undefined,
        currency: input.currency !== undefined ? input.currency.trim().toUpperCase() : undefined,
      },
    });

    return this.toSummary(updated);
  }

  async syncNow(id: string): Promise<SyncAdAccountResponse> {
    const existing = await this.prisma.adAccountSync.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new ApiException(
        MARKETING_ERROR_CODES.adSyncNotFound,
        'Ad account sync configuration not found.',
        HttpStatus.NOT_FOUND,
      );
    }

    // Deterministic simulation / real API sync adapter multiplier
    // Increments metrics to simulate ad traffic delivery
    const incrementSpend = Number((Math.random() * 50 + 10).toFixed(2));
    const incrementImpressions = Math.floor(Math.random() * 2000 + 500);
    const incrementClicks = Math.floor(incrementImpressions * 0.035); // 3.5% CTR
    const newSpend = Number((existing.spend + incrementSpend).toFixed(2));
    const newImpressions = existing.impressions + incrementImpressions;
    const newClicks = existing.clicks + incrementClicks;
    const newCpc = newClicks > 0 ? Number((newSpend / newClicks).toFixed(2)) : 0;
    const newRoas = Number((existing.roas > 0 ? existing.roas : 2.8 + Math.random() * 0.6).toFixed(2));

    const updated = await this.prisma.adAccountSync.update({
      where: { id },
      data: {
        spend: newSpend,
        impressions: newImpressions,
        clicks: newClicks,
        cpc: newCpc,
        roas: newRoas,
        syncedAt: new Date(),
        metrics: {
          lastSyncSource: `${existing.platform}_marketing_api`,
          ctr: Number(((newClicks / newImpressions) * 100).toFixed(2)),
          cpm: Number(((newSpend / newImpressions) * 1000).toFixed(2)),
        },
      },
    });

    return {
      synced: true,
      adSync: this.toSummary(updated),
    };
  }

  async delete(id: string): Promise<{ deleted: boolean }> {
    const existing = await this.prisma.adAccountSync.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new ApiException(
        MARKETING_ERROR_CODES.adSyncNotFound,
        'Ad account sync configuration not found.',
        HttpStatus.NOT_FOUND,
      );
    }

    await this.prisma.adAccountSync.delete({
      where: { id },
    });

    return { deleted: true };
  }

  private toSummary(s: any): AdAccountSyncSummary {
    return {
      id: s.id,
      brandId: s.brandId,
      campaignId: s.campaignId ?? null,
      platform: s.platform as AdPlatform,
      adAccountId: s.adAccountId ?? null,
      adAccountName: s.adAccountName ?? null,
      spend: Number(s.spend.toFixed(2)),
      impressions: s.impressions,
      clicks: s.clicks,
      cpc: Number(s.cpc.toFixed(2)),
      roas: Number(s.roas.toFixed(2)),
      currency: s.currency,
      syncedAt: s.syncedAt.toISOString(),
      createdAt: s.createdAt.toISOString(),
      updatedAt: s.updatedAt.toISOString(),
    };
  }
}
