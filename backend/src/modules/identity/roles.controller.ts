import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { IDENTITY_ROUTE, type RoleListResponse, type RoleResponse } from '@erp/shared';
import { RequirePermission } from '../../platform/authorization';
import { validated, type Valid } from '../../platform/validation';
import { RolesService } from './roles.service';
import { CreateRoleBody, UpdateRoleBody } from './schemas';

/**
 * Role definitions: create one, choose its permissions, rename it, change what it holds, or
 * delete it once nobody is assigned it any more.
 */
@Controller(IDENTITY_ROUTE)
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @Post('roles')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('identity:roles:write')
  async addRole(
    @Body(validated(CreateRoleBody)) body: Valid<typeof CreateRoleBody>,
  ): Promise<RoleResponse> {
    return this.roles.createRole(body);
  }

  @Get('roles')
  @RequirePermission('identity:roles:read')
  async listRoles(@Query() query: Record<string, unknown>): Promise<RoleListResponse> {
    return this.roles.listRoles(query);
  }

  @Get('roles/:id')
  @RequirePermission('identity:roles:read')
  async role(@Param('id') id: string): Promise<RoleResponse> {
    return this.roles.roleDetail(id);
  }

  @Patch('roles/:id')
  @RequirePermission('identity:roles:write')
  async changeRole(
    @Param('id') id: string,
    @Body(validated(UpdateRoleBody)) body: Valid<typeof UpdateRoleBody>,
  ): Promise<RoleResponse> {
    return this.roles.changeRole(id, body);
  }

  @Delete('roles/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('identity:roles:write')
  async removeRole(@Param('id') id: string): Promise<void> {
    await this.roles.removeRole(id);
  }
}
