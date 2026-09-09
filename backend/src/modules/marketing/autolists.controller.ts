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
  MARKETING_ROUTE,
  type AutolistDetailResponse,
  type AutolistItemResponse,
  type AutolistListResponse,
  type AutolistResponse,
  type CycleAutolistResponse,
} from '@erp/shared';
import { RequirePermission } from '../../platform/authorization';
import { validated, type Valid } from '../../platform/validation';
import { AutolistsService } from './autolists.service';
import {
  CreateAutolistBody,
  CreateAutolistItemBody,
  UpdateAutolistBody,
  UpdateAutolistItemBody,
} from './schemas';

@Controller(MARKETING_ROUTE)
export class AutolistsController {
  constructor(private readonly autolists: AutolistsService) {}

  @Post('autolists')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('marketing:autolists:write')
  async create(
    @Body(validated(CreateAutolistBody)) body: Valid<typeof CreateAutolistBody>,
  ): Promise<AutolistResponse> {
    return this.autolists.createAutolist(body);
  }

  @Get('autolists')
  @RequirePermission('marketing:autolists:read')
  async list(@Query() query: Record<string, unknown>): Promise<AutolistListResponse> {
    return this.autolists.listAutolists(query);
  }

  @Get('autolists/:id')
  @RequirePermission('marketing:autolists:read')
  async one(@Param('id') id: string): Promise<AutolistDetailResponse> {
    return this.autolists.getAutolist(id);
  }

  @Patch('autolists/:id')
  @RequirePermission('marketing:autolists:write')
  async update(
    @Param('id') id: string,
    @Body(validated(UpdateAutolistBody)) body: Valid<typeof UpdateAutolistBody>,
  ): Promise<AutolistResponse> {
    return this.autolists.updateAutolist(id, body);
  }

  @Delete('autolists/:id')
  @RequirePermission('marketing:autolists:write')
  async delete(@Param('id') id: string): Promise<{ deleted: boolean }> {
    return this.autolists.deleteAutolist(id);
  }

  @Post('autolists/:id/items')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('marketing:autolists:write')
  async addItem(
    @Param('id') id: string,
    @Body(validated(CreateAutolistItemBody)) body: Valid<typeof CreateAutolistItemBody>,
  ): Promise<AutolistItemResponse> {
    return this.autolists.addItem(id, body);
  }

  @Patch('autolists/:autolistId/items/:itemId')
  @RequirePermission('marketing:autolists:write')
  async updateItem(
    @Param('autolistId') autolistId: string,
    @Param('itemId') itemId: string,
    @Body(validated(UpdateAutolistItemBody)) body: Valid<typeof UpdateAutolistItemBody>,
  ): Promise<AutolistItemResponse> {
    return this.autolists.updateItem(autolistId, itemId, body);
  }

  @Delete('autolists/:autolistId/items/:itemId')
  @RequirePermission('marketing:autolists:write')
  async deleteItem(
    @Param('autolistId') autolistId: string,
    @Param('itemId') itemId: string,
  ): Promise<{ deleted: boolean }> {
    return this.autolists.deleteItem(autolistId, itemId);
  }

  @Post('autolists/:id/cycle')
  @RequirePermission('marketing:autolists:write')
  async cycle(@Param('id') id: string): Promise<CycleAutolistResponse> {
    return this.autolists.cycleAutolist(id);
  }
}
