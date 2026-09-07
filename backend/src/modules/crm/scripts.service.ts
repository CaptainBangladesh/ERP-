import { HttpStatus, Injectable } from '@nestjs/common';
import {
  SCRIPT_ERROR_CODES,
  type CreateScriptRequest,
  type LeadResponse,
  type ResolvedScript,
  type ScriptCategory,
  type ScriptSummary,
  type UpdateScriptRequest,
} from '@erp/shared';
import { ApiException } from '../../http/api-exception';
import { companyApplied, InjectPrisma, type ScopedPrisma } from '../../platform/tenancy';
import { LeadFieldsService } from './lead-fields.service';
import { LeadsService } from './leads.service';
import { resolveTemplate, validateTemplateTags } from './template-tag-resolver';

/**
 * The company's spoken scripts: the words a rep says opening a call, in discovery, handling an
 * objection, or closing — distinct from `EmailTemplate`, which is content for *sending*. A
 * script carries the same `{{lead.*}}`/`{{custom.*}}` merge-tags, validated and resolved by the
 * one `template-tag-resolver` the email side uses — there is no second merge mechanism.
 *
 * Authoring is manager-gated (`crm:playbooks:write`, enforced on the controller); reading and
 * resolving scripts against a lead is what any rep working a lead does, so those ride on
 * `crm:leads:read`.
 */
@Injectable()
export class ScriptsService {
  constructor(
    @InjectPrisma() private readonly prisma: ScopedPrisma,
    private readonly leadFieldsService: LeadFieldsService,
    private readonly leadsService: LeadsService,
  ) {}

  async create(body: CreateScriptRequest, actor: { userId: string }): Promise<ScriptSummary> {
    await this.validateTags(body.body);

    const created = await this.prisma.script.create({
      data: companyApplied({
        title: body.title.trim(),
        body: body.body.trim(),
        category: body.category,
        leadStatus: normaliseStatus(body.leadStatus),
        createdByUserId: actor.userId,
      }),
    });

    return describeScript(created);
  }

  async list(): Promise<ScriptSummary[]> {
    const rows = await this.prisma.script.findMany({
      orderBy: [{ category: 'asc' }, { title: 'asc' }],
    });
    return rows.map((r: ScriptRow) => describeScript(r));
  }

  async get(id: string): Promise<ScriptSummary> {
    const row = await this.prisma.script.findUnique({ where: { id } });
    if (!row) throw scriptNotFound();
    return describeScript(row);
  }

  async update(id: string, patch: UpdateScriptRequest): Promise<ScriptSummary> {
    const existing = await this.prisma.script.findUnique({ where: { id } });
    if (!existing) throw scriptNotFound();

    if (patch.body !== undefined) await this.validateTags(patch.body);

    const updated = await this.prisma.script.update({
      where: { id },
      data: {
        ...(patch.title !== undefined ? { title: patch.title.trim() } : {}),
        ...(patch.body !== undefined ? { body: patch.body.trim() } : {}),
        ...(patch.category !== undefined ? { category: patch.category } : {}),
        ...(patch.leadStatus !== undefined ? { leadStatus: normaliseStatus(patch.leadStatus) } : {}),
      },
    });

    return describeScript(updated);
  }

  async delete(id: string): Promise<{ success: boolean }> {
    const existing = await this.prisma.script.findUnique({ where: { id } });
    if (!existing) throw scriptNotFound();

    // A step that pointed here keeps its instruction and loses only its words: the FK is
    // `onDelete: SetNull`, so nothing has to be un-wired before a script can be removed.
    await this.prisma.script.delete({ where: { id } });
    return { success: true };
  }

  /**
   * Every script relevant to a lead, resolved against its data — the workspace panel's read.
   *
   * Relevant means keyed to the lead's current `status`, or keyed to no status at all (a general
   * script shows everywhere). Ordered category then title, the same order the list uses, so the
   * panel reads the way the authoring page does.
   */
  async resolveForLead(leadId: string): Promise<ResolvedScript[]> {
    const lead = await this.leadsService.leadDetail(leadId);
    return this.resolveScriptsFor(lead);
  }

  /** The same, given a lead already loaded — so the guidance read fetches the lead once. */
  async resolveScriptsFor(lead: LeadResponse): Promise<ResolvedScript[]> {
    const rows = await this.prisma.script.findMany({
      where: { OR: [{ leadStatus: lead.status }, { leadStatus: null }] },
      orderBy: [{ category: 'asc' }, { title: 'asc' }],
    });
    return rows.map((r: ScriptRow) => resolveAgainstLead(r, lead));
  }

  /**
   * The best script for a lead in one of these categories, resolved — or null if none fits.
   * Prefers a script keyed to the lead's own status over a general one, then the category order
   * given, then title. This is what a status-based next-best-action reaches for.
   */
  async pickForLead(lead: LeadResponse, categories: ScriptCategory[]): Promise<ResolvedScript | null> {
    const rows = await this.prisma.script.findMany({
      where: { category: { in: categories }, OR: [{ leadStatus: lead.status }, { leadStatus: null }] },
    });
    if (rows.length === 0) return null;

    const ranked = [...rows].sort((a: ScriptRow, b: ScriptRow) => {
      const statusRank = (r: ScriptRow) => (r.leadStatus === lead.status ? 0 : 1);
      if (statusRank(a) !== statusRank(b)) return statusRank(a) - statusRank(b);
      const catRank = (r: ScriptRow) => categories.indexOf(r.category as ScriptCategory);
      if (catRank(a) !== catRank(b)) return catRank(a) - catRank(b);
      return a.title.localeCompare(b.title);
    });

    return resolveAgainstLead(ranked[0]!, lead);
  }

  /** One script resolved against a lead, or null if it no longer exists — for a playbook step's script. */
  async resolveOneForLead(scriptId: string, lead: LeadResponse): Promise<ResolvedScript | null> {
    const row = await this.prisma.script.findUnique({ where: { id: scriptId } });
    return row ? resolveAgainstLead(row, lead) : null;
  }

  /** Whether a script exists in this company — the check a playbook step's `scriptId` needs. */
  async exists(scriptId: string): Promise<boolean> {
    const row = await this.prisma.script.findUnique({ where: { id: scriptId }, select: { id: true } });
    return row !== null;
  }

  private async validateTags(body: string): Promise<void> {
    const fieldsRes = await this.leadFieldsService.listLeadFields();
    const activeCustomKeys = new Set<string>(
      fieldsRes.items.filter((d) => !d.archivedAt).map((d) => d.key),
    );
    validateTemplateTags(body, activeCustomKeys);
  }
}

interface ScriptRow {
  id: string;
  title: string;
  body: string;
  category: string;
  leadStatus: string | null;
  createdByUserId: string;
  createdAt: Date;
  updatedAt: Date;
}

/** A merge context of the lead's own data — the same fields email preview merges, minus the sender. */
function resolveAgainstLead(row: ScriptRow, lead: LeadResponse): ResolvedScript {
  const resolvedBody = resolveTemplate(row.body, {
    lead: {
      name: lead.name,
      email: lead.email,
      organisationName: lead.organisationName,
      phone: lead.phone,
      status: lead.status,
    },
    custom: lead.customValues || {},
  });

  return {
    id: row.id,
    title: row.title,
    category: row.category as ScriptCategory,
    leadStatus: row.leadStatus,
    body: row.body,
    resolvedBody,
  };
}

export function describeScript(row: ScriptRow): ScriptSummary {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    category: row.category as ScriptCategory,
    leadStatus: row.leadStatus,
    createdByUserId: row.createdByUserId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Blank or absent means "any status", stored as null. */
function normaliseStatus(status: string | null | undefined): string | null {
  if (status === undefined || status === null) return null;
  const trimmed = status.trim();
  return trimmed.length === 0 ? null : trimmed;
}

export function scriptNotFound(): ApiException {
  return new ApiException(
    SCRIPT_ERROR_CODES.scriptNotFound,
    'That script does not exist.',
    HttpStatus.NOT_FOUND,
  );
}
