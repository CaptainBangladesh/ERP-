import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import {
  AI_MAX_OUTPUT_TOKENS,
  AI_MODEL,
  MARKETING_ERROR_CODES,
} from '@erp/shared';
import { ApiException } from '../../http/api-exception';

/**
 * Which credential and which endpoint a generation runs against.
 *
 * `source` is not decoration: it decides the allowance the call is metered against (14h) and
 * it decides what happens when the vendor rejects the key — a tenant key that stops working
 * refuses the request, and never falls back to the platform key (14v).
 */
export interface AiCredential {
  readonly apiKey: string;
  readonly baseUrl?: string;
  readonly model: string;
  readonly source: 'platform' | 'tenant';
}

/** What the composer asks for. Assembled server-side; none of it comes from the client. */
export interface AiCompletionRequest {
  /** The standing instruction, including the one about the fenced block (14c). */
  readonly system: string;
  /** The single user turn: the allowlisted brand fields, the fenced draft, the ask. */
  readonly userContent: string;
  /** How many variants this one call must return. Never a second call (14e). */
  readonly variants: number;
  /** Capped from the real output shape, never a vendor default (14e). */
  readonly maxTokens: number;
}

export interface AiCompletion {
  readonly texts: readonly string[];
  readonly inputTokens: number;
  readonly outputTokens: number;
}

/**
 * The model, behind one seam.
 *
 * An abstract class bound to the live client in production and a deterministic stub in test,
 * the same shape `SocialOAuth` uses — which is what lets ticket 14's tests assert that a
 * tenant at their allowance is refused *before* a call, without a network round trip existing
 * to be refused. It is also where a provider switch would land if the 14g A/B ever moves off
 * Haiku 4.5: one binding, not forty call sites.
 */
export abstract class AiProvider {
  abstract complete(credential: AiCredential, request: AiCompletionRequest): Promise<AiCompletion>;

  /**
   * One minimal call, to prove a key works at the moment it is saved (14v).
   *
   * A typo in a settings field should fail in the settings field. Discovering it mid
   * composition, having already reserved allowance, is the failure this exists to prevent.
   */
  abstract probe(credential: AiCredential): Promise<void>;
}

/**
 * The variant delimiter.
 *
 * A line of three hyphens rather than JSON: the response is three captions totalling ~250
 * tokens, and asking a 30-token caption to carry JSON scaffolding spends the expensive half
 * of the bill on punctuation (14e). Parsing is forgiving because a delimiter the model
 * forgets should cost a variant, not the request.
 */
const VARIANT_DELIMITER = /^\s*-{3,}\s*$/m;

@Injectable()
export class LiveAiProvider extends AiProvider {
  private readonly logger = new Logger('MarketingAi');

  async complete(
    credential: AiCredential,
    request: AiCompletionRequest,
  ): Promise<AiCompletion> {
    const client = this.clientFor(credential);

    try {
      const response = await client.messages.create({
        model: credential.model,
        max_tokens: request.maxTokens,
        system: request.system,
        messages: [{ role: 'user', content: request.userContent }],
      });

      const text = response.content
        .filter((block): block is Anthropic.TextBlock => block.type === 'text')
        .map((block) => block.text)
        .join('\n');

      return {
        texts: splitVariants(text, request.variants),
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      };
    } catch (error) {
      throw this.refuse(credential, error);
    }
  }

  async probe(credential: AiCredential): Promise<void> {
    const client = this.clientFor(credential);

    try {
      await client.messages.create({
        model: credential.model,
        max_tokens: 1,
        messages: [{ role: 'user', content: 'ok' }],
      });
    } catch (error) {
      throw this.refuse(credential, error);
    }
  }

  private clientFor(credential: AiCredential): Anthropic {
    return new Anthropic({
      apiKey: credential.apiKey,
      ...(credential.baseUrl ? { baseURL: credential.baseUrl } : {}),
      maxRetries: 1,
      timeout: 30_000,
    });
  }

  /**
   * The vendor's status and message, and nothing else (14r).
   *
   * No request body, no prompt, no draft — a provider error is the easiest way for a
   * tenant's unpublished copy to end up in a log aggregator permanently. And an authentication
   * failure on a *tenant* key is its own refusal: falling back to the platform key would
   * spend the shared budget invisibly and hide a broken credential for a month (14v).
   */
  private refuse(credential: AiCredential, error: unknown): ApiException {
    const status = error instanceof Anthropic.APIError ? error.status : undefined;
    const message = error instanceof Error ? error.message : 'Unknown provider error.';

    this.logger.error(
      `Model call failed: source=${credential.source} model=${credential.model} ` +
        `status=${status ?? 'none'} vendor="${message}"`,
    );

    if (credential.source === 'tenant' && (status === 401 || status === 403)) {
      return new ApiException(
        MARKETING_ERROR_CODES.aiTenantKeyRejected,
        'Your API key was rejected by the provider. Update it in brand settings — this ' +
          'request was not run against the platform key.',
        HttpStatus.BAD_GATEWAY,
      );
    }

    return new ApiException(
      MARKETING_ERROR_CODES.aiProviderFailed,
      'The model provider could not be reached. Nothing was charged against your allowance.',
      HttpStatus.BAD_GATEWAY,
    );
  }
}

/**
 * A provider that answers without a network, for tests.
 *
 * Deterministic rather than empty: the suite asserts the *shape* of a generation — that one
 * call produced N variants, that the ledger reconciled to the usage figures, that nothing was
 * applied to a post without a human — and all of that needs a real answer with real token
 * counts. A key containing `not-a-real-key` is rejected the way the vendor rejects a typo,
 * which is what lets the BYO-key path be tested without one.
 */
@Injectable()
export class StubAiProvider extends AiProvider {
  async complete(
    credential: AiCredential,
    request: AiCompletionRequest,
  ): Promise<AiCompletion> {
    this.assertUsableKey(credential);

    const texts = Array.from(
      { length: request.variants },
      (_, index) => `Variant ${index + 1}: ${summarise(request.userContent)}`,
    );

    return {
      texts,
      // Shaped like the real thing so the ledger reconciliation is exercised rather than
      // trivially zero: a ~600-token prompt and 30-60 tokens per variant.
      inputTokens: 600,
      outputTokens: 40 * request.variants,
    };
  }

  async probe(credential: AiCredential): Promise<void> {
    this.assertUsableKey(credential);
  }

  private assertUsableKey(credential: AiCredential): void {
    if (!credential.apiKey.includes('not-a-real-key')) return;

    if (credential.source === 'tenant') {
      throw new ApiException(
        MARKETING_ERROR_CODES.aiTenantKeyRejected,
        'Your API key was rejected by the provider. Update it in brand settings — this ' +
          'request was not run against the platform key.',
        HttpStatus.BAD_GATEWAY,
      );
    }

    throw new ApiException(
      MARKETING_ERROR_CODES.aiProviderFailed,
      'The model provider could not be reached. Nothing was charged against your allowance.',
      HttpStatus.BAD_GATEWAY,
    );
  }
}

/** The default `max_tokens` for a variant request, from the real output shape (14e). */
export function maxTokensFor(variants: number): number {
  return Math.min(AI_MAX_OUTPUT_TOKENS, Math.max(90, 80 * variants + 10));
}

/** The pinned model id, in one place, so a call site never names one (14a-bis, 14g). */
export const DEFAULT_AI_MODEL = AI_MODEL;

function splitVariants(text: string, wanted: number): string[] {
  const parts = text
    .split(VARIANT_DELIMITER)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  return (parts.length > 0 ? parts : [text.trim()]).slice(0, wanted);
}

/** The stub's stand-in for a caption — the last line of the ask, and nothing invented. */
function summarise(userContent: string): string {
  const lines = userContent
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return lines[lines.length - 1] ?? 'draft';
}
