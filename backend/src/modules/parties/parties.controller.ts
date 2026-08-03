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
import {
  PARTIES_ROUTE,
  type PartyListResponse,
  type PartyResponse,
  type PartyRolesResponse,
} from '@erp/shared';
import { validated, type Valid } from '../../platform/validation';
import { PartiesService } from './parties.service';
import {
  AddPartyRoleBody,
  CreatePartyAddressBody,
  CreatePartyBody,
  MergePartiesBody,
  UpdatePartyBody,
} from './schemas';

/**
 * The address book's surface.
 *
 * Nothing is `@Public()`, nothing takes a company, and there is no `DELETE /parties/:id`.
 * The absence is the design: a party is deactivated rather than deleted, so that the orders
 * and movements naming it stay intelligible. Addresses and roles *are* deletable, because
 * neither is something later history refers to.
 *
 * The list endpoint hands its whole query object to the service. Nothing here names `page`,
 * `sort`, `search` or a filter: those are the platform's convention, identical in every
 * module, and a controller with an opinion about them would be this module inventing its own.
 */
@Controller(PARTIES_ROUTE)
export class PartiesController {
  constructor(private readonly parties: PartiesService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async addParty(
    @Body(validated(CreatePartyBody)) body: Valid<typeof CreatePartyBody>,
  ): Promise<PartyResponse> {
    return this.parties.createParty(body);
  }

  @Get()
  async listParties(@Query() query: Record<string, unknown>): Promise<PartyListResponse> {
    return this.parties.listParties(query);
  }

  /**
   * Declared before `:id`, and it has to be: Nest matches routes in the order they are
   * registered, so a parameterised path written first would swallow `roles` and try to look
   * up a party by that name.
   */
  @Get('roles')
  async roles(): Promise<PartyRolesResponse> {
    return this.parties.rolesInUse();
  }

  @Get(':id')
  async party(@Param('id') id: string): Promise<PartyResponse> {
    return this.parties.partyDetail(id);
  }

  @Patch(':id')
  async changeParty(
    @Param('id') id: string,
    @Body(validated(UpdatePartyBody)) body: Valid<typeof UpdatePartyBody>,
  ): Promise<PartyResponse> {
    return this.parties.changeParty(id, body);
  }

  @Post(':id/roles')
  @HttpCode(HttpStatus.OK)
  async addRole(
    @Param('id') id: string,
    @Body(validated(AddPartyRoleBody)) body: Valid<typeof AddPartyRoleBody>,
  ): Promise<PartyResponse> {
    return this.parties.addRole(id, body);
  }

  /**
   * Answers with the party rather than nothing, which is why it is a 200 and not a 204: a
   * screen that has just changed somebody's roles wants the roles they now hold, and a
   * second request to find out would be a second chance for the two to disagree.
   */
  @Delete(':id/roles/:role')
  async removeRole(
    @Param('id') id: string,
    @Param('role') role: string,
  ): Promise<PartyResponse> {
    return this.parties.removeRole(id, role);
  }

  @Post(':id/addresses')
  @HttpCode(HttpStatus.CREATED)
  async addAddress(
    @Param('id') id: string,
    @Body(validated(CreatePartyAddressBody)) body: Valid<typeof CreatePartyAddressBody>,
  ): Promise<PartyResponse> {
    return this.parties.addAddress(id, body);
  }

  @Delete(':id/addresses/:addressId')
  async removeAddress(
    @Param('id') id: string,
    @Param('addressId') addressId: string,
  ): Promise<PartyResponse> {
    return this.parties.removeAddress(id, addressId);
  }

  /**
   * The party in the path survives; the one in the body is the duplicate. That way round
   * because the URL names the record the caller is keeping, and every other endpoint here
   * uses the path to name the party being acted on.
   */
  @Post(':id/merge')
  @HttpCode(HttpStatus.OK)
  async merge(
    @Param('id') id: string,
    @Body(validated(MergePartiesBody)) body: Valid<typeof MergePartiesBody>,
  ): Promise<PartyResponse> {
    return this.parties.mergeParties(id, body);
  }
}
