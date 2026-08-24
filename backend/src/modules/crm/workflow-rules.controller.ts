import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query } from '@nestjs/common';
import {
  CRM_ROUTE,
  type NotificationListResponse,
  type WorkflowRuleListResponse,
  type WorkflowRuleResponse,
} from '@erp/shared';
import { CurrentSession, type RequestSession } from '../../platform/auth';
import { RequirePermission } from '../../platform/authorization';
import { validated, type Valid } from '../../platform/validation';
import { CreateWorkflowRuleBody, UpdateWorkflowRuleBody } from './schemas';
import { WorkflowRulesService } from './workflow-rules.service';

@Controller(CRM_ROUTE)
export class WorkflowRulesController {
  constructor(private readonly workflowRulesService: WorkflowRulesService) {}

  @Post('workflow-rules')
  @RequirePermission('crm:workflow-rules:write')
  async createRule(
    @Body(validated(CreateWorkflowRuleBody)) body: Valid<typeof CreateWorkflowRuleBody>,
  ): Promise<WorkflowRuleResponse> {
    return this.workflowRulesService.createRule(body);
  }

  @Get('workflow-rules')
  @RequirePermission('crm:workflow-rules:read')
  async listRules(@Query() query: Record<string, unknown>): Promise<WorkflowRuleListResponse> {
    return this.workflowRulesService.listRules(query);
  }

  @Get('workflow-rules/:id')
  @RequirePermission('crm:workflow-rules:read')
  async getRule(@Param('id') id: string): Promise<WorkflowRuleResponse> {
    return this.workflowRulesService.getRule(id);
  }

  @Patch('workflow-rules/:id')
  @RequirePermission('crm:workflow-rules:write')
  async updateRule(
    @Param('id') id: string,
    @Body(validated(UpdateWorkflowRuleBody)) body: Valid<typeof UpdateWorkflowRuleBody>,
  ): Promise<WorkflowRuleResponse> {
    return this.workflowRulesService.updateRule(id, body);
  }

  @Delete('workflow-rules/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('crm:workflow-rules:write')
  async deleteRule(@Param('id') id: string): Promise<void> {
    await this.workflowRulesService.deleteRule(id);
  }

  @Get('notifications')
  @RequirePermission('crm:workflow-rules:read')
  async listNotifications(@CurrentSession() session: RequestSession): Promise<NotificationListResponse> {
    return this.workflowRulesService.listNotifications(session.user.id);
  }
}
