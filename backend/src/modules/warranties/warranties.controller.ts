import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query } from '@nestjs/common';
import {
  WARRANTIES_ROUTE,
  type WarrantyListResponse,
  type WarrantyResponse,
} from '@erp/shared';
import { RequirePermission } from '../../platform/authorization';
import { validated, type Valid } from '../../platform/validation';
import { WarrantiesService } from './warranties.service';
import { CreateWarrantyBody, UpdateWarrantyBody } from './schemas';

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
@Controller(WARRANTIES_ROUTE)
export class WarrantiesController {
  constructor(private readonly warranties: WarrantiesService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('warranties:warranties:write')
  async add(
    @Body(validated(CreateWarrantyBody)) body: Valid<typeof CreateWarrantyBody>,
  ): Promise<WarrantyResponse> {
    return this.warranties.createWarranty(body);
  }

  @Get()
  @RequirePermission('warranties:warranties:read')
  async list(@Query() query: Record<string, unknown>): Promise<WarrantyListResponse> {
    return this.warranties.listWarranties(query);
  }

  @Get(':id')
  @RequirePermission('warranties:warranties:read')
  async one(@Param('id') id: string): Promise<WarrantyResponse> {
    return this.warranties.warrantyDetail(id);
  }

  @Patch(':id')
  @RequirePermission('warranties:warranties:write')
  async change(
    @Param('id') id: string,
    @Body(validated(UpdateWarrantyBody)) body: Valid<typeof UpdateWarrantyBody>,
  ): Promise<WarrantyResponse> {
    return this.warranties.changeWarranty(id, body);
  }
}
