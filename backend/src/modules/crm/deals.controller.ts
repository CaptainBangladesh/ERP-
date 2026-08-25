import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query } from '@nestjs/common';
import {
  CRM_ROUTE,
  type DealListResponse,
  type DealResponse,
  type PartyDealRollupResponse,
} from '@erp/shared';
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

  /**
   * Declared before `deals/:id` deliberately: Nest matches in declaration order, so the other
   * way round `by-party` arrives as an id and is answered with `deal_not_found`.
   */
  @Get('deals/by-party')
  @RequirePermission('crm:deals:read')
  async byParty(@Query() query: Record<string, unknown>): Promise<PartyDealRollupResponse> {
    // Taken whole, like every handler here, rather than picked out by name with `@Query('…')`:
    // this is not a list endpoint and has no page, sort or filter to hand to `listQuery`, but
    // a controller reaching for one named parameter is the shape the convention rules out.
    //
    // Turning a comma-separated parameter into values is all this does. What the values then
    // *mean* — that a hundred is a board and a thousand is a report — is the service's rule,
    // and enforcing it here would put a domain decision in the one layer that cannot be
    // called from anywhere else to check it.
    const partyIds = typeof query.partyIds === 'string' ? query.partyIds : '';

    return this.deals.dealsByParty(
      partyIds
        .split(',')
        .map((id) => id.trim())
        .filter((id) => id.length > 0),
    );
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
