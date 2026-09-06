import { Controller, Get, Query } from '@nestjs/common';
import {
  CRM_ROUTE,
  type PlanningCoordinationResponse,
  type PlanningHeatmapResponse,
  type PlanningScheduleResponse,
} from '@erp/shared';
import { RequirePermission } from '../../platform/authorization';
import { PlanningService } from './planning.service';

/**
 * The Sales Enablement & Planning team surfaces, all gated by `crm:team:read`. A company grants
 * that permission to whoever should see the whole team's schedule and load — a sales manager,
 * typically — while a rep sees their own slice of the very same data by filtering client-side to
 * themselves. There is no per-user server tailoring: one feed, read against who is asking.
 */
@Controller(CRM_ROUTE)
export class PlanningController {
  constructor(private readonly planningService: PlanningService) {}

  @Get('planning/schedule')
  @RequirePermission('crm:team:read')
  async schedule(@Query() query: Record<string, unknown>): Promise<PlanningScheduleResponse> {
    const from = typeof query.from === 'string' ? query.from : undefined;
    const to = typeof query.to === 'string' ? query.to : undefined;
    return this.planningService.schedule(from, to);
  }

  @Get('planning/heatmap')
  @RequirePermission('crm:team:read')
  async heatmap(@Query() query: Record<string, unknown>): Promise<PlanningHeatmapResponse> {
    const weeks = typeof query.weeks === 'string' ? Number(query.weeks) : 12;
    return this.planningService.heatmap(weeks);
  }

  @Get('planning/coordination')
  @RequirePermission('crm:team:read')
  async coordination(): Promise<PlanningCoordinationResponse> {
    return this.planningService.coordination();
  }
}
