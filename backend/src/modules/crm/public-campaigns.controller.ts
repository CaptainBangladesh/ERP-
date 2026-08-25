import { Controller, Get, Header, Param, StreamableFile } from '@nestjs/common';
import { CRM_ROUTE, type PublicUnsubscribeResponse } from '@erp/shared';
import { Public } from '../../platform/auth';
import { CampaignsService } from './campaigns.service';

const TRANSPARENT_1X1_GIF = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64',
);

@Controller(CRM_ROUTE)
export class PublicCampaignsController {
  constructor(private readonly campaignsService: CampaignsService) {}

  @Public()
  @Get('e/:token.gif')
  @Header('Content-Type', 'image/gif')
  @Header('Cache-Control', 'no-cache, no-store, must-revalidate')
  async trackOpen(
    @Param('token') token: string,
  ): Promise<StreamableFile> {
    try {
      await this.campaignsService.trackOpen(token);
    } catch {
      // Ignore errors for public tracking pixel to ensure 1x1 GIF is always returned
    }
    return new StreamableFile(TRANSPARENT_1X1_GIF);
  }

  @Public()
  @Get('unsubscribe/:token')
  async unsubscribe(
    @Param('token') token: string,
  ): Promise<PublicUnsubscribeResponse> {
    return this.campaignsService.unsubscribe(token);
  }
}
