import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import {
  MARKETING_ROUTE,
  type ContentFeedEntryListResponse,
  type ContentFeedListResponse,
  type ContentFeedSummary,
} from '@erp/shared';
import { RequirePermission } from '../../platform/authorization';
import { validated, type Valid } from '../../platform/validation';
import { ContentFeedsService } from './content-feeds.service';
import { CreateContentFeedBody } from './schemas';

/**
 * Feeds an operator watches, and the drafts they produced.
 *
 * Note what no route here does: fetch. `poll` and `enable` enqueue a job and return — every
 * outbound request in this module runs on the queue (14-17.0), so a remote host that hangs
 * cannot hold an HTTP thread, and `OutboundFetchService` throws rather than obliging anyone
 * who forgets that.
 */
@Controller(MARKETING_ROUTE)
export class ContentFeedsController {
  constructor(private readonly feeds: ContentFeedsService) {}

  @Get('content-feeds')
  @RequirePermission('marketing:content-feeds:read')
  async list(@Query() query: Record<string, unknown>): Promise<ContentFeedListResponse> {
    return this.feeds.listFeeds(query);
  }

  @Post('content-feeds')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('marketing:content-feeds:write')
  async create(
    @Body(validated(CreateContentFeedBody)) body: Valid<typeof CreateContentFeedBody>,
  ): Promise<ContentFeedSummary> {
    return this.feeds.createFeed(body);
  }

  @Post('content-feeds/:id/poll')
  @RequirePermission('marketing:content-feeds:write')
  async poll(@Param('id') id: string): Promise<ContentFeedSummary> {
    return this.feeds.requestPoll(id);
  }

  @Post('content-feeds/:id/enable')
  @RequirePermission('marketing:content-feeds:write')
  async enable(@Param('id') id: string): Promise<ContentFeedSummary> {
    return this.feeds.enableFeed(id);
  }

  @Delete('content-feeds/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('marketing:content-feeds:write')
  async remove(@Param('id') id: string): Promise<void> {
    await this.feeds.deleteFeed(id);
  }

  @Get('content-feed-entries')
  @RequirePermission('marketing:content-feeds:read')
  async entries(@Query() query: Record<string, unknown>): Promise<ContentFeedEntryListResponse> {
    return this.feeds.listEntries(query);
  }
}
