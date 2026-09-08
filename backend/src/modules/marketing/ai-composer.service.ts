import { HttpStatus, Injectable } from '@nestjs/common';
import {
  AI_MAX_VARIANTS,
  MARKETING_ERROR_CODES,
  normaliseCompletion,
  type AiAllowanceResponse,
  type AiComposeResponse,
  type AiComposeVariant,
} from '@erp/shared';
import { ApiException } from '../../http/api-exception';
import { InjectPrisma, type ScopedPrisma } from '../../platform/tenancy';
import type { Valid } from '../../platform/validation';
import { AiAllowanceService } from './ai-allowance.service';
import { AiKeysService } from './ai-keys.service';
import { AiProvider, maxTokensFor } from './ai-provider';
import { buildPrompt } from './ai-prompt';
import { ComposeWithAiBody } from './schemas';

/**
 * One generation: reserve, call once, reconcile, hand back variants nobody has accepted yet.
 *
 * The three things this method is built around, in the order they happen:
 *
 * 1. **The ledger comes first (14p).** The allowance is charged before the provider is
 *    touched, so a tenant at their limit is refused without a vendor call existing to be
 *    made, and the refusal names the date the allowance returns (14q).
 * 2. **One call, N variants (14e).** Never N calls — that pays the brand-voice prefix N
 *    times, and output is ~77% of this workload's bill. `max_tokens` comes from the real
 *    shape of a caption, not a vendor default.
 * 3. **Nothing is applied.** The response is text for a composer field. It does not schedule,
 *    publish, or send an inbox reply, which is what makes a successful prompt injection a bad
 *    suggestion rather than a post on a client's Instagram (14c).
 */
@Injectable()
export class AiComposerService {
  constructor(
    @InjectPrisma() private readonly prisma: ScopedPrisma,
    private readonly allowance: AiAllowanceService,
    private readonly keys: AiKeysService,
    private readonly provider: AiProvider,
  ) {}

  /** Cap, spend and reset date — read before generating, never learned from a refusal (14q). */
  async readAllowance(company: string): Promise<AiAllowanceResponse> {
    const credential = await this.keys.resolveAiProvider(company);
    const capCents = await this.keys.capCentsFor(credential.source);
    return this.allowance.read(capCents, credential.source, credential.model);
  }

  async compose(
    input: Valid<typeof ComposeWithAiBody>,
    company: string,
    userId: string | undefined,
  ): Promise<AiComposeResponse> {
    const brand = await this.requireBrandMembership(input.brandId, userId);

    const variants = Math.min(input.variants ?? AI_MAX_VARIANTS, AI_MAX_VARIANTS);

    // Every credential decision in one place; no call site reads `process.env` (14a-bis).
    const credential = await this.keys.resolveAiProvider(company);
    const capCents = await this.keys.capCentsFor(credential.source);

    const reservation = await this.allowance.reserve({
      brandId: brand.id,
      userId,
      capCents,
      source: credential.source,
      model: credential.model,
    });

    const prompt = buildPrompt({
      brand: {
        name: brand.name,
        voiceTone: brand.voiceTone,
        productDescription: brand.productDescription,
      },
      platform: input.platform,
      draft: input.draft,
      variants,
    });

    let completion;
    try {
      completion = await this.provider.complete(credential, {
        system: prompt.system,
        userContent: prompt.userContent,
        variants,
        maxTokens: maxTokensFor(variants),
      });
    } catch (error) {
      // A call that failed, timed out or was aborted costs nothing: the reservation comes
      // back in full, so a provider outage cannot eat a tenant's month (14p).
      await this.allowance.reconcile(reservation, undefined);
      throw error;
    }

    await this.allowance.reconcile(reservation, {
      inputTokens: completion.inputTokens,
      outputTokens: completion.outputTokens,
    });

    const composed: AiComposeVariant[] = completion.texts
      .map((text) => normaliseCompletion(text, input.platform))
      .filter((text) => text.length > 0)
      .map((text) => ({ text, characters: text.length }));

    return {
      variants: composed,
      requiresAccept: true,
      allowance: await this.allowance.read(capCents, credential.source, credential.model),
      model: credential.model,
      inputTokens: completion.inputTokens,
      outputTokens: completion.outputTokens,
    };
  }

  /**
   * The brand, and the three fields the prompt is allowed to know about it (14b).
   *
   * One query, against this module's own table. Nothing here reads a `crm` table — not a
   * lead, not a contact, not an email address — which is both the answer to the classifier's
   * PII question and what keeps this path on the right side of the `cross-module-tables`
   * conformance rule.
   */
  private async requireBrandMembership(
    brandId: string,
    userId: string | undefined,
  ): Promise<{
    id: string;
    name: string;
    voiceTone: string | null;
    productDescription: string | null;
  }> {
    const brand = await this.prisma.marketingBrand.findFirst({
      where: { id: brandId },
      select: { id: true, name: true, voiceTone: true, productDescription: true },
    });
    if (!brand) throw brandNotFound();

    if (!userId) throw brandNotFound();

    const membership = await this.prisma.brandMember.findFirst({
      where: { brandId, userId },
      select: { id: true },
    });
    if (!membership) throw brandNotFound();

    return brand;
  }
}

function brandNotFound(): ApiException {
  return new ApiException(
    MARKETING_ERROR_CODES.brandNotFound,
    'That brand does not exist.',
    HttpStatus.NOT_FOUND,
  );
}
