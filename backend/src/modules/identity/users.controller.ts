import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import {
  IDENTITY_ROUTE,
  type InvitationListResponse,
  type InvitationResponse,
  type UserListResponse,
  type UserResponse,
} from '@erp/shared';
import { CurrentSession, type RequestSession } from '../../platform/auth';
import { RequirePermission } from '../../platform/authorization';
import { validated, type Valid } from '../../platform/validation';
import { UsersService } from './users.service';
import { AssignRoleBody, InviteColleagueBody } from './schemas';

/**
 * Colleagues: who is in the company, the roles each of them holds, and inviting somebody new.
 *
 * Nothing here creates a user directly — that is what accepting an invitation does, over in
 * `IdentityController`, because a colleague chooses their own password rather than being
 * handed one.
 */
@Controller(IDENTITY_ROUTE)
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('users')
  @RequirePermission('identity:users:read')
  async listUsers(@Query() query: Record<string, unknown>): Promise<UserListResponse> {
    return this.users.listUsers(query);
  }

  /**
   * Answers with the colleague rather than nothing, which is why it is a 200 and not a 204: a
   * screen that has just changed somebody's roles wants the roles they now hold, and a second
   * request to find out would be a second chance for the two to disagree.
   */
  @Post('users/:id/roles')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('identity:users:write')
  async assignRole(
    @Param('id') id: string,
    @Body(validated(AssignRoleBody)) body: Valid<typeof AssignRoleBody>,
  ): Promise<UserResponse> {
    return this.users.assignRole(id, body);
  }

  @Delete('users/:id/roles/:roleId')
  @RequirePermission('identity:users:write')
  async removeRole(
    @Param('id') id: string,
    @Param('roleId') roleId: string,
  ): Promise<UserResponse> {
    return this.users.removeRole(id, roleId);
  }

  @Get('invitations')
  @RequirePermission('identity:users:read')
  async listInvitations(
    @Query() query: Record<string, unknown>,
  ): Promise<InvitationListResponse> {
    return this.users.listInvitations(query);
  }

  @Post('invitations')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('identity:users:write')
  async inviteColleague(
    @CurrentSession() session: RequestSession,
    @Body(validated(InviteColleagueBody)) body: Valid<typeof InviteColleagueBody>,
  ): Promise<InvitationResponse> {
    return this.users.inviteColleague(session.user.id, body);
  }
}
