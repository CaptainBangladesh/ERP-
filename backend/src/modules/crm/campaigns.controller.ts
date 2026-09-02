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
  CAMPAIGN_PATHS,
  type CampaignRecipientListResponse,
  type CampaignResponse,
  type CampaignSummary,
  type ListResponse,
  type SendCampaignBatchResponse,
} from '@erp/shared';
import { CurrentSession, type RequestSession } from '../../platform/auth';
import { RequirePermission } from '../../platform/authorization';
import { validated, type Valid } from '../../platform/validation';
import { CampaignsService } from './campaigns.service';
import {
  CreateCampaignBody,
  SendCampaignBatchBody,
  UpdateCampaignBody,
} from './schemas';

@Controller()
export class CampaignsController {
  constructor(private readonly campaignsService: CampaignsService) {}

  @Post(CAMPAIGN_PATHS.campaigns)
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('crm:leads:write')
  async create(
    @Body(validated(CreateCampaignBody)) body: Valid<typeof CreateCampaignBody>,
  ): Promise<CampaignResponse> {
    return this.campaignsService.createCampaign(body);
  }

  @Get(CAMPAIGN_PATHS.campaigns)
  @RequirePermission('crm:leads:read')
  async list(
    @Query() query: Record<string, unknown>,
  ): Promise<ListResponse<CampaignSummary>> {
    return this.campaignsService.listCampaigns(query as any);
  }

  @Get(CAMPAIGN_PATHS.campaign(':id'))
  @RequirePermission('crm:leads:read')
  async get(
    @Param('id') id: string,
  ): Promise<CampaignResponse> {
    return this.campaignsService.getCampaign(id);
  }

  @Patch(CAMPAIGN_PATHS.campaign(':id'))
  @RequirePermission('crm:leads:write')
  async update(
    @Param('id') id: string,
    @Body(validated(UpdateCampaignBody)) body: Valid<typeof UpdateCampaignBody>,
  ): Promise<CampaignResponse> {
    return this.campaignsService.updateCampaign(id, body);
  }

  /**
   * Discards a draft. `write` rather than a delete permission of its own, because every other
   * campaign write is guarded by exactly this one and a draft nobody has sent is not a heavier
   * act than editing it.
   */
  @Delete(CAMPAIGN_PATHS.campaign(':id'))
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('crm:leads:write')
  async discard(@Param('id') id: string): Promise<void> {
    return this.campaignsService.discardCampaign(id);
  }

  @Post(CAMPAIGN_PATHS.materialize(':id'))
  @HttpCode(HttpStatus.OK)
  @RequirePermission('crm:leads:write')
  async materialize(
    @Param('id') id: string,
  ): Promise<CampaignResponse> {
    return this.campaignsService.materializeCampaign(id);
  }

  @Post(CAMPAIGN_PATHS.sendBatch(':id'))
  @HttpCode(HttpStatus.OK)
  @RequirePermission('crm:leads:write')
  async sendBatch(
    @Param('id') id: string,
    @Body(validated(SendCampaignBatchBody)) body: Valid<typeof SendCampaignBatchBody>,
    @CurrentSession() session: RequestSession,
  ): Promise<SendCampaignBatchResponse> {
    return this.campaignsService.sendBatch(id, body.batchSize, {
      userId: session.user.id,
      name: session.user.name,
    });
  }

  @Get(CAMPAIGN_PATHS.recipients(':id'))
  @RequirePermission('crm:leads:read')
  async listRecipients(
    @Param('id') id: string,
  ): Promise<CampaignRecipientListResponse> {
    return this.campaignsService.listRecipients(id);
  }
}
