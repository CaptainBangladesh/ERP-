import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { ListResponse } from '@erp/shared';
import {
  CRM_EVENTS,
  LEAD_ERROR_CODES,
  type LeadAttachmentListResponse,
  type LeadAttachmentResponse,
  type LeadCustomValues,
  type LeadListResponse,
  type LeadResponse,
  type LeadSource,
  type LeadSubmissionListResponse,
  type LeadSubmissionSummary,
  type LeadSummary,
} from '@erp/shared';
import { ApiException } from '../../http/api-exception';
import { ValidationException } from '../../http/validation-exception';
import { defined } from '../../prisma/columns';
import { DomainEvents } from '../../platform/events';
import { listQuery } from '../../platform/list';
import { StorageProvider } from '../../platform/storage';
import {
  ATTACHMENT_UPLOAD_OPTIONS,
  validateUploadedFile,
  type UploadedFile,
} from '../../platform/upload';
import { companyApplied, InjectPrisma, type ScopedPrisma } from '../../platform/tenancy';
import type { Valid } from '../../platform/validation';
import { PartyDirectory } from '../parties';
import { SYSTEM_ACTOR_ID, SYSTEM_ACTOR_NAME, auditNotes } from './audit-events';
import { LeadFieldsService } from './lead-fields.service';
import { LeadStatusLabelsService } from './lead-status-labels.service';
import { leadStatusNotSettable } from './refusals';
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
    private readonly statuses: LeadStatusLabelsService,
    private readonly leadFields: LeadFieldsService,
    private readonly storage: StorageProvider,
  ) { }

  /**
   * Refuses a status this company does not have.
   *
   * The request validator has already checked that what arrived is shaped like a status key and
   * is not one of the two the lifecycle owns. What it could not check is membership: a company
   * can add stages of its own, so the acceptable set is a table read, and a key that names no
   * status would otherwise be written straight into `Lead.status` and show up on the board as a
   * pill with no colour and no name.
   */
  private async assertSettable(status: string | undefined): Promise<void> {
    if (status === undefined) return;
    const settable = await this.statuses.settableStatuses();
    if (!settable.has(status)) throw leadStatusNotSettable();
  }

  async createLead(input: Valid<typeof CreateLeadBody>): Promise<LeadResponse> {
    const customValues = await this.leadFields.validate(input.customValues);

    const lead = await this.prisma.lead.create({
      data: companyApplied<Prisma.LeadUncheckedCreateInput>({
        name: input.name,
        organisationName: input.organisationName ?? null,
        email: input.email ?? null,
        phone: input.phone ?? null,
        sourceId: input.sourceId ?? null,
        groupId: input.groupId ?? null,
        assignedToUserId: input.assignedToUserId ?? null,
        customValues: customValues as Prisma.InputJsonValue,
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
    const existing = await this.requireLead(id);
    await this.assertSettable(input.status);

    const customValues =
      input.customValues !== undefined
        ? await this.leadFields.validate(input.customValues, existing.customValues as LeadCustomValues)
        : undefined;

    const lead = await this.prisma.lead.update({
      where: { id },
      data: {
        ...defined('name', input.name),
        ...defined('organisationName', input.organisationName),
        ...defined('email', input.email),
        ...defined('source', (input as any).source),
        ...defined('sourceId', (input as any).sourceId),
        ...defined('groupId', (input as any).groupId),
        ...defined('status', input.status),
        ...defined('assignedToUserId', input.assignedToUserId),
        ...defined('customValues', customValues as Prisma.InputJsonValue),
      },
    });

    if (input.status !== undefined) {
      if (input.status !== existing.status) {
        await this.prisma.activity.create({
          data: companyApplied<Prisma.ActivityUncheckedCreateInput>({
            type: 'note',
            notes: auditNotes.statusChanged(existing.status, input.status),
            leadId: existing.id,
            createdByUserId: actor?.userId || SYSTEM_ACTOR_ID,
            createdByName: actor?.name || SYSTEM_ACTOR_NAME,
          }),
        });
      }

      await this.workflowRulesService.evaluateRules({
        triggerType: 'lead.status_changed',
        leadId: lead.id,
        toStatus: lead.status,
        actor: actor ?? { userId: '00000000-0000-0000-0000-000000000000', name: 'System' },
      });
    }

    if (input.assignedToUserId !== undefined && input.assignedToUserId !== existing.assignedToUserId) {
      await this.prisma.activity.create({
        data: companyApplied<Prisma.ActivityUncheckedCreateInput>({
          type: 'note',
          notes: auditNotes.leadAssigned(),
          leadId: existing.id,
          createdByUserId: actor?.userId || SYSTEM_ACTOR_ID,
          createdByName: actor?.name || SYSTEM_ACTOR_NAME,
        }),
      });
    }

    return describe(lead);
  }

  /**
   * Attaches a real file to a lead.
   *
   * The bytes go to the `StorageProvider` and the row keeps the key it answered with, so the
   * attachment is a file somebody can open rather than a filename in a list. That distinction
   * is the whole of this method: the previous cut fabricated a key that pointed at nothing, and
   * every attachment it recorded was already lost by the time the list rendered it.
   */
  async addAttachment(
    leadId: string,
    file: UploadedFile,
    actor: { userId: string; name: string },
  ): Promise<LeadAttachmentResponse> {
    const lead = await this.requireLead(leadId);
    const validated = validateUploadedFile(file, ATTACHMENT_UPLOAD_OPTIONS);

    const storageKey = await this.storage.put(
      validated.originalname,
      validated.buffer,
      validated.mimetype,
    );

    const attachment = await this.prisma.leadAttachment.create({
      data: companyApplied<Prisma.LeadAttachmentUncheckedCreateInput>({
        leadId: lead.id,
        filename: validated.originalname || 'Attachment',
        mimeType: validated.mimetype || 'application/octet-stream',
        sizeBytes: validated.buffer.length,
        storageKey,
        uploadedBy: actor.name || SYSTEM_ACTOR_NAME,
      }),
    });

    await this.prisma.activity.create({
      data: companyApplied<Prisma.ActivityUncheckedCreateInput>({
        type: 'note',
        notes: auditNotes.fileAttached(attachment.filename),
        leadId: lead.id,
        createdByUserId: actor.userId,
        createdByName: actor.name || SYSTEM_ACTOR_NAME,
      }),
    });

    return describeAttachment(attachment);
  }

  async listAttachments(leadId: string): Promise<LeadAttachmentListResponse> {
    await this.requireLead(leadId);
    const rows = await this.prisma.leadAttachment.findMany({
      where: { leadId },
      orderBy: { createdAt: 'desc' },
    });
    return listed(rows.map(describeAttachment));
  }

  /**
   * The stored bytes, with what they are, for streaming back.
   *
   * The lead is required first and the attachment is found through it, so a file belonging to
   * another company's lead is a not-found like any other — the id being a uuid somebody could
   * guess is exactly why the lookup is not by attachment id alone.
   */
  async attachmentBytes(
    leadId: string,
    attachmentId: string,
  ): Promise<{ filename: string; mimeType: string; bytes: Buffer }> {
    const attachment = await this.requireAttachment(leadId, attachmentId);
    const bytes = await this.storage.get(attachment.storageKey);
    if (!bytes) throw attachmentBytesMissing();
    return { filename: attachment.filename, mimeType: attachment.mimeType, bytes };
  }

  /** Removes the row *and* the stored object; an orphaned object is a file nobody can reach. */
  async removeAttachment(leadId: string, attachmentId: string): Promise<void> {
    const attachment = await this.requireAttachment(leadId, attachmentId);
    await this.prisma.leadAttachment.delete({ where: { id: attachment.id } });
    await this.storage.remove(attachment.storageKey);
  }

  private async requireAttachment(leadId: string, attachmentId: string) {
    await this.requireLead(leadId);
    const attachment = await this.prisma.leadAttachment.findFirst({
      where: { id: attachmentId, leadId },
    });
    if (!attachment) throw attachmentNotFound();
    return attachment;
  }

  /**
   * Every capture-form response this lead has sent, newest first.
   *
   * A lead accumulates submissions rather than being overwritten by the latest one, so this is
   * a list and not a field — the Survey tab reads it to show what the lead actually answered,
   * including the answers no field maps.
   */
  async listSubmissions(leadId: string): Promise<LeadSubmissionListResponse> {
    await this.requireLead(leadId);
    const rows = await this.prisma.leadSubmission.findMany({
      where: { leadId },
      orderBy: { submittedAt: 'desc' },
    });
    return listed(rows.map(describeSubmission));
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

  async deleteLead(id: string): Promise<void> {
    const lead = await this.requireLead(id);
    await this.prisma.lead.delete({ where: { id: lead.id } });
  }

  async cleanDuplicates(): Promise<{ removedCount: number }> {
    const allLeads = await this.prisma.lead.findMany({
      orderBy: { createdAt: 'asc' },
    });

    const seen = new Map<string, string>();
    const idsToDelete: string[] = [];

    for (const lead of allLeads) {
      const nameKey = lead.name.trim().toLowerCase();
      const emailKey = lead.email ? lead.email.trim().toLowerCase() : '';
      const phoneKey = lead.phone ? lead.phone.replace(/\D/g, '') : '';
      
      const key = nameKey || (emailKey ? `email:${emailKey}` : (phoneKey ? `phone:${phoneKey}` : lead.id));

      if (seen.has(key)) {
        idsToDelete.push(lead.id);
      } else {
        seen.set(key, lead.id);
      }
    }

    if (idsToDelete.length > 0) {
      await this.prisma.lead.deleteMany({
        where: { id: { in: idsToDelete } },
      });
    }

    return { removedCount: idsToDelete.length };
  }
}

function describe(row: any): LeadSummary {
  return {
    id: row.id,
    name: row.name,
    organisationName: row.organisationName,
    email: row.email,
    phone: row.phone,
    source: (row.source || 'inbound') as LeadSource,
    sourceId: row.sourceId ?? null,
    sourceName: row.sourceRelation?.name || row.sourceName || null,
    status: row.status,
    assignedToUserId: row.assignedToUserId,
    partyId: row.partyId,
    groupId: row.groupId ?? null,
    groupName: row.group?.name || null,
    customValues: (row.customValues as LeadCustomValues) || {},
  };
}

function describeAttachment(row: {
  id: string;
  leadId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  uploadedBy: string;
  createdAt: Date;
}): LeadAttachmentResponse {
  return {
    id: row.id,
    leadId: row.leadId,
    filename: row.filename,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    uploadedBy: row.uploadedBy,
    createdAt: row.createdAt.toISOString(),
  };
}

function describeSubmission(row: {
  id: string;
  leadId: string;
  captureSourceId: string | null;
  formName: string;
  rawPayload: unknown;
  mappedFields: unknown;
  submittedAt: Date;
}): LeadSubmissionSummary {
  return {
    id: row.id,
    leadId: row.leadId,
    captureSourceId: row.captureSourceId,
    formName: row.formName,
    rawPayload: (row.rawPayload as Record<string, unknown>) ?? {},
    mappedFields: (row.mappedFields as Record<string, string>) ?? {},
    submittedAt: row.submittedAt.toISOString(),
  };
}

/**
 * A lead's own artifacts, in the envelope every list endpoint answers with.
 *
 * Unpaged on purpose: these belong to one lead and are read all at once by a tab that shows
 * them all. The envelope is still the standard one, so a caller reads them the same way it
 * reads every other list and paging can be added later without changing the shape.
 */
function listed<T>(items: T[]): ListResponse<T> {
  return {
    items,
    page: { number: 1, size: items.length, total: items.length, pages: items.length > 0 ? 1 : 0 },
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

/** An attachment id that names nothing on this lead — including one on another company's lead. */
function attachmentNotFound(): ApiException {
  return new ApiException(
    LEAD_ERROR_CODES.leadAttachmentNotFound,
    'That attachment does not exist.',
    HttpStatus.NOT_FOUND,
  );
}

/**
 * The row is there and the bytes are not. Distinct from a missing attachment because the two
 * call for different things: this one is a store that lost an object, and saying so is what
 * stops it being read as "the user deleted it".
 */
function attachmentBytesMissing(): ApiException {
  return new ApiException(
    LEAD_ERROR_CODES.leadAttachmentBytesMissing,
    'That file is recorded but its contents could not be found in storage.',
    HttpStatus.NOT_FOUND,
  );
}
