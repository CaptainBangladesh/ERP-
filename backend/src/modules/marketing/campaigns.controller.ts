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
  type BuildUtmResponse,
  type MarketingCampaignDetailResponse,
  type MarketingCampaignListResponse,
  type MarketingCampaignResponse,
} from '@erp/shared';
import { RequirePermission } from '../../platform/authorization';
import { validated, type Valid } from '../../platform/validation';
import { CampaignsService } from './campaigns.service';
import {
  BuildUtmBody,
  CreateCampaignBody,
  UpdateCampaignBody,
} from './schemas';

@Controller(MARKETING_ROUTE)
export class CampaignsController {
  constructor(private readonly campaigns: CampaignsService) {}

  @Post('campaigns')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('marketing:campaigns:write')
  async create(
    @Body(validated(CreateCampaignBody)) body: Valid<typeof CreateCampaignBody>,
  ): Promise<MarketingCampaignResponse> {
    return this.campaigns.create(body);
  }

  @Get('campaigns')
  @RequirePermission('marketing:campaigns:read')
  async list(@Query() query: Record<string, unknown>): Promise<MarketingCampaignListResponse> {
    return this.campaigns.list(query);
  }

  @Post('campaigns/utm/build')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('marketing:campaigns:read')
  async buildUtm(
    @Body(validated(BuildUtmBody)) body: Valid<typeof BuildUtmBody>,
  ): Promise<BuildUtmResponse> {
    return this.campaigns.buildUtm(body);
  }

  @Get('campaigns/:id')
  @RequirePermission('marketing:campaigns:read')
  async get(@Param('id') id: string): Promise<MarketingCampaignDetailResponse> {
    return this.campaigns.get(id);
  }

  @Patch('campaigns/:id')
  @RequirePermission('marketing:campaigns:write')
  async update(
    @Param('id') id: string,
    @Body(validated(UpdateCampaignBody)) body: Valid<typeof UpdateCampaignBody>,
  ): Promise<MarketingCampaignResponse> {
    return this.campaigns.update(id, body);
  }

  @Delete('campaigns/:id')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('marketing:campaigns:write')
  async delete(@Param('id') id: string): Promise<{ deleted: boolean }> {
    return this.campaigns.delete(id);
  }
}
