import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post } from '@nestjs/common';
import { CRM_ROUTE, type LeadSourceListResponse, type LeadSourceResponse } from '@erp/shared';
import { RequirePermission } from '../../platform/authorization';
import { validated, type Valid } from '../../platform/validation';
import { LeadSourcesService } from './lead-sources.service';
import { CreateLeadSourceBody, UpdateLeadSourceBody } from './schemas';

/**
 * A company's channel vocabulary. Under `crm:leads:*` rather than a permission of its own —
 * a source is a property of the Leads board, and anybody who may edit the board's leads may
 * name the channels they came from.
 */
@Controller(CRM_ROUTE)
export class LeadSourcesController {
  constructor(private readonly leadSources: LeadSourcesService) {}

  @Post('lead-sources')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('crm:leads:write')
  async add(
    @Body(validated(CreateLeadSourceBody)) body: Valid<typeof CreateLeadSourceBody>,
  ): Promise<LeadSourceResponse> {
    return this.leadSources.createLeadSource(body);
  }

  @Get('lead-sources')
  @RequirePermission('crm:leads:read')
  async list(): Promise<LeadSourceListResponse> {
    return this.leadSources.listLeadSources();
  }

  @Get('lead-sources/:id')
  @RequirePermission('crm:leads:read')
  async one(@Param('id') id: string): Promise<LeadSourceResponse> {
    return this.leadSources.getLeadSource(id);
  }

  @Patch('lead-sources/:id')
  @RequirePermission('crm:leads:write')
  async change(
    @Param('id') id: string,
    @Body(validated(UpdateLeadSourceBody)) body: Valid<typeof UpdateLeadSourceBody>,
  ): Promise<LeadSourceResponse> {
    return this.leadSources.updateLeadSource(id, body);
  }

  @Delete('lead-sources/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('crm:leads:write')
  async remove(@Param('id') id: string): Promise<void> {
    await this.leadSources.deleteLeadSource(id);
  }
}
