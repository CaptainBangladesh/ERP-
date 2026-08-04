import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  LOCATIONS_ROUTE,
  type LocationListResponse,
  type LocationResponse,
} from '@erp/shared';
import { RequirePermission } from '../../platform/authorization';
import { validated, type Valid } from '../../platform/validation';
import { LocationsService } from './locations.service';
import { CreateLocationBody, UpdateLocationBody } from './schemas';

/**
 * Where stock lives, as an API.
 *
 * Nothing is `@Public()`, which is the default every endpoint in the system has: a global guard
 * requires a session, and opting out is explicit and rare. Every handler also declares
 * `@RequirePermission(…)` — the read permission for a lookup, the write permission for a change
 * — which is what lets a role grant or deny this module's actions one at a time.
 *
 * There is no `DELETE`. A location is deactivated rather than deleted, so that every movement
 * naming it still means something — see the service.
 *
 * The list endpoint hands its whole query object to the service and names no parameter of its
 * own: `page`, `sort`, `search` and `filter.<field>` are the platform's convention, identical
 * in every module.
 */
@Controller(LOCATIONS_ROUTE)
export class LocationsController {
  constructor(private readonly locations: LocationsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('inventory:locations:write')
  async addLocation(
    @Body(validated(CreateLocationBody)) body: Valid<typeof CreateLocationBody>,
  ): Promise<LocationResponse> {
    return this.locations.createLocation(body);
  }

  @Get()
  @RequirePermission('inventory:locations:read')
  async listLocations(@Query() query: Record<string, unknown>): Promise<LocationListResponse> {
    return this.locations.listLocations(query);
  }

  @Get(':id')
  @RequirePermission('inventory:locations:read')
  async location(@Param('id') id: string): Promise<LocationResponse> {
    return this.locations.locationDetail(id);
  }

  @Patch(':id')
  @RequirePermission('inventory:locations:write')
  async changeLocation(
    @Param('id') id: string,
    @Body(validated(UpdateLocationBody)) body: Valid<typeof UpdateLocationBody>,
  ): Promise<LocationResponse> {
    return this.locations.changeLocation(id, body);
  }
}
