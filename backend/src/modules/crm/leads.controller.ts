import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query } from '@nestjs/common';
import { CRM_ROUTE, type LeadListResponse, type LeadResponse } from '@erp/shared';
import { RequirePermission } from '../../platform/authorization';
import { validated, type Valid } from '../../platform/validation';
import { LeadsService } from './leads.service';
import { CreateLeadBody, QualifyLeadBody, UpdateLeadBody } from './schemas';

/**
 * Leads: crm's surface for ticket 02.
 *
 * Nothing is `@Public()`, which is the default every endpoint in the system has. Every
 * handler declares `@RequirePermission(...)`, in crm's own namespace.
 *
 * There is no `DELETE`. A Lead going nowhere is `disqualify`d rather than deleted, so it can
 * be `reopen`ed later instead of starting over from nothing — and so a Deal that ticket 03
 * traces back to it (`originLeadId`) never names a row that has vanished.
 *
 * `qualify`, `disqualify` and `reopen` are their own endpoints rather than reachable through
 * `PATCH`, because each carries a side effect a bare field write cannot also perform:
 * `qualify` sets `partyId`, `disqualify` freezes the status being left, `reopen` restores it.
 *
 * The list endpoint hands its whole query object to the service. Nothing here names `page`,
 * `sort`, `search` or a filter: those are the platform's convention, identical in every
 * module.
 */
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
  ): Promise<LeadResponse> {
    return this.leads.changeLead(id, body);
  }

  @Post('leads/:id/qualify')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('crm:leads:write')
  async qualify(
    @Param('id') id: string,
    @Body(validated(QualifyLeadBody)) body: Valid<typeof QualifyLeadBody>,
  ): Promise<LeadResponse> {
    return this.leads.qualifyLead(id, body);
  }

  @Post('leads/:id/disqualify')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('crm:leads:write')
  async disqualify(@Param('id') id: string): Promise<LeadResponse> {
    return this.leads.disqualifyLead(id);
  }

  @Post('leads/:id/reopen')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('crm:leads:write')
  async reopen(@Param('id') id: string): Promise<LeadResponse> {
    return this.leads.reopenLead(id);
  }
}
