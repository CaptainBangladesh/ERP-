import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import type { AdWebhookResponse } from '@erp/shared';
import { Public } from '../../platform/auth';
import { InjectPrisma, type ScopedPrisma, Tenancy } from '../../platform/tenancy';
import { CrmBridgeService } from './crm-bridge.service';

@Controller('api/marketing/webhooks/ads')
export class AdWebhooksController {
  constructor(
    @InjectPrisma() private readonly prisma: ScopedPrisma,
    private readonly tenancy: Tenancy,
    private readonly crmBridge: CrmBridgeService,
  ) {}

  @Public()
  @Post(':platform')
  @HttpCode(HttpStatus.OK)
  async handleAdLeadWebhook(
    @Param('platform') platform: string,
    @Body() body: Record<string, any>,
    @Query() query: Record<string, string | undefined>,
  ): Promise<AdWebhookResponse> {
    const normalizedPlatform = platform.toLowerCase();

    // 1. Resolve Brand and Company
    const requestedBrandId = query.brandId || body.brandId;
    const requestedCompanyId = query.companyId || body.companyId;

    let targetCompanyId = requestedCompanyId;
    let targetBrandId = requestedBrandId;

    if (!targetCompanyId || !targetBrandId) {
      // Look up brand or first available brand without company scope
      const brand = await this.tenancy.withoutCompanyScope(
        'marketing.webhooks.brand_lookup',
        async () => {
          if (requestedBrandId) {
            return this.prisma.marketingBrand.findUnique({
              where: { id: requestedBrandId },
            });
          }
          // Fallback: first brand with matching ad account sync or any active brand
          const adSync = await this.prisma.adAccountSync.findFirst({
            where: { platform: { contains: normalizedPlatform, mode: 'insensitive' } },
            include: { brand: true },
          });
          if (adSync?.brand) return adSync.brand;
          return this.prisma.marketingBrand.findFirst();
        },
      );

      if (brand) {
        targetCompanyId = targetCompanyId || brand.companyId;
        targetBrandId = targetBrandId || brand.id;
      }
    }

    if (!targetCompanyId) {
      return {
        received: false,
        platform: normalizedPlatform,
        leadId: '',
        isNewLead: false,
      };
    }

    // 2. Parse lead fields from Facebook / Google / Generic lead webhook payload
    let email: string | undefined = body.email;
    let name: string | undefined = body.name || body.full_name;
    let phone: string | undefined = body.phone || body.phone_number;
    let company: string | undefined = body.company || body.company_name;

    // Meta Leadgen field_data array format: [{ name: 'email', values: ['...'] }]
    if (Array.isArray(body.field_data)) {
      for (const field of body.field_data) {
        const fieldName = String(field.name || '').toLowerCase();
        const value = Array.isArray(field.values) ? field.values[0] : field.value;
        if (!value) continue;
        if (fieldName.includes('email')) {
          email = String(value);
        } else if (fieldName.includes('company') || fieldName.includes('org')) {
          company = String(value);
        } else if (fieldName.includes('phone')) {
          phone = String(value);
        } else if (fieldName.includes('name')) {
          name = String(value);
        }
      }
    }

    // Google Ads user_column_data format
    if (Array.isArray(body.user_column_data)) {
      for (const col of body.user_column_data) {
        const colId = String(col.column_id || '').toUpperCase();
        const val = col.string_value;
        if (!val) continue;
        if (colId === 'EMAIL') email = String(val);
        else if (colId === 'FULL_NAME') name = String(val);
        else if (colId === 'PHONE_NUMBER') phone = String(val);
        else if (colId === 'COMPANY_NAME') company = String(val);
      }
    }

    const utmSource = body.utmSource || (normalizedPlatform.includes('meta') || normalizedPlatform.includes('facebook') ? 'facebook' : 'google');
    const utmMedium = body.utmMedium || 'cpc';
    const utmCampaign = body.utmCampaign || body.campaign_name || body.ad_name || 'Lead Ads Campaign';

    // 3. Hand off lead inside company scope
    return this.tenancy.runInCompany({ companyId: targetCompanyId, grants: 'all' }, async () => {
      const result = await this.crmBridge.handoffLead({
        name,
        email,
        phone,
        organisationName: company,
        customFields: body,
        utm: {
          source: utmSource,
          medium: utmMedium,
          campaign: utmCampaign,
          term: body.utmTerm || body.adset_name,
          content: body.utmContent || body.ad_id,
        },
        sourceName: `${platform.toUpperCase()} Lead Ads`,
        brandId: targetBrandId,
        rawPayload: body,
      });

      return {
        received: true,
        platform: normalizedPlatform,
        leadId: result.leadId,
        isNewLead: result.isNew,
      };
    });
  }
}
