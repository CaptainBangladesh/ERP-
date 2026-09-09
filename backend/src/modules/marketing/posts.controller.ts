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
  type PublishPostResponse,
  type ScheduledPostListResponse,
  type ScheduledPostResponse,
  type SyncMetricsResponse,
} from '@erp/shared';
import { RequirePermission } from '../../platform/authorization';
import { validated, type Valid } from '../../platform/validation';
import {
  CreateScheduledPostBody,
  UpdateScheduledPostBody,
} from './schemas';
import { SocialPublisherService } from './social-publisher.service';

@Controller(MARKETING_ROUTE)
export class PostsController {
  constructor(private readonly publisher: SocialPublisherService) {}

  @Post('posts')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('marketing:posts:write')
  async create(
    @Body(validated(CreateScheduledPostBody)) body: Valid<typeof CreateScheduledPostBody>,
  ): Promise<ScheduledPostResponse> {
    return this.publisher.schedulePost(body);
  }

  @Get('posts')
  @RequirePermission('marketing:posts:read')
  async list(@Query() query: Record<string, unknown>): Promise<ScheduledPostListResponse> {
    return this.publisher.listPosts(query);
  }

  @Get('posts/:id')
  @RequirePermission('marketing:posts:read')
  async one(@Param('id') id: string): Promise<ScheduledPostResponse> {
    return this.publisher.getPost(id);
  }

  @Patch('posts/:id')
  @RequirePermission('marketing:posts:write')
  async update(
    @Param('id') id: string,
    @Body(validated(UpdateScheduledPostBody)) body: Valid<typeof UpdateScheduledPostBody>,
  ): Promise<ScheduledPostResponse> {
    return this.publisher.updatePost(id, body);
  }

  @Delete('posts/:id')
  @RequirePermission('marketing:posts:write')
  async cancel(@Param('id') id: string): Promise<ScheduledPostResponse> {
    return this.publisher.cancelPost(id);
  }

  @Post('posts/:id/publish-now')
  @RequirePermission('marketing:posts:write')
  async publishNow(@Param('id') id: string): Promise<PublishPostResponse> {
    return this.publisher.publishNow(id);
  }

  @Post('posts/:id/metrics')
  @RequirePermission('marketing:posts:write')
  async syncMetrics(@Param('id') id: string): Promise<SyncMetricsResponse> {
    return this.publisher.syncMetrics(id);
  }
}
