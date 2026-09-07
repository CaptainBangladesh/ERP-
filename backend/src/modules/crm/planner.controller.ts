import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Put,
} from '@nestjs/common';
import {
  CRM_ROUTE,
  type ApproachPlanResponse,
  type PlannerNoteResponse,
  type TeamPlanResponse,
} from '@erp/shared';
import { CurrentSession, type RequestSession } from '../../platform/auth';
import { RequirePermission } from '../../platform/authorization';
import { validated, type Valid } from '../../platform/validation';
import { PlannerService } from './planner.service';
import { SaveApproachPlanBody, SavePlannerNoteBody, SaveTeamPlanBody } from './schemas';

/**
 * The planner & notes surfaces. Three permission postures on one controller:
 * - the per-lead **approach plan** is part of working a lead — read on `crm:leads:read`, write on
 *   `crm:leads:write`;
 * - the **personal planner notes** are the rep's own — `crm:activities:read`, the gate every rep
 *   working their slate already holds;
 * - the shared **team plan** reads on the team gate `crm:team:read` and is written only by a
 *   manager with `crm:team:manage`.
 */
@Controller(CRM_ROUTE)
export class PlannerController {
  constructor(private readonly planner: PlannerService) {}

  // ─── approach plan ─────────────────────────────────────────────────────────────────

  @Get('leads/:id/approach-plan')
  @RequirePermission('crm:leads:read')
  async getApproachPlan(@Param('id') leadId: string): Promise<ApproachPlanResponse> {
    return this.planner.getApproachPlan(leadId);
  }

  @Put('leads/:id/approach-plan')
  @RequirePermission('crm:leads:write')
  async saveApproachPlan(
    @Param('id') leadId: string,
    @CurrentSession() session: RequestSession,
    @Body(validated(SaveApproachPlanBody)) body: Valid<typeof SaveApproachPlanBody>,
  ): Promise<ApproachPlanResponse> {
    return this.planner.saveApproachPlan(leadId, body, { userId: session.user.id });
  }

  @Delete('leads/:id/approach-plan')
  @RequirePermission('crm:leads:write')
  @HttpCode(HttpStatus.OK)
  async deleteApproachPlan(@Param('id') leadId: string): Promise<{ success: boolean }> {
    return this.planner.deleteApproachPlan(leadId);
  }

  // ─── personal planner notes ─────────────────────────────────────────────────────────

  @Get('planner/notes')
  @RequirePermission('crm:activities:read')
  async getMyNotes(@CurrentSession() session: RequestSession): Promise<PlannerNoteResponse> {
    return this.planner.getMyNotes(session.user.id);
  }

  @Put('planner/notes')
  @RequirePermission('crm:activities:read')
  async saveMyNotes(
    @CurrentSession() session: RequestSession,
    @Body(validated(SavePlannerNoteBody)) body: Valid<typeof SavePlannerNoteBody>,
  ): Promise<PlannerNoteResponse> {
    return this.planner.saveMyNotes(session.user.id, body);
  }

  // ─── shared team plan ───────────────────────────────────────────────────────────────

  @Get('team-plan')
  @RequirePermission('crm:team:read')
  async getTeamPlan(): Promise<TeamPlanResponse> {
    return this.planner.getTeamPlan();
  }

  @Put('team-plan')
  @RequirePermission('crm:team:manage')
  async saveTeamPlan(
    @CurrentSession() session: RequestSession,
    @Body(validated(SaveTeamPlanBody)) body: Valid<typeof SaveTeamPlanBody>,
  ): Promise<TeamPlanResponse> {
    return this.planner.saveTeamPlan(body, { userId: session.user.id });
  }
}
