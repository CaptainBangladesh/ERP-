import { Body, Controller, Get, Param, Patch } from '@nestjs/common';
import {
  CRM_ROUTE,
  LEAD_STATUSES,
  type LeadStatus,
  type LeadStatusLabelListResponse,
  type LeadStatusLabelSummary,
} from '@erp/shared';
import { ValidationException } from '../../http/validation-exception';
import { RequirePermission } from '../../platform/authorization';
import { validated, type Valid } from '../../platform/validation';
import { LeadStatusLabelsService } from './lead-status-labels.service';
import { UpdateLeadStatusLabelBody } from './schemas';

/**
 * Per-company captions for the four fixed Lead statuses.
 *
 * There is no create and no delete: the four statuses are the lifecycle, so the only thing a
 * company can do is say what it calls them. `PATCH` on a status that has never been customised
 * is the same request as one on a status that has — the service does not make that a caller's
 * problem.
 */
@Controller(CRM_ROUTE)
export class LeadStatusLabelsController {
  constructor(private readonly labels: LeadStatusLabelsService) {}

  @Get('lead-status-labels')
  @RequirePermission('crm:leads:read')
  async list(): Promise<LeadStatusLabelListResponse> {
    return this.labels.listLabels();
  }

  @Patch('lead-status-labels/:status')
  @RequirePermission('crm:leads:write')
  async change(
    @Param('status') status: string,
    @Body(validated(UpdateLeadStatusLabelBody)) body: Valid<typeof UpdateLeadStatusLabelBody>,
  ): Promise<LeadStatusLabelSummary> {
    return this.labels.updateLabel(asLeadStatus(status), body);
  }
}

/**
 * The status is a path segment rather than a body field, so the validation pipe never sees it —
 * checked here explicitly, at the point where the untyped string becomes a typed one.
 */
function asLeadStatus(value: string): LeadStatus {
  if (!(LEAD_STATUSES as readonly string[]).includes(value)) {
    throw new ValidationException({ status: 'That is not a lead status.' });
  }
  return value as LeadStatus;
}
