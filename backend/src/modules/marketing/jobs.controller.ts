import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import {
  MARKETING_ROUTE,
  type CancelJobResponse,
  type MarketingJobListResponse,
  type MarketingJobResponse,
  type RetryJobResponse,
  type MarketingJobStatus,
} from '@erp/shared';
import { RequirePermission } from '../../platform/authorization';
import { ApiException } from '../../http/api-exception';
import { validated, type Valid } from '../../platform/validation';
import { PostgresJobQueueService } from './postgres-job-queue.service';
import { ScheduleJobBody } from './schemas';

@Controller(MARKETING_ROUTE)
export class JobsController {
  constructor(private readonly queue: PostgresJobQueueService) {}

  @Post('jobs')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('marketing:jobs:write')
  async schedule(
    @Body(validated(ScheduleJobBody)) body: Valid<typeof ScheduleJobBody>,
  ): Promise<MarketingJobResponse> {
    const scheduledAt = body.scheduledAt ? new Date(body.scheduledAt) : new Date();

    return this.queue.schedule({
      type: body.type,
      payload: body.payload ?? {},
      scheduledAt,
      maxAttempts: body.maxAttempts,
    });
  }

  @Get('jobs')
  @RequirePermission('marketing:jobs:read')
  async list(@Query() query: Record<string, unknown>): Promise<MarketingJobListResponse> {
    return this.queue.listJobs(query);
  }

  @Get('jobs/:id')
  @RequirePermission('marketing:jobs:read')
  async one(@Param('id') id: string): Promise<MarketingJobResponse> {
    const job = await this.queue.getJob(id);
    if (!job) {
      throw new ApiException('marketing_job_not_found', 'Job not found', 404);
    }
    return job;
  }

  @Post('jobs/:id/cancel')
  @RequirePermission('marketing:jobs:write')
  async cancel(@Param('id') id: string): Promise<CancelJobResponse> {
    const cancelled = await this.queue.cancel(id);
    const job = await this.queue.getJob(id);
    if (!job) {
      throw new ApiException('marketing_job_not_found', 'Job not found', 404);
    }
    return { cancelled, job };
  }

  @Post('jobs/:id/retry')
  @RequirePermission('marketing:jobs:write')
  async retry(@Param('id') id: string): Promise<RetryJobResponse> {
    const retriedJob = await this.queue.retry(id);
    return { retried: true, job: retriedJob };
  }
}
