import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  ACTIVITY_ERROR_CODES,
  type ActivityFeedItem,
  type ActivityFeedResponse,
  type ActivityListResponse,
  type ActivityResponse,
  type ActivitySummary,
  type ActivityType,
} from '@erp/shared';
import { ApiException } from '../../http/api-exception';
import { listQuery } from '../../platform/list';
import { companyApplied, InjectPrisma, type ScopedPrisma } from '../../platform/tenancy';
import type { Valid } from '../../platform/validation';
import { PartyDirectory } from '../parties';
import { SYSTEM_ACTOR_ID, SYSTEM_ACTOR_NAME, auditNotes } from './audit-events';
import {
  ACTIVITY_LIST,
  type AssignTaskBody,
  type CreateActivityBody,
  type UpdateActivityBody,
} from './schemas';

/**
 * Who is acting, with what they are allowed to do. `permissions` is carried so the service can
 * answer the one question a `@RequirePermission` decorator cannot: assigning a task to *myself*
 * is every rep's right, but handing it to a colleague is a manager's — a distinction about the
 * request's data, not the endpoint, so it lives here rather than on the route.
 */
export interface ActivityActor {
  userId: string;
  name: string;
  /**
   * What the caller may do, for the cross-user assignment gate. Optional so the system paths that
   * log activities — a campaign send, an outreach email, a workflow `create_task` — need not
   * synthesise a permission set; each of them only ever assigns a task to the actor itself (or
   * logs a non-task, which has no assignee at all), so absent is read as no manage rights and the
   * gate stays closed. A real user request always carries the session's permissions.
   */
  permissions?: 'all' | readonly string[];
}

function canManageTeam(actor: ActivityActor): boolean {
  return actor.permissions === 'all' || (actor.permissions?.includes('crm:team:manage') ?? false);
}

@Injectable()
export class ActivitiesService {
  constructor(
    @InjectPrisma() private readonly prisma: ScopedPrisma,
    private readonly parties: PartyDirectory,
  ) {}

  async logActivity(
    actor: ActivityActor,
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

    // Only a task carries an owner; a call or note records what happened rather than work owed.
    // A task defaults to its creator, so nobody logs a task into the void — and assigning it to
    // a *colleague* at creation is the same manager's act reassignment is, gated the same way.
    let assignedToUserId: string | null = null;
    if (input.type === 'task') {
      const requested = input.assignedToUserId ?? actor.userId;
      if (requested !== actor.userId && !canManageTeam(actor)) throw activityAssignForbidden();
      assignedToUserId = requested;
    }

    const activity = await this.prisma.activity.create({
      data: companyApplied<Prisma.ActivityUncheckedCreateInput>({
        type: input.type,
        notes: input.notes,
        occurredAt: input.occurredAt ? new Date(input.occurredAt) : new Date(),
        dueAt: input.type === 'task' && input.dueAt ? new Date(input.dueAt) : null,
        assignedToUserId,
        createdByUserId: actor.userId,
        createdByName: actor.name,
        leadId: input.leadId ?? null,
        dealId: input.dealId ?? null,
        partyId: input.partyId ?? null,
      }),
    });

    return describe(activity);
  }

  /**
   * Reassign a task, or take it back, or set it down. The one write path for `assignedToUserId`
   * after creation.
   *
   * The gate is about *who* the task ends up with, not the endpoint: taking a task onto yourself
   * (or clearing your own) is every rep's right, but handing your work to a colleague — or moving
   * a colleague's task at all — is a manager's, so it needs `crm:team:manage`. A change of owner
   * is recorded on the parent's timeline the same way a lead reassignment is, so the history reads
   * as intent rather than a silent column edit.
   */
  async assignTask(
    id: string,
    input: Valid<typeof AssignTaskBody>,
    actor: ActivityActor,
  ): Promise<ActivityResponse> {
    const activity = await this.prisma.activity.findFirst({ where: { id } });
    if (!activity) throw activityNotFound();
    if (activity.type !== 'task') throw activityNotTask();

    const next = input.assignedToUserId ?? null;

    // Self-service is: putting it on yourself, or clearing/leaving a task that is already yours
    // (or nobody's). Anything touching a colleague's ownership is a manager's act.
    const selfOnly =
      next === null
        ? activity.assignedToUserId === actor.userId || activity.assignedToUserId === null
        : next === actor.userId;
    if (!selfOnly && !canManageTeam(actor)) throw activityAssignForbidden();

    if (next === activity.assignedToUserId) return describe(activity);

    const updated = await this.prisma.activity.update({
      where: { id },
      data: { assignedToUserId: next },
    });

    // Audit on the same parent the task hangs off, so the reassignment shows in that record's
    // timeline. A task without a parent (there is always exactly one) has nowhere to note it.
    await this.prisma.activity.create({
      data: companyApplied<Prisma.ActivityUncheckedCreateInput>({
        type: 'note',
        notes: auditNotes.taskAssigned(),
        createdByUserId: actor.userId || SYSTEM_ACTOR_ID,
        createdByName: actor.name || SYSTEM_ACTOR_NAME,
        leadId: updated.leadId,
        dealId: updated.dealId,
        partyId: updated.partyId,
      }),
    });

    return describe(updated);
  }

  /**
   * The company-wide feed: recent activity across every lead, deal and party at once.
   *
   * One page of it, through the platform's own list machinery — the same paging, ceiling and
   * total-order tiebreak every list endpoint gets, rather than a hand-rolled `take`. The Activities
   * screen and the Workspace home both want "what has happened lately", not the whole history
   * since sign-up, and `-occurredAt` gives them the top of it.
   *
   * Parent names are resolved in three bulk reads, one per parent kind, rather than one lookup
   * per row — the N+1 the per-parent endpoints avoid by only ever answering about one record.
   * The scoped Prisma client keeps every read inside the asking company, so a lead or deal from
   * another tenant cannot lend its name to a row here even if an id somehow collided.
   */
  async listCompanyActivities(query: Record<string, unknown>): Promise<ActivityFeedResponse> {
    const slice = listQuery(query, ACTIVITY_LIST);

    const [rows, total] = await Promise.all([
      this.prisma.activity.findMany(slice.findMany<Prisma.ActivityFindManyArgs>()),
      this.prisma.activity.count(slice.count<Prisma.ActivityCountArgs>()),
    ]);

    const idsOf = (pick: (row: (typeof rows)[number]) => string | null): string[] => [
      ...new Set(rows.map(pick).filter((id): id is string => id !== null)),
    ];

    const leadIds = idsOf((row) => row.leadId);
    const dealIds = idsOf((row) => row.dealId);
    const partyIds = idsOf((row) => row.partyId);

    const [leads, deals, parties] = await Promise.all([
      leadIds.length
        ? this.prisma.lead.findMany({ where: { id: { in: leadIds } }, select: { id: true, name: true } })
        : Promise.resolve([]),
      dealIds.length
        ? this.prisma.deal.findMany({ where: { id: { in: dealIds } }, select: { id: true, name: true } })
        : Promise.resolve([]),
      partyIds.length ? this.parties.parties(partyIds) : Promise.resolve([]),
    ]);

    const leadNames = new Map(leads.map((lead) => [lead.id, lead.name]));
    const dealNames = new Map(deals.map((deal) => [deal.id, deal.name]));
    const partyNames = new Map(parties.map((party) => [party.id, party.name]));

    const items: ActivityFeedItem[] = rows.map((row) => {
      const base = describe(row);
      if (row.leadId) {
        return { ...base, parentKind: 'lead', parentName: leadNames.get(row.leadId) ?? null };
      }
      if (row.dealId) {
        return { ...base, parentKind: 'deal', parentName: dealNames.get(row.dealId) ?? null };
      }
      if (row.partyId) {
        return { ...base, parentKind: 'party', parentName: partyNames.get(row.partyId) ?? null };
      }
      return { ...base, parentKind: null, parentName: null };
    });

    return slice.respond(items, total);
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

  async updateActivity(
    id: string,
    input: Valid<typeof UpdateActivityBody>,
  ): Promise<ActivityResponse> {
    const activity = await this.prisma.activity.findFirst({ where: { id } });
    if (!activity) throw activityNotFound();

    const data: Prisma.ActivityUpdateInput = {};
    if (input.type !== undefined) data.type = input.type;
    if (input.notes !== undefined) data.notes = input.notes;
    if (input.occurredAt !== undefined) data.occurredAt = new Date(input.occurredAt);
    if (input.dueAt !== undefined) {
      data.dueAt = input.dueAt === null ? null : new Date(input.dueAt);
    }

    const updated = await this.prisma.activity.update({
      where: { id },
      data,
    });

    return describe(updated);
  }

  async deleteActivity(id: string): Promise<void> {
    const activity = await this.prisma.activity.findFirst({ where: { id } });
    if (!activity) throw activityNotFound();

    await this.prisma.activity.delete({
      where: { id },
    });
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
  assignedToUserId: string | null;
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
    assignedToUserId: row.assignedToUserId,
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

function activityAssignForbidden(): ApiException {
  return new ApiException(
    ACTIVITY_ERROR_CODES.activityAssignForbidden,
    'You can assign a task to yourself, but assigning it to a colleague needs the team-manage permission.',
    HttpStatus.FORBIDDEN,
  );
}
