import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query } from '@nestjs/common';
import { CRM_ROUTE, type DealListResponse, type DealResponse } from '@erp/shared';
import { CurrentSession, type RequestSession } from '../../platform/auth';
import { RequirePermission } from '../../platform/authorization';
import { validated, type Valid } from '../../platform/validation';
import { DealsService } from './deals.service';
import { CreateDealBody, UpdateDealBody } from './schemas';

@Controller(CRM_ROUTE)
export class DealsController {
  constructor(private readonly deals: DealsService) {}

  @Post('deals')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('crm:deals:write')
  async add(
    @Body(validated(CreateDealBody)) body: Valid<typeof CreateDealBody>,
    @CurrentSession() session: RequestSession,
  ): Promise<DealResponse> {
    return this.deals.createDeal(body, { userId: session.user.id, name: session.user.name });
  }

  @Get('deals')
  @RequirePermission('crm:deals:read')
  async list(@Query() query: Record<string, unknown>): Promise<DealListResponse> {
    return this.deals.listDeals(query);
  }

  @Get('deals/:id')
  @RequirePermission('crm:deals:read')
  async one(@Param('id') id: string): Promise<DealResponse> {
    return this.deals.dealDetail(id);
  }

  @Patch('deals/:id')
  @RequirePermission('crm:deals:write')
  async change(
    @Param('id') id: string,
    @Body(validated(UpdateDealBody)) body: Valid<typeof UpdateDealBody>,
    @CurrentSession() session: RequestSession,
  ): Promise<DealResponse> {
    return this.deals.changeDeal(id, body, { userId: session.user.id, name: session.user.name });
  }

  @Delete('deals/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('crm:deals:write')
  async remove(@Param('id') id: string): Promise<void> {
    return this.deals.deleteDeal(id);
  }
}
