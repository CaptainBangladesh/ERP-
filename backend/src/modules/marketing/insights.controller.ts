import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
} from '@nestjs/common';
import {
  MARKETING_ROUTE,
  SOCIAL_PLATFORMS,
  type BestTimeResponse,
  type SocialPlatform,
} from '@erp/shared';
import { ApiException } from '../../http/api-exception';
import { CurrentSession, type RequestSession } from '../../platform/auth';
import { RequirePermission } from '../../platform/authorization';
import { validated, type Valid } from '../../platform/validation';
import { InsightsService } from './insights.service';
import { RecomputeBestTimesBody } from './schemas';

/**
 * Posting-time advice, and the button that asks for it again.
 *
 * The company comes from the authenticated context — the platform's tenant scoping supplies
 * it to every query — and the caller's identity comes from the session, never from the body
 * or the query string (14i). Neither handler computes anything: the 90-day aggregate belongs
 * to the queue.
 */
@Controller(MARKETING_ROUTE)
export class InsightsController {
  constructor(private readonly insights: InsightsService) {}

  @Get('insights/best-times')
  @RequirePermission('marketing:insights:read')
  async bestTimes(
    @Query() query: Record<string, unknown>,
    @CurrentSession() session: RequestSession,
  ): Promise<BestTimeResponse> {
    const brandId = readString(query, 'brandId');
    if (!brandId) throw badRequest('Choose a brand.');

    const platform = readString(query, 'platform');
    if (!platform || !isPlatform(platform)) {
      throw badRequest('Choose a network this module publishes to.');
    }

    return this.insights.getBestTimes(brandId, platform, session?.user?.id);
  }

  @Post('insights/best-times/recompute')
  @HttpCode(HttpStatus.ACCEPTED)
  @RequirePermission('marketing:insights:write')
  async recompute(
    @Body(validated(RecomputeBestTimesBody)) body: Valid<typeof RecomputeBestTimesBody>,
    @CurrentSession() session: RequestSession,
  ): Promise<{ queued: true }> {
    await this.insights.requestRecompute(body.brandId, body.platform, session?.user?.id);
    return { queued: true };
  }
}

function isPlatform(value: string): value is SocialPlatform {
  return (SOCIAL_PLATFORMS as readonly string[]).includes(value);
}

function badRequest(message: string): ApiException {
  return new ApiException('invalid_request', message, HttpStatus.BAD_REQUEST);
}

/**
 * One query value, as a string or not at all — the same reading `tracking.controller.ts`
 * does. Express hands back a string, an array when a key repeats, or an object for
 * `?a[b]=c`; only the first is meaningful, and trusting the annotation is how an array
 * reaches a Prisma string filter.
 */
function readString(query: Record<string, unknown>, key: string): string | undefined {
  const value = query[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
