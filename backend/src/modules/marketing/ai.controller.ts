import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import {
  MARKETING_ROUTE,
  type AiAllowanceResponse,
  type AiComposeResponse,
  type AiKeyStatusResponse,
} from '@erp/shared';
import { CurrentSession, type RequestSession } from '../../platform/auth';
import { RequirePermission } from '../../platform/authorization';
import { Throttle } from '../../platform/throttling';
import { validated, type Valid } from '../../platform/validation';
import { AiComposerService } from './ai-composer.service';
import { AiKeysService } from './ai-keys.service';
import { ComposeWithAiBody, SetAiKeyBody } from './schemas';

/**
 * Metered generation, and the key that pays for it.
 *
 * The company comes from the authenticated context and the caller from the session — never
 * from a body — and the two things a client is never allowed to decide are absent from every
 * signature here: which model runs, and what it may cost. The compose schema refuses a body
 * that tries (14q).
 *
 * `@Throttle` sits on the compose route as a *second* fence. The ledger is the limit; a rate
 * limit is what stops a thousand refusals a minute from being free to produce (14a, 14u).
 */
@Controller(`${MARKETING_ROUTE}/ai`)
export class AiController {
  constructor(
    private readonly composer: AiComposerService,
    private readonly keys: AiKeysService,
  ) {}

  /**
   * What is left, before anything is spent (14q).
   *
   * Its own endpoint rather than a field on the compose response, because the number is only
   * useful in the moment *before* a user generates — learning your allowance from a refusal
   * is learning it too late.
   */
  @Get('allowance')
  @RequirePermission('marketing:ai:read')
  async allowance(@CurrentSession() session: RequestSession): Promise<AiAllowanceResponse> {
    return this.composer.readAllowance(session.company.id);
  }

  /**
   * One draft in, N variants out, in one call (14e) — and nothing applied (14c).
   *
   * The response fills an editable field. It does not schedule, publish or send anything: a
   * human accepts a variant, or none of them.
   */
  @Post('compose')
  @Throttle({ max: 10, ttl: 60_000, by: 'brandId' })
  @RequirePermission('marketing:ai:write')
  async compose(
    @Body(validated(ComposeWithAiBody)) body: Valid<typeof ComposeWithAiBody>,
    @CurrentSession() session: RequestSession,
  ): Promise<AiComposeResponse> {
    return this.composer.compose(body, session.company.id, session?.user?.id);
  }
}

/**
 * The tenant's own key — the escape valve for a workspace that outgrows the allowance (14h).
 *
 * Mounted under the brand whose publishing role authorises the change, which is where the
 * permission actually lives (14v, 17d). The key itself is per-*company*: one workspace, one
 * key, one bill. It is never returned — `status` answers with a mask taken from the decrypted
 * value, and nothing else.
 */
@Controller(`${MARKETING_ROUTE}/brands`)
export class AiKeysController {
  constructor(private readonly keys: AiKeysService) {}

  @Get(':brandId/ai-key')
  @RequirePermission('marketing:ai:read')
  async status(
    @Param('brandId') brandId: string,
    @CurrentSession() session: RequestSession,
  ): Promise<AiKeyStatusResponse> {
    return this.keys.status(brandId, session?.user?.id);
  }

  @Put(':brandId/ai-key')
  @RequirePermission('marketing:ai:write')
  async setKey(
    @Param('brandId') brandId: string,
    @Body(validated(SetAiKeyBody)) body: Valid<typeof SetAiKeyBody>,
    @CurrentSession() session: RequestSession,
  ): Promise<AiKeyStatusResponse> {
    return this.keys.setKey(brandId, body, session?.user?.id);
  }

  @Delete(':brandId/ai-key')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('marketing:ai:write')
  async deleteKey(
    @Param('brandId') brandId: string,
    @CurrentSession() session: RequestSession,
  ): Promise<void> {
    await this.keys.deleteKey(brandId, session?.user?.id);
  }
}
