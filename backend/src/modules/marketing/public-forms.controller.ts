import { Body, Controller, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import type { PublicFormSubmitResponse } from '@erp/shared';
import { Public } from '../../platform/auth';
import { Throttle } from '../../platform/throttling';
import { validated, type Valid } from '../../platform/validation';
import { FormsService } from './forms.service';
import { SubmitPublicFormBody } from './schemas';

@Controller()
export class PublicFormsController {
  constructor(private readonly formsService: FormsService) {}

  /**
   * The worst-exposed write in the module: unauthenticated, and it creates a CRM `Lead`.
   *
   * Keyed by form as well as by caller, so flooding one form cannot exhaust the pipeline's
   * whole budget. Ten a minute is generous for a human filling in a form and useless for
   * anyone trying to fill a sales pipeline with noise.
   */
  @Public()
  @Throttle({ max: 10, ttl: 60_000, by: 'formId' })
  @Post('api/marketing/forms/:formId/submit')
  @HttpCode(HttpStatus.OK)
  async submitForm(
    @Param('formId') formId: string,
    @Body(validated(SubmitPublicFormBody)) body: Valid<typeof SubmitPublicFormBody>,
  ): Promise<PublicFormSubmitResponse> {
    return this.formsService.submitPublicForm(formId, body);
  }
}
