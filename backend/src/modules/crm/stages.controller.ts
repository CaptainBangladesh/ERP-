import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query } from '@nestjs/common';
import { CRM_ROUTE, type StageListResponse, type StageResponse } from '@erp/shared';
import { RequirePermission } from '../../platform/authorization';
import { validated, type Valid } from '../../platform/validation';
import { CreateStageBody, UpdateStageBody } from './schemas';
import { StagesService } from './stages.service';

/**
 * Stages: a company's own pipeline, as an API.
 *
 * There is a `DELETE`, unlike Lead's — a Stage nobody uses is really gone, not a status that
 * changes meaning; `StagesService.deleteStage` refuses it while any Deal still sits there.
 *
 * "Reorder" is not its own endpoint: sending `order` in an ordinary `PATCH` moves a Stage, and
 * sending `name` renames it — the same request may do both, per the spec.
 */
@Controller(CRM_ROUTE)
export class StagesController {
  constructor(private readonly stages: StagesService) {}

  @Post('stages')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('crm:stages:write')
  async add(
    @Body(validated(CreateStageBody)) body: Valid<typeof CreateStageBody>,
  ): Promise<StageResponse> {
    return this.stages.createStage(body);
  }

  @Get('stages')
  @RequirePermission('crm:stages:read')
  async list(@Query() query: Record<string, unknown>): Promise<StageListResponse> {
    return this.stages.listStages(query);
  }

  @Get('stages/:id')
  @RequirePermission('crm:stages:read')
  async one(@Param('id') id: string): Promise<StageResponse> {
    return this.stages.stageDetail(id);
  }

  @Patch('stages/:id')
  @RequirePermission('crm:stages:write')
  async change(
    @Param('id') id: string,
    @Body(validated(UpdateStageBody)) body: Valid<typeof UpdateStageBody>,
  ): Promise<StageResponse> {
    return this.stages.changeStage(id, body);
  }

  @Delete('stages/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('crm:stages:write')
  async remove(@Param('id') id: string): Promise<void> {
    return this.stages.deleteStage(id);
  }
}
