import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query } from '@nestjs/common';
import {
  MARKETING_ROUTE,
  type MarketingListResponse,
  type MarketingResponse,
} from '@erp/shared';
import { RequirePermission } from '../../platform/authorization';
import { validated, type Valid } from '../../platform/validation';
import { MarketingService } from './marketing.service';
import { CreateMarketingBody, UpdateMarketingBody } from './schemas';

/**
 * The module's surface.
 *
 * Nothing is '@Public()', which is the default every endpoint in the system has: a global
 * guard requires a session, and opting out is explicit and rare. Every handler also declares
 * '@RequirePermission(...)' — the read permission for a lookup, the write permission for a
 * change — which is what lets a role grant or deny this module's actions one at a time.
 *
 * There is no 'DELETE'. A record is deactivated rather than deleted, so that anything naming
 * it later still means something — see the service.
 *
 * The list endpoint hands its whole query object to the service and names no parameter of its
 * own. 'page', 'sort', 'search' and 'filter.<field>' are the platform's convention, identical
 * in every module, and a controller with an opinion about them is a module inventing its own.
 */
@Controller(MARKETING_ROUTE)
export class MarketingController {
  constructor(private readonly marketing: MarketingService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('marketing:marketing:write')
  async add(
    @Body(validated(CreateMarketingBody)) body: Valid<typeof CreateMarketingBody>,
  ): Promise<MarketingResponse> {
    return this.marketing.createMarketing(body);
  }

  @Get()
  @RequirePermission('marketing:marketing:read')
  async list(@Query() query: Record<string, unknown>): Promise<MarketingListResponse> {
    return this.marketing.listMarketings(query);
  }

  @Get(':id')
  @RequirePermission('marketing:marketing:read')
  async one(@Param('id') id: string): Promise<MarketingResponse> {
    return this.marketing.marketingDetail(id);
  }

  @Patch(':id')
  @RequirePermission('marketing:marketing:write')
  async change(
    @Param('id') id: string,
    @Body(validated(UpdateMarketingBody)) body: Valid<typeof UpdateMarketingBody>,
  ): Promise<MarketingResponse> {
    return this.marketing.changeMarketing(id, body);
  }
}
