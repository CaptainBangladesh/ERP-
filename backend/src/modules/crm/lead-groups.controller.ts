import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post } from '@nestjs/common';
import { CRM_ROUTE, type LeadGroupListResponse, type LeadGroupResponse } from '@erp/shared';
import { RequirePermission } from '../../platform/authorization';
import { validated, type Valid } from '../../platform/validation';
import { LeadGroupsService } from './lead-groups.service';
import { CreateLeadGroupBody, UpdateLeadGroupBody } from './schemas';

@Controller(CRM_ROUTE)
export class LeadGroupsController {
  constructor(private readonly leadGroups: LeadGroupsService) {}

  @Post('lead-groups')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('crm:leads:write')
  async add(
    @Body(validated(CreateLeadGroupBody)) body: Valid<typeof CreateLeadGroupBody>,
  ): Promise<LeadGroupResponse> {
    return this.leadGroups.createLeadGroup(body);
  }

  @Get('lead-groups')
  @RequirePermission('crm:leads:read')
  async list(): Promise<LeadGroupListResponse> {
    return this.leadGroups.listLeadGroups();
  }

  @Get('lead-groups/:id')
  @RequirePermission('crm:leads:read')
  async one(@Param('id') id: string): Promise<LeadGroupResponse> {
    return this.leadGroups.getLeadGroup(id);
  }

  @Patch('lead-groups/:id')
  @RequirePermission('crm:leads:write')
  async change(
    @Param('id') id: string,
    @Body(validated(UpdateLeadGroupBody)) body: Valid<typeof UpdateLeadGroupBody>,
  ): Promise<LeadGroupResponse> {
    return this.leadGroups.updateLeadGroup(id, body);
  }

  @Delete('lead-groups/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('crm:leads:write')
  async remove(@Param('id') id: string): Promise<void> {
    await this.leadGroups.deleteLeadGroup(id);
  }
}
