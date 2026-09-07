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
  type SmartLinkDetailResponse,
  type SmartLinkListResponse,
  type SmartLinkResponse,
} from '@erp/shared';
import { RequirePermission } from '../../platform/authorization';
import { validated, type Valid } from '../../platform/validation';
import {
  CreateSmartLinkBody,
  UpdateSmartLinkBody,
} from './schemas';
import { SmartLinksService } from './smart-links.service';

@Controller(MARKETING_ROUTE)
export class SmartLinksController {
  constructor(private readonly smartLinks: SmartLinksService) {}

  @Post('smart-links')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('marketing:smart-links:write')
  async create(
    @Body(validated(CreateSmartLinkBody)) body: Valid<typeof CreateSmartLinkBody>,
  ): Promise<SmartLinkResponse> {
    return this.smartLinks.create(body);
  }

  @Get('smart-links')
  @RequirePermission('marketing:smart-links:read')
  async list(@Query() query: Record<string, unknown>): Promise<SmartLinkListResponse> {
    return this.smartLinks.list(query);
  }

  @Get('smart-links/:id')
  @RequirePermission('marketing:smart-links:read')
  async get(@Param('id') id: string): Promise<SmartLinkDetailResponse> {
    return this.smartLinks.get(id);
  }

  @Patch('smart-links/:id')
  @RequirePermission('marketing:smart-links:write')
  async update(
    @Param('id') id: string,
    @Body(validated(UpdateSmartLinkBody)) body: Valid<typeof UpdateSmartLinkBody>,
  ): Promise<SmartLinkResponse> {
    return this.smartLinks.update(id, body);
  }

  @Delete('smart-links/:id')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('marketing:smart-links:write')
  async delete(@Param('id') id: string): Promise<{ deleted: boolean }> {
    return this.smartLinks.delete(id);
  }
}
