import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post } from '@nestjs/common';
import {
  CRM_ROUTE,
  type LeadStatusKey,
  type LeadStatusLabelListResponse,
  type LeadStatusLabelSummary,
} from '@erp/shared';
import { ValidationException } from '../../http/validation-exception';
import { RequirePermission } from '../../platform/authorization';
import { validated, type Valid } from '../../platform/validation';
import { LeadStatusLabelsService } from './lead-status-labels.service';
import { CreateLeadStatusLabelBody, UpdateLeadStatusLabelBody } from './schemas';

/**
 * The statuses on a company's Leads board.
 *
 * `PATCH` works on any of them and is the same request whether or not the status has been
 * customised before — the service does not make "not customised yet" a caller's problem.
 *
 * `POST` and `DELETE` reach only the company's own stages. The four built-in statuses are the
 * lifecycle `qualify`, `disqualify` and `reopen` act on, so they can be renamed and recoloured
 * but never created or removed, and the refusal for trying says which of the two it is.
 */
@Controller(CRM_ROUTE)
export class LeadStatusLabelsController {
  constructor(private readonly labels: LeadStatusLabelsService) {}

  @Get('lead-status-labels')
  @RequirePermission('crm:leads:read')
  async list(): Promise<LeadStatusLabelListResponse> {
    return this.labels.listLabels();
  }

  @Post('lead-status-labels')
  @RequirePermission('crm:leads:write')
  async add(
    @Body(validated(CreateLeadStatusLabelBody)) body: Valid<typeof CreateLeadStatusLabelBody>,
  ): Promise<LeadStatusLabelSummary> {
    return this.labels.createLabel(body);
  }

  @Patch('lead-status-labels/:status')
  @RequirePermission('crm:leads:write')
  async change(
    @Param('status') status: string,
    @Body(validated(UpdateLeadStatusLabelBody)) body: Valid<typeof UpdateLeadStatusLabelBody>,
  ): Promise<LeadStatusLabelSummary> {
    return this.labels.updateLabel(asStatusKey(status), body);
  }

  @Delete('lead-status-labels/:status')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('crm:leads:write')
  async remove(@Param('status') status: string): Promise<void> {
    await this.labels.deleteLabel(asStatusKey(status));
  }
}

/**
 * The status is a path segment rather than a body field, so the validation pipe never sees it —
 * checked here explicitly, at the point where the untyped string becomes a typed one.
 *
 * Only the shape, no longer a membership test: a company's own statuses are rows, and whether
 * this particular key names one of them is the service's question to answer against the
 * database. What this stops is a path segment that could not be a status key at all.
 */
function asStatusKey(value: string): LeadStatusKey {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)) {
    throw new ValidationException({ status: 'That is not a lead status.' });
  }
  return value;
}
