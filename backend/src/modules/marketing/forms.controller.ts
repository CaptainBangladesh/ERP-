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
import type {
  LeadCaptureFormListResponse,
  LeadCaptureFormResponse,
  LeadCaptureSubmissionListResponse,
} from '@erp/shared';
import { RequirePermission } from '../../platform/authorization';
import { validated, type Valid } from '../../platform/validation';
import { FormsService } from './forms.service';
import { CreateLeadCaptureFormBody, UpdateLeadCaptureFormBody } from './schemas';

@Controller('api/marketing/forms')
export class FormsController {
  constructor(private readonly formsService: FormsService) {}

  @Get()
  @RequirePermission('marketing:forms:read')
  async listForms(@Query() query: Record<string, unknown>): Promise<LeadCaptureFormListResponse> {
    return this.formsService.listForms(query);
  }

  @Post()
  @RequirePermission('marketing:forms:write')
  async createForm(
    @Body(validated(CreateLeadCaptureFormBody)) body: Valid<typeof CreateLeadCaptureFormBody>,
  ): Promise<LeadCaptureFormResponse> {
    return this.formsService.createForm(body);
  }

  @Get(':id')
  @RequirePermission('marketing:forms:read')
  async getForm(@Param('id') id: string): Promise<LeadCaptureFormResponse> {
    return this.formsService.getForm(id);
  }

  @Patch(':id')
  @RequirePermission('marketing:forms:write')
  async updateForm(
    @Param('id') id: string,
    @Body(validated(UpdateLeadCaptureFormBody)) body: Valid<typeof UpdateLeadCaptureFormBody>,
  ): Promise<LeadCaptureFormResponse> {
    return this.formsService.updateForm(id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('marketing:forms:write')
  async deleteForm(@Param('id') id: string): Promise<{ deleted: boolean }> {
    return this.formsService.deleteForm(id);
  }

  @Get(':id/submissions')
  @RequirePermission('marketing:forms:read')
  async listSubmissions(
    @Param('id') id: string,
    @Query() query: Record<string, unknown>,
  ): Promise<LeadCaptureSubmissionListResponse> {
    return this.formsService.listSubmissions(id, query);
  }
}
