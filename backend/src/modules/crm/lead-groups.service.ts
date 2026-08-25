import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  type LeadGroupListResponse,
  type LeadGroupResponse,
  type LeadGroupSummary,
} from '@erp/shared';
import { defined } from '../../prisma/columns';
import { companyApplied, InjectPrisma, type ScopedPrisma } from '../../platform/tenancy';
import type { Valid } from '../../platform/validation';
import { leadGroupHasLeads, leadGroupNotFound } from './refusals';
import { CreateLeadGroupBody, UpdateLeadGroupBody } from './schemas';
import { reposition } from './reposition';

/**
 * A company's own swimlanes on the Leads board.
 *
 * No seed data, and — the part worth stating, because an earlier cut did the opposite — nothing
 * is provisioned on read. Listing an empty board returns an empty list, not a "New Leads" group
 * conjured into existence by somebody looking at the screen: a read that writes is a read that
 * gives two companies different data depending on who opened the page first, and this platform's
 * empty states are the screen's job rather than the database's.
 *
 * The same two disciplines `StagesService` holds apply here for the same reasons: `order` is
 * renumbered across the company on every move rather than written as given, and a group Leads
 * still sit in is refused deletion.
 */
@Injectable()
export class LeadGroupsService {
  constructor(@InjectPrisma() private readonly prisma: ScopedPrisma) {}

  /** Always appended after every existing group — a client cannot collide with a position it cannot see. */
  async createLeadGroup(input: Valid<typeof CreateLeadGroupBody>): Promise<LeadGroupResponse> {
    const highest = await this.prisma.leadGroup.findFirst({
      orderBy: { order: 'desc' },
      select: { order: true },
    });

    const group = await this.prisma.leadGroup.create({
      data: companyApplied<Prisma.LeadGroupUncheckedCreateInput>({
        name: input.name,
        color: input.color ?? DEFAULT_GROUP_COLOR,
        order: (highest?.order ?? 0) + 1,
      }),
    });

    return describe(group, 0);
  }

  /**
   * Every group in board order, each carrying how many Leads it holds — story 37's "the shape of
   * the board is legible before I read a single row". Unpaged, like the Stage list it mirrors: a
   * company's swimlanes are a handful of rows and the board draws all of them at once.
   */
  async listLeadGroups(): Promise<LeadGroupListResponse> {
    const [groups, counts] = await Promise.all([
      this.prisma.leadGroup.findMany({ orderBy: { order: 'asc' } }),
      this.prisma.lead.groupBy({ by: ['groupId'], _count: { _all: true } }),
    ]);

    const held = new Map(counts.map((row) => [row.groupId, row._count._all]));
    const items = groups.map((group) => describe(group, held.get(group.id) ?? 0));

    return {
      items,
      page: { number: 1, size: Math.max(items.length, 1), total: items.length, pages: 1 },
    };
  }

  async getLeadGroup(id: string): Promise<LeadGroupResponse> {
    const group = await this.requireLeadGroup(id);
    return describe(group, await this.leadsIn(id));
  }

  /**
   * Renames, recolours, or moves a group — any combination in one request. A move goes through
   * `reposition`, which renumbers the whole company inside a transaction so the board never
   * shows a gap or a repeat, not even to a reader mid-write.
   */
  async updateLeadGroup(
    id: string,
    input: Valid<typeof UpdateLeadGroupBody>,
  ): Promise<LeadGroupResponse> {
    const existing = await this.requireLeadGroup(id);

    const fields = {
      ...defined('name', input.name),
      ...defined('color', input.color),
    };

    const updated =
      input.order === undefined
        ? await this.prisma.leadGroup.update({ where: { id }, data: fields })
        : await reposition(
            this.prisma,
            (client) => client.leadGroup,
            id,
            existing.order,
            input.order,
            fields,
          );

    return describe(updated, await this.leadsIn(id));
  }

  /** Refused while Leads still sit here, so a Lead can never point at a group that is gone. */
  async deleteLeadGroup(id: string): Promise<void> {
    await this.requireLeadGroup(id);

    const occupied = await this.leadsIn(id);
    if (occupied > 0) throw leadGroupHasLeads(occupied);

    await this.prisma.leadGroup.delete({ where: { id } });
  }

  private async leadsIn(groupId: string): Promise<number> {
    return this.prisma.lead.count({ where: { groupId } });
  }

  /**
   * Resolves a `groupId` a Lead write named, within this company. Shared with `LeadsService`
   * rather than left to the foreign key, because the key only asks whether the group exists at
   * all: the tenancy extension scopes the rows a query *reads*, and cannot see that a value
   * being written points at another company's row. Without this, filing a lead into a
   * neighbour's group would succeed and put their group's name on your board.
   */
  async requireLeadGroup(id: string) {
    const group = await this.prisma.leadGroup.findFirst({ where: { id } });
    if (!group) throw leadGroupNotFound();
    return group;
  }
}

const DEFAULT_GROUP_COLOR = '#579bfc';

function describe(
  group: { id: string; name: string; color: string; order: number },
  leadCount: number,
): LeadGroupSummary {
  return {
    id: group.id,
    name: group.name,
    color: group.color,
    order: group.order,
    leadCount,
  };
}
