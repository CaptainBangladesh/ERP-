import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  CRM_ROUTE,
  type CaptureSourceListResponse,
  type CaptureSourceResponse,
  type CaptureSourceSummary,
  type CreateCaptureSourceRequest,
  type UpdateCaptureSourceRequest,
} from '@erp/shared';
import { RequirePermission } from '../../platform/authorization';
import { validated, type Valid } from '../../platform/validation';
import { CreateCaptureSourceBody, UpdateCaptureSourceBody } from './schemas';
import { CaptureSourcesService } from './capture-sources.service';

@Controller(CRM_ROUTE)
export class CaptureSourcesController {
  constructor(private readonly captureSourcesService: CaptureSourcesService) {}

  @Post('capture-sources')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('crm:leads:write')
  async create(
    @Body(validated(CreateCaptureSourceBody)) body: Valid<typeof CreateCaptureSourceBody>,
  ): Promise<CaptureSourceResponse> {
    const input = body as unknown as CreateCaptureSourceRequest;
    return this.captureSourcesService.create({
      kind: input.kind ?? 'webform',
      ...input,
    });
  }

  @Get('capture-sources')
  @RequirePermission('crm:leads:read')
  async list(
    @Query() query: Record<string, unknown>,
  ): Promise<CaptureSourceListResponse> {
    return this.captureSourcesService.list(query);
  }

  @Get('capture-sources/:id')
  @RequirePermission('crm:leads:read')
  async getOne(@Param('id') id: string): Promise<CaptureSourceResponse> {
    return this.captureSourcesService.getOne(id);
  }

  @Patch('capture-sources/:id')
  @RequirePermission('crm:leads:write')
  async update(
    @Param('id') id: string,
    @Body(validated(UpdateCaptureSourceBody)) body: Valid<typeof UpdateCaptureSourceBody>,
  ): Promise<CaptureSourceResponse> {
    return this.captureSourcesService.update(id, body as unknown as UpdateCaptureSourceRequest);
  }

  @Post('capture-sources/:id/rotate-token')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('crm:leads:write')
  async rotateToken(@Param('id') id: string): Promise<CaptureSourceSummary> {
    return this.captureSourcesService.rotateToken(id);
  }
}
