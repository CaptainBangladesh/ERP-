import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import {
  MARKETING_ROUTE,
  type TrackingAnalyticsResponse,
  type TrackingSiteListResponse,
  type TrackingSiteResponse,
} from '@erp/shared';
import { RequirePermission } from '../../platform/authorization';
import { validated, type Valid } from '../../platform/validation';
import { CreateTrackingSiteBody } from './schemas';
import { TrackingService } from './tracking.service';

@Controller(MARKETING_ROUTE)
export class TrackingController {
  constructor(private readonly tracking: TrackingService) {}

  @Post('tracking-sites')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('marketing:tracking:write')
  async createSite(
    @Body(validated(CreateTrackingSiteBody)) body: Valid<typeof CreateTrackingSiteBody>,
  ): Promise<TrackingSiteResponse> {
    return this.tracking.createSite(body);
  }

  /**
   * The query arrives whole.
   *
   * Three handlers here each used to name their own parameters — `brandId`, `startDate`,
   * `campaignId` and so on — which is a controller having an opinion about a convention the
   * platform owns (ADR 0004). Taking `@Query()` entire and handing it on keeps the filter
   * vocabulary in one place; the analytics handlers read the window out of the same object
   * rather than out of eight decorators.
   */
  @Get('tracking-sites')
  @RequirePermission('marketing:tracking:read')
  async listSites(
    @Query() query: Record<string, unknown>,
  ): Promise<TrackingSiteListResponse> {
    return this.tracking.listSites(readString(query, 'brandId'));
  }

  @Get('tracking-sites/:id')
  @RequirePermission('marketing:tracking:read')
  async getSite(@Param('id') id: string): Promise<TrackingSiteResponse> {
    return this.tracking.getSite(id);
  }

  @Delete('tracking-sites/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('marketing:tracking:write')
  async deleteSite(@Param('id') id: string): Promise<void> {
    await this.tracking.deleteSite(id);
  }

  @Get('tracking-sites/:id/analytics')
  @RequirePermission('marketing:tracking:read')
  async getSiteAnalytics(
    @Param('id') id: string,
    @Query() query: Record<string, unknown>,
  ): Promise<TrackingAnalyticsResponse> {
    return this.tracking.getSiteAnalytics(id, {
      startDate: readString(query, 'startDate'),
      endDate: readString(query, 'endDate'),
    });
  }

  @Get('analytics/overview')
  @RequirePermission('marketing:tracking:read')
  async getAnalyticsOverview(
    @Query() query: Record<string, unknown>,
  ): Promise<TrackingAnalyticsResponse> {
    return this.tracking.getAnalyticsOverview(readString(query, 'brandId') ?? '', {
      campaignId: readString(query, 'campaignId'),
      utmCampaign: readString(query, 'utmCampaign'),
      startDate: readString(query, 'startDate'),
      endDate: readString(query, 'endDate'),
    });
  }
}

/**
 * One query value, as a string or not at all.
 *
 * Express hands back a string, an array of them when a key repeats, or a nested object when
 * somebody writes `?a[b]=c`. Only the first is meaningful here, and the alternative — trusting
 * the decorator's type annotation — is how an array reaches a Prisma string filter and returns
 * a 500 from a query string.
 */
function readString(query: Record<string, unknown>, key: string): string | undefined {
  const value = query[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
