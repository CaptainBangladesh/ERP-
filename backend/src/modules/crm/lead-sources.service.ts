import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  type LeadSourceListResponse,
  type LeadSourceResponse,
  type LeadSourceSummary,
} from '@erp/shared';
import { defined } from '../../prisma/columns';
import { companyApplied, InjectPrisma, type ScopedPrisma } from '../../platform/tenancy';
import type { Valid } from '../../platform/validation';
import { leadSourceHasLeads, leadSourceNotFound } from './refusals';
import { reposition } from './reposition';
import { CreateLeadSourceBody, UpdateLeadSourceBody } from './schemas';

/**
 * A company's own vocabulary for where a Lead came from.
 *
 * This module shipped with five fixed strings — `referral`, `inbound`, `outbound`, `event`,
 * `other` — which made "which channel is actually producing customers" answerable only in
 * somebody else's words. These are rows instead, one set per company, seeded by nothing: a fresh
 * company owns no sources, and `Lead.sourceId` is nullable so the first lead can still be typed
 * in before anybody has decided what the channels are called.
 *
 * Renaming is never refused. The id is what a Lead points at, so fixing a label is a one-row
 * write rather than a data migration — which is the whole reason `Lead.source` stopped being the
 * string it used to be.
 */
@Injectable()
export class LeadSourcesService {
  constructor(@InjectPrisma() private readonly prisma: ScopedPrisma) {}

  async createLeadSource(input: Valid<typeof CreateLeadSourceBody>): Promise<LeadSourceResponse> {
    const highest = await this.prisma.leadSource.findFirst({
      orderBy: { order: 'desc' },
      select: { order: true },
    });

    const source = await this.prisma.leadSource.create({
      data: companyApplied<Prisma.LeadSourceUncheckedCreateInput>({
        name: input.name,
        order: (highest?.order ?? 0) + 1,
      }),
    });

    return describe(source, 0);
  }

  /**
   * Every source in the company's own order, each carrying how many Leads name it — the number
   * a manager needs to see before deciding whether a source is worth keeping.
   */
  async listLeadSources(): Promise<LeadSourceListResponse> {
    const [sources, counts] = await Promise.all([
      this.prisma.leadSource.findMany({ orderBy: { order: 'asc' } }),
      this.prisma.lead.groupBy({ by: ['sourceId'], _count: { _all: true } }),
    ]);

    const attributed = new Map(counts.map((row) => [row.sourceId, row._count._all]));
    const items = sources.map((source) => describe(source, attributed.get(source.id) ?? 0));

    return {
      items,
      page: { number: 1, size: Math.max(items.length, 1), total: items.length, pages: 1 },
    };
  }

  async getLeadSource(id: string): Promise<LeadSourceResponse> {
    const source = await this.requireLeadSource(id);
    return describe(source, await this.leadsFrom(id));
  }

  async updateLeadSource(
    id: string,
    input: Valid<typeof UpdateLeadSourceBody>,
  ): Promise<LeadSourceResponse> {
    const existing = await this.requireLeadSource(id);

    const fields = defined('name', input.name);

    const updated =
      input.order === undefined
        ? await this.prisma.leadSource.update({ where: { id }, data: fields })
        : await reposition(
            this.prisma,
            (client) => client.leadSource,
            id,
            existing.order,
            input.order,
            fields,
          );

    return describe(updated, await this.leadsFrom(id));
  }

  /**
   * Refused while Leads still name this source. The refusal says to rename instead, because
   * renaming is almost always what somebody deleting a source actually wants and costs nothing.
   */
  async deleteLeadSource(id: string): Promise<void> {
    await this.requireLeadSource(id);

    const attributed = await this.leadsFrom(id);
    if (attributed > 0) throw leadSourceHasLeads(attributed);

    await this.prisma.leadSource.delete({ where: { id } });
  }

  /**
   * Resolves a `sourceId` a Lead write named, within this company. Shared with `LeadsService`
   * rather than duplicated there, so a source belonging to another company reads as "does not
   * exist" from every path that can name one.
   */
  async requireLeadSource(id: string) {
    const source = await this.prisma.leadSource.findFirst({ where: { id } });
    if (!source) throw leadSourceNotFound();
    return source;
  }

  private async leadsFrom(sourceId: string): Promise<number> {
    return this.prisma.lead.count({ where: { sourceId } });
  }
}

function describe(
  source: { id: string; name: string; order: number },
  leadCount: number,
): LeadSourceSummary {
  return { id: source.id, name: source.name, order: source.order, leadCount };
}
