import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query } from '@nestjs/common';
import { CRM_ROUTE, type LeadListResponse, type LeadResponse } from '@erp/shared';
import { CurrentSession, type RequestSession } from '../../platform/auth';
import { RequirePermission } from '../../platform/authorization';
import { validated, type Valid } from '../../platform/validation';
import { LeadsService } from './leads.service';
import { CreateLeadBody, QualifyLeadBody, UpdateLeadBody } from './schemas';

@Controller(CRM_ROUTE)
export class LeadsController {
  constructor(private readonly leads: LeadsService) {}

  @Post('leads')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('crm:leads:write')
  async add(
    @Body(validated(CreateLeadBody)) body: Valid<typeof CreateLeadBody>,
  ): Promise<LeadResponse> {
    return this.leads.createLead(body);
  }

  @Get('leads')
  @RequirePermission('crm:leads:read')
  async list(@Query() query: Record<string, unknown>): Promise<LeadListResponse> {
    return this.leads.listLeads(query);
  }

  @Get('leads/:id')
  @RequirePermission('crm:leads:read')
  async one(@Param('id') id: string): Promise<LeadResponse> {
    return this.leads.leadDetail(id);
  }

  @Patch('leads/:id')
  @RequirePermission('crm:leads:write')
  async change(
    @Param('id') id: string,
    @Body(validated(UpdateLeadBody)) body: Valid<typeof UpdateLeadBody>,
    @CurrentSession() session: RequestSession,
  ): Promise<LeadResponse> {
    return this.leads.changeLead(id, body, { userId: session.user.id, name: session.user.name });
  }

  @Post('leads/:id/qualify')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('crm:leads:write')
  async qualify(
    @Param('id') id: string,
    @Body(validated(QualifyLeadBody)) body: Valid<typeof QualifyLeadBody>,
    @CurrentSession() session: RequestSession,
  ): Promise<LeadResponse> {
    return this.leads.qualifyLead(id, body, { userId: session.user.id, name: session.user.name });
  }

  @Post('leads/:id/disqualify')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('crm:leads:write')
  async disqualify(
    @Param('id') id: string,
    @CurrentSession() session: RequestSession,
  ): Promise<LeadResponse> {
    return this.leads.disqualifyLead(id, { userId: session.user.id, name: session.user.name });
  }

  @Post('leads/:id/reopen')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('crm:leads:write')
  async reopen(
    @Param('id') id: string,
    @CurrentSession() session: RequestSession,
  ): Promise<LeadResponse> {
    return this.leads.reopenLead(id, { userId: session.user.id, name: session.user.name });
  }
}
