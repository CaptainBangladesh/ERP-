import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { CRM_ROUTE, type CaptureSubmitResponse, type PublicFormConfigResponse } from '@erp/shared';
import { Public } from '../../platform/auth';
import { validated, type Valid } from '../../platform/validation';
import { CaptureSourcesService } from './capture-sources.service';
import { SubmitCaptureBody } from './schemas';

@Controller(CRM_ROUTE)
export class PublicCaptureController {
  constructor(private readonly captureSourcesService: CaptureSourcesService) {}

  @Public()
  @Get('capture/:token/form')
  async getFormConfig(@Param('token') token: string): Promise<PublicFormConfigResponse> {
    return this.captureSourcesService.getPublicFormConfig(token);
  }

  @Public()
  @Post('capture/:token')
  @HttpCode(HttpStatus.OK)
  async submitCapture(
    @Param('token') token: string,
    @Body(validated(SubmitCaptureBody)) body: Valid<typeof SubmitCaptureBody>,
  ): Promise<CaptureSubmitResponse> {
    return this.captureSourcesService.submitCapture(token, body as Record<string, unknown>);
  }
}
