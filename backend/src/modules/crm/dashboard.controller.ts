import { Controller, Get, Query } from '@nestjs/common';
import {
  CRM_ROUTE,
  type ActivityCountsResponse,
  type PipelineValueResponse,
  type WinLossRateResponse,
} from '@erp/shared';
import { RequirePermission } from '../../platform/authorization';
import { DashboardService } from './dashboard.service';

@Controller(CRM_ROUTE)
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('dashboard/pipeline-value')
  @RequirePermission('crm:dashboard:read')
  async pipelineValue(): Promise<PipelineValueResponse> {
    return this.dashboardService.getPipelineValue();
  }

  @Get('dashboard/win-loss-rate')
  @RequirePermission('crm:dashboard:read')
  async winLossRate(@Query() query: Record<string, unknown>): Promise<WinLossRateResponse> {
    const fromDate = typeof query.fromDate === 'string' ? query.fromDate : undefined;
    const toDate = typeof query.toDate === 'string' ? query.toDate : undefined;
    return this.dashboardService.getWinLossRate(fromDate, toDate);
  }

  @Get('dashboard/activity-counts')
  @RequirePermission('crm:dashboard:read')
  async activityCounts(@Query() query: Record<string, unknown>): Promise<ActivityCountsResponse> {
    const fromDate = typeof query.fromDate === 'string' ? query.fromDate : undefined;
    const toDate = typeof query.toDate === 'string' ? query.toDate : undefined;
    return this.dashboardService.getActivityCounts(fromDate, toDate);
  }

  @Get('dashboard/lead-source-performance')
  @RequirePermission('crm:dashboard:read')
  async leadSourcePerformance(@Query() query: Record<string, unknown>): Promise<any> {
    const fromDate = typeof query.fromDate === 'string' ? query.fromDate : undefined;
    const toDate = typeof query.toDate === 'string' ? query.toDate : undefined;
    return this.dashboardService.getLeadSourcePerformance(fromDate, toDate);
  }
}
