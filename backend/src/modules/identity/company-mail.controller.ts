import { Body, Controller, Delete, Get, Patch } from '@nestjs/common';
import { IDENTITY_ROUTE, type CompanyMailSettingsResponse } from '@erp/shared';
import { RequirePermission } from '../../platform/authorization';
import { validated, type Valid } from '../../platform/validation';
import { CompanyMailService } from './company-mail.service';
import { UpdateCompanyMailSettingsBody } from './schemas';

/**
 * How this company's own mail leaves — invitations, password resets, anything the system
 * sends on its own behalf.
 *
 * Guarded by `identity:company:write` rather than by being the owner: running a company's mail
 * is an administrative job somebody may be given without being handed everything else. The
 * read is separate, because a screen that shows whether mail is configured is not the same
 * trust as a screen that can change where it goes.
 */
@Controller(`${IDENTITY_ROUTE}/company`)
export class CompanyMailController {
  constructor(private readonly companyMail: CompanyMailService) {}

  @Get('mail')
  @RequirePermission('identity:company:read')
  async settings(): Promise<CompanyMailSettingsResponse> {
    return this.companyMail.settings();
  }

  @Patch('mail')
  @RequirePermission('identity:company:write')
  async update(
    @Body(validated(UpdateCompanyMailSettingsBody))
    body: Valid<typeof UpdateCompanyMailSettingsBody>,
  ): Promise<CompanyMailSettingsResponse> {
    return this.companyMail.update(body);
  }

  /** Stops using this company's own mail. The deployment's configuration takes over again. */
  @Delete('mail')
  @RequirePermission('identity:company:write')
  async clear(): Promise<CompanyMailSettingsResponse> {
    return this.companyMail.clear();
  }
}
