import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { MARKETING_ERROR_CODES, type AdWebhookResponse } from '@erp/shared';
import { ApiException } from '../../http/api-exception';
import { Public } from '../../platform/auth';
import { InjectPrisma, type ScopedPrisma, Tenancy } from '../../platform/tenancy';
import { validated, type Valid } from '../../platform/validation';
import { CrmBridgeService } from './crm-bridge.service';
import { AdWebhookBody, isAdWebhookPlatform } from './schemas';

/**
 * Lead ads, arriving from somebody else's server.
 *
 * Unauthenticated by necessity — Meta and Google will not hold a credential of ours — which
 * makes the body the entire attack surface, and until ticket 12 the body was `Record<string,
 * any>` with no validator at all. Three rules hold it now:
 *
 * - The platform segment is a closed union, not free text.
 * - Top-level keys outside the declared schema are a **400**, enforced by the `ClosedValidator`
 *   the schema is built with. The platform's validator drops unknown keys silently, which is
 *   right for our own API and wrong here: a platform that starts sending a new field should
 *   show up as a refusal somebody investigates rather than as data that quietly stopped
 *   arriving.
 * - A payload that parses but carries no usable contact field is **accepted and ignored**, not
 *   refused. There is nothing for the sender to fix, and a 4xx would put us in a platform's
 *   retry storm over our own strictness. The handler answers 202 throughout rather than
 *   varying the status per outcome, because writing to the response object directly is what
 *   the conformance pack's `error-shape` rule exists to prevent — and 202 is the honest code
 *   for a webhook anyway: received, and acted on out of the caller's sight.
 */
@Controller('api/marketing/webhooks/ads')
export class AdWebhooksController {
  constructor(
    @InjectPrisma() private readonly prisma: ScopedPrisma,
    private readonly tenancy: Tenancy,
    private readonly crmBridge: CrmBridgeService,
  ) {}

  @Public()
  @Post(':platform')
  @HttpCode(HttpStatus.ACCEPTED)
  async handleAdLeadWebhook(
    @Param('platform') platform: string,
    @Body(validated(AdWebhookBody)) validBody: Valid<typeof AdWebhookBody>,
    @Query() query: Record<string, string | undefined>,
  ): Promise<AdWebhookResponse> {
    const normalizedPlatform = platform.toLowerCase();

    if (!isAdWebhookPlatform(normalizedPlatform)) {
      throw new ApiException(
        MARKETING_ERROR_CODES.adWebhookPlatformUnknown,
        'That advertising platform is not one this endpoint accepts.',
        HttpStatus.BAD_REQUEST,
      );
    }

    // Only the declared keys, and only the ones that actually arrived — what gets stored as
    // the raw payload from here on.
    const body: Record<string, unknown> = Object.fromEntries(
      Object.entries(validBody as Record<string, unknown>).filter(
        ([, value]) => value !== undefined,
      ),
    );

    // 1. Resolve Brand and Company
    const requestedBrandId = query.brandId || validBody.brandId;
    const requestedCompanyId = query.companyId;

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
    let email = validBody.email;
    let name = validBody.name || validBody.full_name;
    let phone = validBody.phone || validBody.phone_number;
    let company = validBody.company || validBody.company_name;

    // Meta Leadgen field_data array format: [{ name: 'email', values: ['...'] }]
    if (validBody.field_data) {
      for (const field of validBody.field_data) {
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
    if (validBody.user_column_data) {
      for (const col of validBody.user_column_data) {
        const colId = String(col.column_id || '').toUpperCase();
        const val = col.string_value;
        if (!val) continue;
        if (colId === 'EMAIL') email = String(val);
        else if (colId === 'FULL_NAME') name = String(val);
        else if (colId === 'PHONE_NUMBER') phone = String(val);
        else if (colId === 'COMPANY_NAME') company = String(val);
      }
    }

    // Nothing to make a lead out of. A 202 rather than a 400: the sender has nothing to fix,
    // and refusing would earn us a platform's retry storm for our own strictness.
    if (!email && !phone && !name) {
      return {
        received: true,
        platform: normalizedPlatform,
        leadId: '',
        isNewLead: false,
      };
    }

    const utmSource = validBody.utmSource || (normalizedPlatform.includes('meta') || normalizedPlatform.includes('facebook') ? 'facebook' : 'google');
    const utmMedium = validBody.utmMedium || 'cpc';
    const utmCampaign = validBody.utmCampaign || validBody.campaign_name || validBody.ad_name || 'Lead Ads Campaign';

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
          term: validBody.utmTerm || validBody.adset_name,
          content: validBody.utmContent || validBody.ad_id,
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
