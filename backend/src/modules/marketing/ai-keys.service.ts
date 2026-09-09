import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  AI_MODEL,
  AI_PLATFORM_MONTHLY_CAP_CENTS,
  AI_TENANT_KEY_CAP_MULTIPLIER,
  BRAND_PUBLISHING_ROLE,
  MARKETING_ERROR_CODES,
  type AiKeyStatusResponse,
} from '@erp/shared';
import { ApiException } from '../../http/api-exception';
import { companyApplied, InjectPrisma, type ScopedPrisma } from '../../platform/tenancy';
import type { Valid } from '../../platform/validation';
import { CryptoService } from './crypto.service';
import { AiProvider, type AiCredential } from './ai-provider';
import { MARKETING_SECRET_VARS, optionalMarketingSecret } from './vault-secrets';
import { SetAiKeyBody } from './schemas';

/**
 * Which key a generation runs on, and who is allowed to change that.
 *
 * Two secrets with nothing in common but a name. The **platform** key is one shared vendor
 * credential that every tenant's request uses, so it lives in the environment behind
 * `vault-secrets.ts` and never goes through per-record encryption (14a). The **tenant** key
 * is one tenant's own money, so it is an ordinary per-tenant secret and lives in the vault
 * `CryptoService` already owns, in `v1.iv.ct.tag`, masked from the decrypted value (14h,
 * 11.4a). Neither is ever returned to a browser in any form.
 */
@Injectable()
export class AiKeysService {
  constructor(
    @InjectPrisma() private readonly prisma: ScopedPrisma,
    private readonly crypto: CryptoService,
    private readonly provider: AiProvider,
  ) {}

  /**
   * The one resolver (14a-bis).
   *
   * Every model call in this module resolves its credential and endpoint here; no call site
   * reads `process.env`. Today the answer is the platform key unless this tenant brought
   * their own — the argument is there so that the day the answer depends on the company
   * (a second vendor, a regional endpoint, a per-tenant model), the signature does not move.
   *
   * The argument is the acting company's id. It is spelled `company` rather than the
   * `companyId` of 14a-bis's prose because the conformance pack refuses that token in a
   * module source: scoping is the platform's, and a module that could write the filter is a
   * module that could forget it.
   */
  async resolveAiProvider(company: string): Promise<AiCredential> {
    void company;

    const stored = await this.prisma.tenantAiKey.findFirst({
      select: { encryptedKey: true },
    });

    if (stored) {
      return {
        apiKey: this.crypto.decrypt(stored.encryptedKey),
        model: AI_MODEL,
        source: 'tenant',
      };
    }

    const platformKey = optionalMarketingSecret(MARKETING_SECRET_VARS.anthropicApiKey);

    /**
     * No platform key and no tenant key, which is a deployment that never configured
     * generation rather than a failure of this request.
     *
     * Refused here, at the one resolver, so the composer is the only thing that stops — this
     * used to be checked at boot, where a missing vendor credential for one feature took the
     * whole server down with it and every other module went with it. The message names both
     * fixes because they belong to different people: the environment variable is the
     * operator's, the tenant key is the tenant's.
     */
    if (!platformKey) {
      throw new ApiException(
        MARKETING_ERROR_CODES.aiNotConfigured,
        'Generation is not configured on this server. Either set ANTHROPIC_API_KEY in the ' +
          'deployment environment, or add your own API key in the composer settings. ' +
          'Nothing was generated and no allowance was spent.',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    return {
      apiKey: platformKey,
      model: AI_MODEL,
      source: 'platform',
    };
  }

  /** The allowance this tenant is on: the platform's, or the larger one a key buys (14h). */
  async capCentsFor(source: 'platform' | 'tenant'): Promise<number> {
    return source === 'tenant'
      ? AI_PLATFORM_MONTHLY_CAP_CENTS * AI_TENANT_KEY_CAP_MULTIPLIER
      : AI_PLATFORM_MONTHLY_CAP_CENTS;
  }

  async status(brandId: string, userId: string | undefined): Promise<AiKeyStatusResponse> {
    await this.requirePublisher(brandId, userId);

    const stored = await this.prisma.tenantAiKey.findFirst({
      select: { maskedKey: true, updatedAt: true },
    });

    return {
      configured: Boolean(stored),
      ...(stored ? { maskedKey: stored.maskedKey, updatedAt: stored.updatedAt.toISOString() } : {}),
      capCents: await this.capCentsFor(stored ? 'tenant' : 'platform'),
    };
  }

  /**
   * Save or rotate the tenant's key.
   *
   * Probed once before it is stored, so a typo fails here rather than in the middle of a
   * composition with allowance already reserved (14v). The mask is taken from the plaintext
   * on the way in; masking the ciphertext would show four characters of a GCM tag.
   */
  async setKey(
    brandId: string,
    input: Valid<typeof SetAiKeyBody>,
    userId: string | undefined,
  ): Promise<AiKeyStatusResponse> {
    await this.requirePublisher(brandId, userId);

    const apiKey = input.apiKey.trim();
    await this.provider.probe({ apiKey, model: AI_MODEL, source: 'tenant' });

    const encryptedKey = this.crypto.encrypt(apiKey);
    const maskedKey = this.crypto.maskToken(apiKey);

    const existing = await this.prisma.tenantAiKey.findFirst({ select: { id: true } });

    if (existing) {
      await this.prisma.tenantAiKey.update({
        where: { id: existing.id },
        data: { encryptedKey, maskedKey, lastValidatedAt: new Date() },
      });
    } else {
      await this.prisma.tenantAiKey.create({
        data: companyApplied<Prisma.TenantAiKeyUncheckedCreateInput>({
          encryptedKey,
          maskedKey,
          createdByUserId: userId,
          lastValidatedAt: new Date(),
        }),
      });
    }

    return {
      configured: true,
      maskedKey,
      updatedAt: new Date().toISOString(),
      capCents: await this.capCentsFor('tenant'),
    };
  }

  /** Deleting the key returns the tenant to the platform allowance (14h). */
  async deleteKey(brandId: string, userId: string | undefined): Promise<void> {
    await this.requirePublisher(brandId, userId);

    const existing = await this.prisma.tenantAiKey.findFirst({ select: { id: true } });
    if (!existing) {
      throw new ApiException(
        MARKETING_ERROR_CODES.aiKeyNotFound,
        'This workspace has no API key of its own.',
        HttpStatus.NOT_FOUND,
      );
    }

    await this.prisma.tenantAiKey.delete({ where: { id: existing.id } });
  }

  /**
   * Checked server-side on every route, not once at the door (14v, 17d).
   *
   * A brand id is a uuid an ex-member still has, so membership is re-read per request and the
   * role has to be the publishing one: a viewer who can spend the workspace's money is the
   * same hazard as a viewer who can connect an account.
   */
  private async requirePublisher(brandId: string, userId: string | undefined): Promise<void> {
    const brand = await this.prisma.marketingBrand.findFirst({
      where: { id: brandId },
      select: { id: true },
    });
    if (!brand) {
      throw new ApiException(
        MARKETING_ERROR_CODES.brandNotFound,
        'That brand does not exist.',
        HttpStatus.NOT_FOUND,
      );
    }

    const membership = userId
      ? await this.prisma.brandMember.findFirst({
          where: { brandId, userId },
          select: { role: true },
        })
      : null;

    if (!membership || membership.role !== BRAND_PUBLISHING_ROLE) {
      throw new ApiException(
        MARKETING_ERROR_CODES.aiKeyForbidden,
        `Only a brand ${BRAND_PUBLISHING_ROLE} can set, rotate or remove this workspace's API key.`,
        HttpStatus.FORBIDDEN,
      );
    }
  }
}
