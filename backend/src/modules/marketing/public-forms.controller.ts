import { Body, Controller, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import type { PublicFormSubmitResponse } from '@erp/shared';
import { Public } from '../../platform/auth';
import { validated, type Valid } from '../../platform/validation';
import { FormsService } from './forms.service';
import { SubmitPublicFormBody } from './schemas';

@Controller()
export class PublicFormsController {
  constructor(private readonly formsService: FormsService) {}

  @Public()
  @Post('api/marketing/forms/:formId/submit')
  @HttpCode(HttpStatus.OK)
  async submitForm(
    @Param('formId') formId: string,
    @Body(validated(SubmitPublicFormBody)) body: Valid<typeof SubmitPublicFormBody>,
  ): Promise<PublicFormSubmitResponse> {
    return this.formsService.submitPublicForm(formId, body);
  }
}
