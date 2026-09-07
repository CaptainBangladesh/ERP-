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

  @Get('tracking-sites')
  @RequirePermission('marketing:tracking:read')
  async listSites(
    @Query('brandId') brandId?: string,
  ): Promise<TrackingSiteListResponse> {
    return this.tracking.listSites(brandId);
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
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ): Promise<TrackingAnalyticsResponse> {
    return this.tracking.getSiteAnalytics(id, { startDate, endDate });
  }

  @Get('analytics/overview')
  @RequirePermission('marketing:tracking:read')
  async getAnalyticsOverview(
    @Query('brandId') brandId: string,
    @Query('campaignId') campaignId?: string,
    @Query('utmCampaign') utmCampaign?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ): Promise<TrackingAnalyticsResponse> {
    return this.tracking.getAnalyticsOverview(brandId, {
      campaignId,
      utmCampaign,
      startDate,
      endDate,
    });
  }
}
