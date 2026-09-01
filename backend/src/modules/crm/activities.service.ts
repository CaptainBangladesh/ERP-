import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  ACTIVITY_ERROR_CODES,
  type ActivityListResponse,
  type ActivityResponse,
  type ActivitySummary,
  type ActivityType,
} from '@erp/shared';
import { ApiException } from '../../http/api-exception';
import { companyApplied, InjectPrisma, type ScopedPrisma } from '../../platform/tenancy';
import type { Valid } from '../../platform/validation';
import { PartyDirectory } from '../parties';
import type { CreateActivityBody } from './schemas';

@Injectable()
export class ActivitiesService {
  constructor(
    @InjectPrisma() private readonly prisma: ScopedPrisma,
    private readonly parties: PartyDirectory,
  ) {}

  async logActivity(
    actor: { userId: string; name: string },
    input: Valid<typeof CreateActivityBody>,
  ): Promise<ActivityResponse> {
    if (input.leadId) {
      const lead = await this.prisma.lead.findFirst({ where: { id: input.leadId } });
      if (!lead) throw activityParentNotFound();
    } else if (input.dealId) {
      const deal = await this.prisma.deal.findFirst({ where: { id: input.dealId } });
      if (!deal) throw activityParentNotFound();
    } else if (input.partyId) {
      const party = await this.parties.party(input.partyId);
      if (!party) throw activityParentNotFound();
    }

    const activity = await this.prisma.activity.create({
      data: companyApplied<Prisma.ActivityUncheckedCreateInput>({
        type: input.type,
        notes: input.notes,
        occurredAt: input.occurredAt ? new Date(input.occurredAt) : new Date(),
        dueAt: input.type === 'task' && input.dueAt ? new Date(input.dueAt) : null,
        createdByUserId: actor.userId,
        createdByName: actor.name,
        leadId: input.leadId ?? null,
        dealId: input.dealId ?? null,
        partyId: input.partyId ?? null,
      }),
    });

    return describe(activity);
  }

  async listLeadActivities(leadId: string): Promise<ActivityListResponse> {
    const lead = await this.prisma.lead.findFirst({ where: { id: leadId } });
    if (!lead) throw activityParentNotFound();

    const items = await this.prisma.activity.findMany({
      where: { leadId },
      orderBy: { occurredAt: 'desc' },
    });

    return { items: items.map(describe) };
  }

  async listDealActivities(dealId: string): Promise<ActivityListResponse> {
    const deal = await this.prisma.deal.findFirst({ where: { id: dealId } });
    if (!deal) throw activityParentNotFound();

    const items = await this.prisma.activity.findMany({
      where: { dealId },
      orderBy: { occurredAt: 'desc' },
    });

    return { items: items.map(describe) };
  }

  async listPartyActivities(partyId: string): Promise<ActivityListResponse> {
    const party = await this.parties.party(partyId);
    if (!party) throw activityParentNotFound();

    const items = await this.prisma.activity.findMany({
      where: { partyId },
      orderBy: { occurredAt: 'desc' },
    });

    return { items: items.map(describe) };
  }

  async completeTask(id: string): Promise<ActivityResponse> {
    const activity = await this.prisma.activity.findFirst({ where: { id } });
    if (!activity) throw activityNotFound();
    if (activity.type !== 'task') throw activityNotTask();

    const updated = await this.prisma.activity.update({
      where: { id },
      data: { completedAt: new Date() },
    });

    return describe(updated);
  }

  /**
   * Moves a task's due date forward, from whichever is later: when it was due, or now.
   *
   * Taking the later of the two is what stops a task that went overdue three weeks ago from
   * snoozing to a date still in the past — one click would have to be twenty-two, and the rail
   * would keep showing it as due. A task with no due date acquires one.
   */
  async snoozeTask(id: string, days: number): Promise<ActivityResponse> {
    const activity = await this.prisma.activity.findFirst({ where: { id } });
    if (!activity) throw activityNotFound();
    if (activity.type !== 'task') throw activityNotTask();

    const now = new Date();
    const from = activity.dueAt && activity.dueAt > now ? activity.dueAt : now;
    const dueAt = new Date(from.getTime() + days * 24 * 60 * 60 * 1000);

    const updated = await this.prisma.activity.update({
      where: { id },
      data: { dueAt },
    });

    return describe(updated);
  }

  async reopenTask(id: string): Promise<ActivityResponse> {
    const activity = await this.prisma.activity.findFirst({ where: { id } });
    if (!activity) throw activityNotFound();
    if (activity.type !== 'task') throw activityNotTask();

    const updated = await this.prisma.activity.update({
      where: { id },
      data: { completedAt: null },
    });

    return describe(updated);
  }
}

function describe(row: {
  id: string;
  type: string;
  notes: string;
  occurredAt: Date;
  dueAt: Date | null;
  completedAt: Date | null;
  createdByUserId: string;
  createdByName: string;
  leadId: string | null;
  dealId: string | null;
  partyId: string | null;
  createdAt: Date;
}): ActivitySummary {
  return {
    id: row.id,
    type: row.type as ActivityType,
    notes: row.notes,
    occurredAt: row.occurredAt.toISOString(),
    dueAt: row.dueAt ? row.dueAt.toISOString() : null,
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    createdByUserId: row.createdByUserId,
    createdByName: row.createdByName,
    leadId: row.leadId,
    dealId: row.dealId,
    partyId: row.partyId,
    createdAt: row.createdAt.toISOString(),
  };
}

function activityNotFound(): ApiException {
  return new ApiException(
    ACTIVITY_ERROR_CODES.activityNotFound,
    'That activity does not exist.',
    HttpStatus.NOT_FOUND,
  );
}

function activityParentNotFound(): ApiException {
  return new ApiException(
    ACTIVITY_ERROR_CODES.activityParentNotFound,
    'That parent record does not exist.',
    HttpStatus.NOT_FOUND,
  );
}

function activityNotTask(): ApiException {
  return new ApiException(
    ACTIVITY_ERROR_CODES.activityNotTask,
    'This activity is not a task.',
    HttpStatus.CONFLICT,
  );
}
