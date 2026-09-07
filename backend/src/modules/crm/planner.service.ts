import { Injectable } from '@nestjs/common';
import type {
  ApproachPlanResponse,
  PlannerNoteResponse,
  SaveApproachPlanRequest,
  SavePlannerNoteRequest,
  SaveTeamPlanRequest,
  TeamPlanResponse,
} from '@erp/shared';
import { companyApplied, InjectPrisma, type ScopedPrisma } from '../../platform/tenancy';
import { LeadsService } from './leads.service';

/**
 * The planner & notes surfaces — the "where we put our intent" layer, kept distinct from the
 * activity timeline (which is history). Three lean company-scoped singletons:
 *
 * - the **approach plan**, one per lead, hung off the lead workspace (reads on `crm:leads:read`,
 *   writes on `crm:leads:write` — enforced on the controller);
 * - the **rep's planner notes**, one per rep, private to them (`crm:activities:read`);
 * - the **team plan**, one per company, shared (read on `crm:team:read`, write on `crm:team:manage`).
 *
 * "My tasks" for the personal planner is not here: the frontend reads the existing activities list
 * filtered to the rep's assigned tasks. Every write is an upsert — one row, edited in place, no
 * versioning and no scheduler (ADR 0009).
 */
@Injectable()
export class PlannerService {
  constructor(
    @InjectPrisma() private readonly prisma: ScopedPrisma,
    private readonly leads: LeadsService,
  ) {}

  // ─── approach plan (per lead) ──────────────────────────────────────────────────────

  /**
   * A lead's approach plan. Always returns the shape — an all-null empty plan when none has been
   * written yet — so the workspace never has to special-case an empty body. Guards the lead exists.
   */
  async getApproachPlan(leadId: string): Promise<ApproachPlanResponse> {
    await this.leads.leadDetail(leadId);
    const row = await this.prisma.approachPlan.findUnique({ where: { leadId } });
    return row ? describeApproachPlan(row) : emptyApproachPlan(leadId);
  }

  /**
   * Upsert a lead's approach plan. A field left absent is untouched; a field sent blank or null is
   * cleared. `updatedByUserId` records the last rep to edit it.
   */
  async saveApproachPlan(
    leadId: string,
    patch: SaveApproachPlanRequest,
    actor: { userId: string },
  ): Promise<ApproachPlanResponse> {
    await this.leads.leadDetail(leadId);

    const fields = {
      ...(patch.angle !== undefined ? { angle: patch.angle } : {}),
      ...(patch.decisionMakers !== undefined ? { decisionMakers: patch.decisionMakers } : {}),
      ...(patch.objections !== undefined ? { objections: patch.objections } : {}),
      ...(patch.nextSteps !== undefined ? { nextSteps: patch.nextSteps } : {}),
      ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
    };

    const existing = await this.prisma.approachPlan.findUnique({ where: { leadId } });
    const row = existing
      ? await this.prisma.approachPlan.update({
          where: { leadId },
          data: { ...fields, updatedByUserId: actor.userId },
        })
      : await this.prisma.approachPlan.create({
          data: companyApplied({ leadId, ...fields, updatedByUserId: actor.userId }),
        });

    return describeApproachPlan(row);
  }

  /** Clear a lead's approach plan entirely. Idempotent — deleting a plan that isn't there is fine. */
  async deleteApproachPlan(leadId: string): Promise<{ success: boolean }> {
    await this.leads.leadDetail(leadId);
    await this.prisma.approachPlan.deleteMany({ where: { leadId } });
    return { success: true };
  }

  // ─── personal planner notes (per rep) ──────────────────────────────────────────────

  /** The current rep's planner notes — an empty note if they've never written one. */
  async getMyNotes(userId: string): Promise<PlannerNoteResponse> {
    const row = await this.prisma.plannerNote.findFirst({ where: { userId } });
    return row ? describePlannerNote(row) : { body: '', updatedAt: null };
  }

  /** Upsert the current rep's planner notes. */
  async saveMyNotes(userId: string, body: SavePlannerNoteRequest): Promise<PlannerNoteResponse> {
    const existing = await this.prisma.plannerNote.findFirst({ where: { userId } });
    const row = existing
      ? await this.prisma.plannerNote.update({ where: { id: existing.id }, data: { body: body.body } })
      : await this.prisma.plannerNote.create({ data: companyApplied({ userId, body: body.body }) });
    return describePlannerNote(row);
  }

  // ─── shared team plan (per company) ────────────────────────────────────────────────

  /** The team's shared plan — an empty plan until a manager first writes it. */
  async getTeamPlan(): Promise<TeamPlanResponse> {
    const row = await this.prisma.teamPlan.findFirst();
    return row ? describeTeamPlan(row) : { body: '', updatedByUserId: null, updatedAt: null };
  }

  /** Upsert the team's shared plan, recording the manager who last edited it. */
  async saveTeamPlan(body: SaveTeamPlanRequest, actor: { userId: string }): Promise<TeamPlanResponse> {
    const existing = await this.prisma.teamPlan.findFirst();
    const row = existing
      ? await this.prisma.teamPlan.update({
          where: { id: existing.id },
          data: { body: body.body, updatedByUserId: actor.userId },
        })
      : await this.prisma.teamPlan.create({
          data: companyApplied({ body: body.body, updatedByUserId: actor.userId }),
        });
    return describeTeamPlan(row);
  }
}

interface ApproachPlanRow {
  leadId: string;
  angle: string | null;
  decisionMakers: string | null;
  objections: string | null;
  nextSteps: string | null;
  notes: string | null;
  updatedByUserId: string;
  updatedAt: Date;
}

function describeApproachPlan(row: ApproachPlanRow): ApproachPlanResponse {
  return {
    leadId: row.leadId,
    angle: row.angle,
    decisionMakers: row.decisionMakers,
    objections: row.objections,
    nextSteps: row.nextSteps,
    notes: row.notes,
    updatedByUserId: row.updatedByUserId,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** The shape a lead with no plan yet returns — every field null, so the read never special-cases. */
function emptyApproachPlan(leadId: string): ApproachPlanResponse {
  return {
    leadId,
    angle: null,
    decisionMakers: null,
    objections: null,
    nextSteps: null,
    notes: null,
    updatedByUserId: null,
    updatedAt: null,
  };
}

interface PlannerNoteRow {
  body: string;
  updatedAt: Date;
}

function describePlannerNote(row: PlannerNoteRow): PlannerNoteResponse {
  return { body: row.body, updatedAt: row.updatedAt.toISOString() };
}

interface TeamPlanRow {
  body: string;
  updatedByUserId: string | null;
  updatedAt: Date;
}

function describeTeamPlan(row: TeamPlanRow): TeamPlanResponse {
  return {
    body: row.body,
    updatedByUserId: row.updatedByUserId,
    updatedAt: row.updatedAt.toISOString(),
  };
}
