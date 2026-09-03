import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import {
  CRM_ROUTE,
  type ActivityFeedResponse,
  type ActivityListResponse,
  type ActivityResponse,
} from '@erp/shared';
import { CurrentSession, type RequestSession } from '../../platform/auth';
import { RequirePermission } from '../../platform/authorization';
import { validated, type Valid } from '../../platform/validation';
import { ActivitiesService } from './activities.service';
import { CreateActivityBody, SnoozeTaskBody } from './schemas';

@Controller(CRM_ROUTE)
export class ActivitiesController {
  constructor(private readonly activitiesService: ActivitiesService) {}

  @Post('activities')
  @RequirePermission('crm:activities:write')
  async logActivity(
    @CurrentSession() session: RequestSession,
    @Body(validated(CreateActivityBody)) body: Valid<typeof CreateActivityBody>,
  ): Promise<ActivityResponse> {
    return this.activitiesService.logActivity(
      { userId: session.user.id, name: session.user.name },
      body,
    );
  }

  /**
   * The company-wide feed. Declared before the three per-parent reads so `GET …/activities`
   * resolves here and is never mistaken for a parent segment.
   */
  @Get('activities')
  @RequirePermission('crm:activities:read')
  async listCompanyActivities(
    @Query() query: Record<string, unknown>,
  ): Promise<ActivityFeedResponse> {
    return this.activitiesService.listCompanyActivities(query);
  }

  @Get('leads/:id/activities')
  @RequirePermission('crm:activities:read')
  async listLeadActivities(@Param('id') leadId: string): Promise<ActivityListResponse> {
    return this.activitiesService.listLeadActivities(leadId);
  }

  @Get('deals/:id/activities')
  @RequirePermission('crm:activities:read')
  async listDealActivities(@Param('id') dealId: string): Promise<ActivityListResponse> {
    return this.activitiesService.listDealActivities(dealId);
  }

  @Get('parties/:id/activities')
  @RequirePermission('crm:activities:read')
  async listPartyActivities(@Param('id') partyId: string): Promise<ActivityListResponse> {
    return this.activitiesService.listPartyActivities(partyId);
  }

  @Post('activities/:id/complete')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('crm:activities:write')
  async completeTask(@Param('id') id: string): Promise<ActivityResponse> {
    return this.activitiesService.completeTask(id);
  }

  @Post('activities/:id/snooze')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('crm:activities:write')
  async snoozeTask(
    @Param('id') id: string,
    @Body(validated(SnoozeTaskBody)) body: Valid<typeof SnoozeTaskBody>,
  ): Promise<ActivityResponse> {
    return this.activitiesService.snoozeTask(id, body.days ?? 1);
  }

  @Post('activities/:id/reopen')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('crm:activities:write')
  async reopenTask(@Param('id') id: string): Promise<ActivityResponse> {
    return this.activitiesService.reopenTask(id);
  }
}
