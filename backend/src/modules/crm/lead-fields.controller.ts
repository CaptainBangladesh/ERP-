import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { CRM_ROUTE, type LeadFieldListResponse, type LeadFieldResponse } from '@erp/shared';
import { RequirePermission } from '../../platform/authorization';
import { validated, type Valid } from '../../platform/validation';
import { LeadFieldsService } from './lead-fields.service';
import { CreateLeadFieldBody, UpdateLeadFieldBody } from './schemas';

/**
 * The no-code field editor's endpoints.
 *
 * Its own `crm:lead-fields:*` permission rather than `crm:leads:write`, because defining what
 * every lead in the company records is a different act from editing one lead — a salesperson
 * who may do the second is not necessarily somebody who should be able to do the first.
 *
 * There is no `DELETE`. Archiving is the only way a field goes away, so that values already
 * captured survive a change of mind, and it is its own endpoint rather than a flag on the
 * general update — the same discipline `qualify`/`disqualify`/`reopen` hold for the Lead itself.
 */
@Controller(CRM_ROUTE)
export class LeadFieldsController {
  constructor(private readonly leadFields: LeadFieldsService) {}

  @Post('lead-fields')
  @RequirePermission('crm:lead-fields:write')
  async add(
    @Body(validated(CreateLeadFieldBody)) body: Valid<typeof CreateLeadFieldBody>,
  ): Promise<LeadFieldResponse> {
    return this.leadFields.createLeadField(body);
  }

  @Get('lead-fields')
  @RequirePermission('crm:lead-fields:read')
  async list(): Promise<LeadFieldListResponse> {
    return this.leadFields.listLeadFields();
  }

  @Patch('lead-fields/:id')
  @RequirePermission('crm:lead-fields:write')
  async change(
    @Param('id') id: string,
    @Body(validated(UpdateLeadFieldBody)) body: Valid<typeof UpdateLeadFieldBody>,
  ): Promise<LeadFieldResponse> {
    return this.leadFields.updateLeadField(id, body);
  }

  @Post('lead-fields/:id/archive')
  @RequirePermission('crm:lead-fields:write')
  async archive(@Param('id') id: string): Promise<LeadFieldResponse> {
    return this.leadFields.archiveLeadField(id);
  }

  @Post('lead-fields/:id/restore')
  @RequirePermission('crm:lead-fields:write')
  async restore(@Param('id') id: string): Promise<LeadFieldResponse> {
    return this.leadFields.restoreLeadField(id);
  }
}
