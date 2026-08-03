import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query } from '@nestjs/common';
import {
  UNITS_ROUTE,
  type UnitGroupsResponse,
  type UnitListResponse,
  type UnitSummary,
} from '@erp/shared';
import { validated, type Valid } from '../../platform/validation';
import { CreateUnitBody, CreateUnitGroupBody, UpdateUnitBody } from './schemas';
import { UnitsService } from './units.service';

/**
 * Units of measure, on a route of their own.
 *
 * Not `api/products/units`, because a unit is not a detail of a product: it exists before any
 * product uses one, it is created on its own screen, and it is what a stock movement will be
 * measured in. Nesting the path would say the opposite of the model.
 *
 * There is no delete here either. A unit in use is deactivated, and even that is refused while
 * products are measured in it — see the service.
 */
@Controller(UNITS_ROUTE)
export class UnitsController {
  constructor(private readonly units: UnitsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async addUnit(
    @Body(validated(CreateUnitBody)) body: Valid<typeof CreateUnitBody>,
  ): Promise<UnitSummary> {
    return this.units.createUnit(body);
  }

  @Get()
  async listUnits(@Query() query: Record<string, unknown>): Promise<UnitListResponse> {
    return this.units.listUnits(query);
  }

  /**
   * Declared before `:id`, and it has to be: Nest matches routes in the order they are
   * registered, so a parameterised path written first would swallow `groups` and try to look
   * up a unit by that name.
   */
  @Get('groups')
  async groups(): Promise<UnitGroupsResponse> {
    return this.units.groups();
  }

  @Post('groups')
  @HttpCode(HttpStatus.CREATED)
  async addGroup(
    @Body(validated(CreateUnitGroupBody)) body: Valid<typeof CreateUnitGroupBody>,
  ): Promise<UnitGroupsResponse> {
    return this.units.createGroup(body);
  }

  @Get(':id')
  async unit(@Param('id') id: string): Promise<UnitSummary> {
    return this.units.unitDetail(id);
  }

  @Patch(':id')
  async changeUnit(
    @Param('id') id: string,
    @Body(validated(UpdateUnitBody)) body: Valid<typeof UpdateUnitBody>,
  ): Promise<UnitSummary> {
    return this.units.changeUnit(id, body);
  }
}
