import { Controller, Get, Header, Param, StreamableFile } from '@nestjs/common';
import { Public } from '../../platform/auth';
import { LeadOutreachService } from './lead-outreach.service';

/**
 * A 1×1 GIF, and the only unauthenticated surface a 1:1 email has.
 *
 * It exists to be fetched by a stranger's mail client, so it holds no session and reveals
 * nothing: whatever the token turns out to be — real, spent, or invented — the answer is the
 * same transparent pixel. A refusal here would tell whoever probed it which tokens are real,
 * and would show a broken image to the one person the endpoint is not about.
 *
 * Mirrors `PublicCampaignsController`, which does the same job for campaign sends.
 */
const TRANSPARENT_1X1_GIF = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64',
);

@Controller()
export class PublicLeadEmailController {
  constructor(private readonly outreach: LeadOutreachService) {}

  @Public()
  @Get('api/public/lead-emails/open/:token')
  @Header('Content-Type', 'image/gif')
  @Header('Cache-Control', 'no-cache, no-store, must-revalidate')
  async trackOpen(@Param('token') token: string): Promise<StreamableFile> {
    try {
      await this.outreach.trackOpen(token);
    } catch {
      // The pixel is the recipient's, not ours. Whatever went wrong recording the open, they
      // get their image — a broken one in the middle of somebody's email helps nobody.
    }
    return new StreamableFile(TRANSPARENT_1X1_GIF);
  }
}
