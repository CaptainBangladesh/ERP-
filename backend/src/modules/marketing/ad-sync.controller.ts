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
  type AdAccountSyncListResponse,
  type AdAccountSyncResponse,
  type SyncAdAccountResponse,
} from '@erp/shared';
import { RequirePermission } from '../../platform/authorization';
import { validated, type Valid } from '../../platform/validation';
import { AdSyncService } from './ad-sync.service';
import {
  CreateAdSyncBody,
  UpdateAdSyncBody,
} from './schemas';

@Controller(MARKETING_ROUTE)
export class AdSyncController {
  constructor(private readonly adSyncService: AdSyncService) {}

  @Post('ad-syncs')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('marketing:ad-sync:write')
  async create(
    @Body(validated(CreateAdSyncBody)) body: Valid<typeof CreateAdSyncBody>,
  ): Promise<AdAccountSyncResponse> {
    return this.adSyncService.create(body);
  }

  @Get('ad-syncs')
  @RequirePermission('marketing:ad-sync:read')
  async list(@Query() query: Record<string, unknown>): Promise<AdAccountSyncListResponse> {
    return this.adSyncService.list(query);
  }

  @Get('ad-syncs/:id')
  @RequirePermission('marketing:ad-sync:read')
  async get(@Param('id') id: string): Promise<AdAccountSyncResponse> {
    return this.adSyncService.get(id);
  }

  @Post('ad-syncs/:id/sync')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('marketing:ad-sync:write')
  async syncNow(@Param('id') id: string): Promise<SyncAdAccountResponse> {
    return this.adSyncService.syncNow(id);
  }

  @Patch('ad-syncs/:id')
  @RequirePermission('marketing:ad-sync:write')
  async update(
    @Param('id') id: string,
    @Body(validated(UpdateAdSyncBody)) body: Valid<typeof UpdateAdSyncBody>,
  ): Promise<AdAccountSyncResponse> {
    return this.adSyncService.update(id, body);
  }

  @Delete('ad-syncs/:id')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('marketing:ad-sync:write')
  async delete(@Param('id') id: string): Promise<{ deleted: boolean }> {
    return this.adSyncService.delete(id);
  }
}
