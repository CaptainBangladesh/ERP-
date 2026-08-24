import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  CRM_EVENTS,
  LEAD_ERROR_CODES,
  type LeadListResponse,
  type LeadResponse,
  type LeadSource,
  type LeadStatus,
  type LeadSummary,
} from '@erp/shared';
import { ApiException } from '../../http/api-exception';
import { defined } from '../../prisma/columns';
import { DomainEvents } from '../../platform/events';
import { listQuery } from '../../platform/list';
import { companyApplied, InjectPrisma, type ScopedPrisma } from '../../platform/tenancy';
import type { Valid } from '../../platform/validation';
import { PartyDirectory } from '../parties';
import { CreateLeadBody, LEAD_LIST, QualifyLeadBody, UpdateLeadBody } from './schemas';
import { WorkflowRulesService } from './workflow-rules.service';

/**
 * A prospect, before there is a `Party` to hold it.
 *
 * Two things below are the platform's rather than this module's, exactly as in every other
 * module: there is no company filter anywhere, and nothing is deleted — a Lead that goes
 * nowhere is `disqualified` rather than gone, so it can be reopened later without starting
 * over.
 *
 * The third is this module's own discipline rather than the platform's: qualifying,
 * disqualifying and reopening are each their own method rather than reachable through the
 * general update, because each carries a side effect — setting `partyId`, freezing or
 * restoring `priorStatus` — that a bare `status` write would have no way to also do.
 */
@Injectable()
export class LeadsService {
  constructor(
    @InjectPrisma() private readonly prisma: ScopedPrisma,
    private readonly parties: PartyDirectory,
    private readonly workflowRulesService: WorkflowRulesService,
    private readonly events: DomainEvents,
  ) {}

  async createLead(input: Valid<typeof CreateLeadBody>): Promise<LeadResponse> {
    const lead = await this.prisma.lead.create({
      data: companyApplied<Prisma.LeadUncheckedCreateInput>({
        name: input.name,
        organisationName: input.organisationName ?? null,
        email: input.email ?? null,
        phone: input.phone ?? null,
        source: input.source,
        assignedToUserId: input.assignedToUserId ?? null,
      }),
    });

    return describe(lead);
  }

  async listLeads(query: Record<string, unknown>): Promise<LeadListResponse> {
    const slice = listQuery(query, LEAD_LIST);

    const [rows, total] = await Promise.all([
      this.prisma.lead.findMany(slice.findMany<Prisma.LeadFindManyArgs>()),
      this.prisma.lead.count(slice.count<Prisma.LeadCountArgs>()),
    ]);

    return slice.respond(rows.map(describe), total);
  }

  async leadDetail(id: string): Promise<LeadResponse> {
    return describe(await this.requireLead(id));
  }

  async changeLead(
    id: string,
    input: Valid<typeof UpdateLeadBody>,
    actor?: { userId: string; name: string },
  ): Promise<LeadResponse> {
    await this.requireLead(id);

    const lead = await this.prisma.lead.update({
      where: { id },
      data: {
        ...defined('name', input.name),
        ...defined('organisationName', input.organisationName),
        ...defined('email', input.email),
        ...defined('phone', input.phone),
        ...defined('source', input.source),
        ...defined('status', input.status),
        ...defined('assignedToUserId', input.assignedToUserId),
      },
    });

    if (input.status !== undefined) {
      await this.workflowRulesService.evaluateRules({
        triggerType: 'lead.status_changed',
        leadId: lead.id,
        toStatus: lead.status,
        actor: actor ?? { userId: '00000000-0000-0000-0000-000000000000', name: 'System' },
      });
    }

    return describe(lead);
  }

  /**
   * Turns a Lead into a real customer record.
   *
   * `partyId` is always given — `PartyDirectory` is read-only, so a Party is always created
   * or found by the *frontend* first, through Parties' own endpoints. This sets `Lead.partyId`
   * and `Lead.status = 'qualified'` in the one request the spec asks for. It never creates a
   * `Party` and never writes a `PartyRole`; tagging the resulting Party `prospect` is a second,
   * separate call the frontend makes to Parties' `POST /parties/:id/roles`.
   *
   * Refused for a Lead that already holds a Party (qualifying is a one-way door, not an
   * overwrite) and for one that is currently disqualified (reopen it first, so a status that
   * looks like progress cannot also be a status recorded while nobody meant to pursue it).
   */
  async qualifyLead(
    id: string,
    input: Valid<typeof QualifyLeadBody>,
    actor?: { userId: string; name: string },
  ): Promise<LeadResponse> {
    const lead = await this.requireLead(id);

    if (lead.status === 'disqualified') throw leadNotQualifiable('It is disqualified. Reopen it first.');
    if (lead.partyId) throw leadNotQualifiable('It has already been qualified.');

    const party = await this.parties.party(input.partyId);
    if (!party) throw leadPartyNotFound();

    const qualified = await this.prisma.lead.update({
      where: { id },
      data: { partyId: input.partyId, status: 'qualified' },
    });

    await this.workflowRulesService.evaluateRules({
      triggerType: 'lead.status_changed',
      leadId: qualified.id,
      toStatus: 'qualified',
      actor: actor ?? { userId: '00000000-0000-0000-0000-000000000000', name: 'System' },
    });

    this.events.emit(CRM_EVENTS.leadQualified, {
      leadId: qualified.id,
      partyId: input.partyId,
    });

    return describe(qualified);
  }

  /**
   * Marks a Lead unreachable or uninterested, without losing it.
   *
   * The status it holds now is frozen into `priorStatus` rather than discarded, which is what
   * lets `reopen` restore the exact state disqualifying interrupted instead of guessing that
   * every Lead starts over as `new`.
   */
  async disqualifyLead(id: string, actor?: { userId: string; name: string }): Promise<LeadResponse> {
    const lead = await this.requireLead(id);
    if (lead.status === 'disqualified') throw leadAlreadyDisqualified();

    const disqualified = await this.prisma.lead.update({
      where: { id },
      data: { status: 'disqualified', priorStatus: lead.status },
    });

    await this.workflowRulesService.evaluateRules({
      triggerType: 'lead.status_changed',
      leadId: disqualified.id,
      toStatus: 'disqualified',
      actor: actor ?? { userId: '00000000-0000-0000-0000-000000000000', name: 'System' },
    });

    this.events.emit(CRM_EVENTS.leadDisqualified, {
      leadId: disqualified.id,
    });

    return describe(disqualified);
  }

  /**
   * Undoes a disqualification. Restores the status stored at the moment of disqualifying —
   * never `'new'` by default — so a Lead that was `contacted` when it was set aside comes
   * back `contacted`, not reset to the beginning of its own history.
   */
  async reopenLead(id: string, actor?: { userId: string; name: string }): Promise<LeadResponse> {
    const lead = await this.requireLead(id);
    if (lead.status !== 'disqualified') throw leadNotDisqualified();

    const reopened = await this.prisma.lead.update({
      where: { id },
      data: { status: lead.priorStatus ?? 'new', priorStatus: null },
    });

    await this.workflowRulesService.evaluateRules({
      triggerType: 'lead.status_changed',
      leadId: reopened.id,
      toStatus: reopened.status,
      actor: actor ?? { userId: '00000000-0000-0000-0000-000000000000', name: 'System' },
    });

    return describe(reopened);
  }

  private async requireLead(id: string) {
    const lead = await this.prisma.lead.findFirst({ where: { id } });
    if (!lead) throw leadNotFound();
    return lead;
  }
}

function describe(row: {
  id: string;
  name: string;
  organisationName: string | null;
  email: string | null;
  phone: string | null;
  source: string;
  status: string;
  assignedToUserId: string | null;
  partyId: string | null;
}): LeadSummary {
  return {
    id: row.id,
    name: row.name,
    organisationName: row.organisationName,
    email: row.email,
    phone: row.phone,
    // The columns are text rather than Postgres enums, so the wire type is asserted here, at
    // the one boundary where the two representations meet.
    source: row.source as LeadSource,
    status: row.status as LeadStatus,
    assignedToUserId: row.assignedToUserId,
    partyId: row.partyId,
  };
}

/**
 * The same 404 a Lead in another company gets, deliberately. Telling a caller that an
 * identifier is real but not theirs would turn the endpoint into a way of counting somebody
 * else's pipeline.
 */
function leadNotFound(): ApiException {
  return new ApiException(
    LEAD_ERROR_CODES.leadNotFound,
    'That lead does not exist.',
    HttpStatus.NOT_FOUND,
  );
}

function leadPartyNotFound(): ApiException {
  return new ApiException(
    LEAD_ERROR_CODES.leadPartyNotFound,
    'That party does not exist.',
    HttpStatus.NOT_FOUND,
  );
}

function leadNotQualifiable(reason: string): ApiException {
  return new ApiException(
    LEAD_ERROR_CODES.leadNotQualifiable,
    `This lead cannot be qualified right now. ${reason}`,
    HttpStatus.CONFLICT,
  );
}

function leadAlreadyDisqualified(): ApiException {
  return new ApiException(
    LEAD_ERROR_CODES.leadAlreadyDisqualified,
    'This lead is already disqualified.',
    HttpStatus.CONFLICT,
  );
}

function leadNotDisqualified(): ApiException {
  return new ApiException(
    LEAD_ERROR_CODES.leadNotDisqualified,
    'This lead is not disqualified, so there is nothing to reopen.',
    HttpStatus.CONFLICT,
  );
}
