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
import type { NurtureSequenceListResponse, NurtureSequenceResponse } from '@erp/shared';
import { RequirePermission } from '../../platform/authorization';
import { validated, type Valid } from '../../platform/validation';
import { NurtureSequencesService } from './nurture-sequences.service';
import { CreateNurtureSequenceBody, UpdateNurtureSequenceBody } from './schemas';

@Controller('api/marketing/nurture-sequences')
export class NurtureSequencesController {
  constructor(private readonly nurtureService: NurtureSequencesService) {}

  @Get()
  @RequirePermission('marketing:nurture:read')
  async listSequences(@Query() query: Record<string, unknown>): Promise<NurtureSequenceListResponse> {
    return this.nurtureService.listSequences(query);
  }

  @Post()
  @RequirePermission('marketing:nurture:write')
  async createSequence(
    @Body(validated(CreateNurtureSequenceBody)) body: Valid<typeof CreateNurtureSequenceBody>,
  ): Promise<NurtureSequenceResponse> {
    return this.nurtureService.createSequence(body);
  }

  @Get(':id')
  @RequirePermission('marketing:nurture:read')
  async getSequence(@Param('id') id: string): Promise<NurtureSequenceResponse> {
    return this.nurtureService.getSequence(id);
  }

  @Patch(':id')
  @RequirePermission('marketing:nurture:write')
  async updateSequence(
    @Param('id') id: string,
    @Body(validated(UpdateNurtureSequenceBody)) body: Valid<typeof UpdateNurtureSequenceBody>,
  ): Promise<NurtureSequenceResponse> {
    return this.nurtureService.updateSequence(id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('marketing:nurture:write')
  async deleteSequence(@Param('id') id: string): Promise<{ deleted: boolean }> {
    return this.nurtureService.deleteSequence(id);
  }
}
