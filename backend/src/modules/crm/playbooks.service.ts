import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  PLAYBOOK_ERROR_CODES,
  SYSTEM_ACTOR_ID,
  type ActivityType,
  type CreatePlaybookRequest,
  type GuidedNextAction,
  type LeadGuidanceResponse,
  type LeadResponse,
  type PlaybookEnrollmentSummary,
  type PlaybookStepInput,
  type PlaybookStepSummary,
  type PlaybookSummary,
  type ScriptCategory,
  type UpdatePlaybookRequest,
} from '@erp/shared';
import { ApiException } from '../../http/api-exception';
import { companyApplied, InjectPrisma, type ScopedPrisma } from '../../platform/tenancy';
import { LeadsService } from './leads.service';
import { ScriptsService } from './scripts.service';

/**
 * Playbooks — named plays of ordered steps — and the guided-selling surfaces that run off them.
 *
 * Two audiences share one service because they share one subject. Authoring (create/update/delete
 * a play) is manager-gated (`crm:playbooks:write`); the runtime (a lead's guidance panel,
 * enrolling a lead on a play, advancing it) is the rep's day-to-day, gated by `crm:leads:read`/
 * `crm:leads:write`. Progression is **manual**: this platform has no scheduler (ADR 0009), so a
 * rep marks a step done and the pointer moves — nothing is time-gated.
 */
@Injectable()
export class PlaybooksService {
  constructor(
    @InjectPrisma() private readonly prisma: ScopedPrisma,
    private readonly scriptsService: ScriptsService,
    private readonly leadsService: LeadsService,
  ) {}

  // ─── authoring ────────────────────────────────────────────────────────────────────

  async list(): Promise<PlaybookSummary[]> {
    const rows = await this.prisma.playbook.findMany({
      orderBy: { name: 'asc' },
      include: { steps: { orderBy: { order: 'asc' } } },
    });
    return rows.map((r: PlaybookRow) => describePlaybook(r));
  }

  async get(id: string): Promise<PlaybookSummary> {
    const row = await this.loadPlaybook(id);
    if (!row) throw playbookNotFound();
    return describePlaybook(row);
  }

  async create(body: CreatePlaybookRequest, actor: { userId: string }): Promise<PlaybookSummary> {
    await this.assertStepScriptsExist(body.steps);

    const created = await this.prisma.$transaction(async (tx) => {
      const playbook = await tx.playbook.create({
        data: companyApplied<Prisma.PlaybookUncheckedCreateInput>({
          name: body.name.trim(),
          description: normaliseText(body.description),
          createdByUserId: actor.userId,
        }),
      });
      await tx.playbookStep.createMany({ data: stepRows(playbook.id, body.steps) });
      return tx.playbook.findUnique({
        where: { id: playbook.id },
        include: { steps: { orderBy: { order: 'asc' } } },
      });
    });

    return describePlaybook(created!);
  }

  async update(id: string, patch: UpdatePlaybookRequest): Promise<PlaybookSummary> {
    const existing = await this.prisma.playbook.findUnique({ where: { id } });
    if (!existing) throw playbookNotFound();
    if (patch.steps !== undefined) await this.assertStepScriptsExist(patch.steps);

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.playbook.update({
        where: { id },
        data: {
          ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
          ...(patch.description !== undefined ? { description: normaliseText(patch.description) } : {}),
        },
      });

      if (patch.steps !== undefined) {
        // Replace the whole ordered list. A lead already partway through keeps its pointer; the
        // enrollment summary clamps it to the new step count rather than resetting anyone's
        // progress, so editing a play's wording never silently un-does a rep's work.
        await tx.playbookStep.deleteMany({ where: { playbookId: id } });
        await tx.playbookStep.createMany({ data: stepRows(id, patch.steps) });
      }

      return tx.playbook.findUnique({
        where: { id },
        include: { steps: { orderBy: { order: 'asc' } } },
      });
    });

    return describePlaybook(updated!);
  }

  async delete(id: string): Promise<{ success: boolean }> {
    const existing = await this.prisma.playbook.findUnique({ where: { id } });
    if (!existing) throw playbookNotFound();
    // Steps and any lead enrollments cascade (both FKs are `onDelete: Cascade`).
    await this.prisma.playbook.delete({ where: { id } });
    return { success: true };
  }

  // ─── guided selling ───────────────────────────────────────────────────────────────

  /** Everything the lead-workspace guidance surface needs, in one read. */
  async leadGuidance(leadId: string): Promise<LeadGuidanceResponse> {
    const lead = await this.leadsService.leadDetail(leadId);
    const scripts = await this.scriptsService.resolveScriptsFor(lead);
    const enrollment = await this.loadEnrollmentSummary(leadId);
    const nextBestAction = await this.computeNextBestAction(lead, enrollment);
    return { scripts, enrollment, nextBestAction };
  }

  /** Put a lead on a play — or move it to a different one, restarting at the first step. */
  async enroll(leadId: string, playbookId: string): Promise<PlaybookEnrollmentSummary> {
    await this.leadsService.leadDetail(leadId); // 404s if the lead is not this company's

    const playbook = await this.prisma.playbook.findUnique({
      where: { id: playbookId },
      include: { steps: { select: { id: true } } },
    });
    if (!playbook) throw playbookNotFound();
    if (playbook.steps.length === 0) throw playbookHasNoSteps();

    const existing = await this.prisma.playbookEnrollment.findFirst({ where: { leadId } });
    if (existing) {
      await this.prisma.playbookEnrollment.update({
        where: { id: existing.id },
        data: { playbookId, completedSteps: 0, completedAt: null },
      });
    } else {
      await this.prisma.playbookEnrollment.create({
        data: companyApplied<Prisma.PlaybookEnrollmentUncheckedCreateInput>({
          leadId,
          playbookId,
          completedSteps: 0,
        }),
      });
    }

    return (await this.loadEnrollmentSummary(leadId))!;
  }

  /** Mark the current step done and move the pointer on. The manual half of "guided". */
  async advance(leadId: string): Promise<PlaybookEnrollmentSummary> {
    const row = await this.loadEnrollmentRow(leadId);
    if (!row) throw leadNotEnrolled();

    const total = row.playbook.steps.length;
    if (row.completedSteps >= total) throw playbookAlreadyComplete();

    const completedSteps = row.completedSteps + 1;
    await this.prisma.playbookEnrollment.update({
      where: { id: row.id },
      data: { completedSteps, completedAt: completedSteps >= total ? new Date() : null },
    });

    return (await this.loadEnrollmentSummary(leadId))!;
  }

  /** Take a lead off its play. Idempotent — unenrolling a lead that is on nothing is a no-op. */
  async unenroll(leadId: string): Promise<{ success: boolean }> {
    const row = await this.prisma.playbookEnrollment.findFirst({ where: { leadId } });
    if (row) await this.prisma.playbookEnrollment.delete({ where: { id: row.id } });
    return { success: true };
  }

  // ─── internals ────────────────────────────────────────────────────────────────────

  private async computeNextBestAction(
    lead: LeadResponse,
    enrollment: PlaybookEnrollmentSummary | null,
  ): Promise<GuidedNextAction> {
    const recency = await this.recencyReason(lead.id);

    // On a play with a step still to do: that step is the next action.
    if (enrollment && enrollment.currentStep) {
      const step = enrollment.currentStep;
      const script = step.scriptId
        ? await this.scriptsService.resolveOneForLead(step.scriptId, lead)
        : null;
      return {
        kind: 'playbook-step',
        title: `Step ${enrollment.completedSteps + 1} of ${enrollment.totalSteps}: ${step.title}`,
        instruction: step.instruction,
        activityType: step.activityType,
        script,
        playbookStepOrder: step.order,
        reason: `On “${enrollment.playbookName}”. ${recency}`,
      };
    }

    return this.statusSuggestion(lead, recency);
  }

  /**
   * The fallback recommendation when a lead is on no play: what its lifecycle `status` calls for,
   * with a script keyed to that moment. Deterministic — the same status yields the same prompt —
   * so it reads as guidance rather than a guess.
   */
  private async statusSuggestion(lead: LeadResponse, recency: string): Promise<GuidedNextAction> {
    const pick = (cats: ScriptCategory[]) => this.scriptsService.pickForLead(lead, cats);

    switch (lead.status) {
      case 'new':
        return {
          kind: 'status-suggestion',
          title: 'Make first contact',
          instruction: 'Reach out and introduce yourself — open the relationship.',
          activityType: 'call',
          script: await pick(['opener']),
          playbookStepOrder: null,
          reason: `Lead is new. ${recency}`,
        };
      case 'contacted':
        return {
          kind: 'status-suggestion',
          title: 'Follow up and qualify',
          instruction: 'Follow up, uncover the need and qualify the fit.',
          activityType: 'call',
          script: await pick(['discovery', 'objection']),
          playbookStepOrder: null,
          reason: `Lead has been contacted. ${recency}`,
        };
      case 'qualified':
        return {
          kind: 'status-suggestion',
          title: 'Advance toward a close',
          instruction: 'Move it forward — a proposal, a demo, or a close.',
          activityType: 'meeting',
          script: await pick(['closing']),
          playbookStepOrder: null,
          reason: `Lead is qualified. ${recency}`,
        };
      case 'disqualified':
        return {
          kind: 'none',
          title: 'No next action',
          instruction: 'This lead is disqualified. Reopen it if something changes.',
          activityType: null,
          script: null,
          playbookStepOrder: null,
          reason: 'Lead is disqualified.',
        };
      default:
        // A company's own custom status. Nothing status-specific to say, so keep the lead warm
        // with whatever script best fits.
        return {
          kind: 'status-suggestion',
          title: 'Log your next touch',
          instruction: 'Keep the lead warm — record your next interaction.',
          activityType: 'call',
          script: await pick(['general', 'opener', 'discovery', 'closing']),
          playbookStepOrder: null,
          reason: recency,
        };
    }
  }

  /** How long since a human last touched this lead, phrased for the recommendation's caption. */
  private async recencyReason(leadId: string): Promise<string> {
    const last = await this.prisma.activity.findFirst({
      where: { leadId, createdByUserId: { not: SYSTEM_ACTOR_ID } },
      orderBy: { occurredAt: 'desc' },
      select: { occurredAt: true },
    });
    if (!last) return 'No activity logged yet.';

    const days = Math.floor((Date.now() - last.occurredAt.getTime()) / 86_400_000);
    if (days <= 0) return 'Last touch was today.';
    if (days >= 7) return `It has been ${days} days since the last touch — don't let it go cold.`;
    return `${days} day${days === 1 ? '' : 's'} since the last touch.`;
  }

  private async assertStepScriptsExist(steps: PlaybookStepInput[]): Promise<void> {
    const ids = [...new Set(steps.map((s) => s.scriptId).filter((v): v is string => !!v))];
    if (ids.length === 0) return;
    const found = await this.prisma.script.findMany({ where: { id: { in: ids } }, select: { id: true } });
    if (found.length !== ids.length) throw stepScriptNotFound();
  }

  private loadPlaybook(id: string) {
    return this.prisma.playbook.findUnique({
      where: { id },
      include: { steps: { orderBy: { order: 'asc' } } },
    });
  }

  private loadEnrollmentRow(leadId: string) {
    return this.prisma.playbookEnrollment.findFirst({
      where: { leadId },
      include: { playbook: { include: { steps: { orderBy: { order: 'asc' } } } } },
    });
  }

  private async loadEnrollmentSummary(leadId: string): Promise<PlaybookEnrollmentSummary | null> {
    const row = await this.loadEnrollmentRow(leadId);
    return row ? describeEnrollment(row) : null;
  }
}

// ─── row shapes & mappers ─────────────────────────────────────────────────────────────

interface StepRow {
  id: string;
  order: number;
  title: string;
  instruction: string;
  scriptId: string | null;
  activityType: string | null;
}

interface PlaybookRow {
  id: string;
  name: string;
  description: string | null;
  createdByUserId: string;
  createdAt: Date;
  updatedAt: Date;
  steps: StepRow[];
}

interface EnrollmentRow {
  id: string;
  completedSteps: number;
  completedAt: Date | null;
  playbook: { id: string; name: string; steps: StepRow[] };
}

function stepRows(playbookId: string, steps: PlaybookStepInput[]): Prisma.PlaybookStepUncheckedCreateInput[] {
  return steps.map((s, i) =>
    companyApplied<Prisma.PlaybookStepUncheckedCreateInput>({
      playbookId,
      order: i + 1,
      title: s.title.trim(),
      instruction: s.instruction.trim(),
      scriptId: s.scriptId ?? null,
      activityType: s.activityType ?? null,
    }),
  );
}

function describeStep(row: StepRow): PlaybookStepSummary {
  return {
    id: row.id,
    order: row.order,
    title: row.title,
    instruction: row.instruction,
    scriptId: row.scriptId,
    activityType: (row.activityType as ActivityType | null) ?? null,
  };
}

export function describePlaybook(row: PlaybookRow): PlaybookSummary {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    steps: row.steps.map(describeStep),
    createdByUserId: row.createdByUserId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function describeEnrollment(row: EnrollmentRow): PlaybookEnrollmentSummary {
  const totalSteps = row.playbook.steps.length;
  // Clamp: a play whose steps were edited down can leave a stored pointer past the end.
  const completedSteps = Math.min(row.completedSteps, totalSteps);
  const currentStep = completedSteps < totalSteps ? describeStep(row.playbook.steps[completedSteps]!) : null;

  return {
    playbookId: row.playbook.id,
    playbookName: row.playbook.name,
    completedSteps,
    totalSteps,
    completedAt: currentStep === null && totalSteps > 0 ? (row.completedAt ?? new Date()).toISOString() : null,
    currentStep,
  };
}

function normaliseText(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

export function playbookNotFound(): ApiException {
  return new ApiException(
    PLAYBOOK_ERROR_CODES.playbookNotFound,
    'That playbook does not exist.',
    HttpStatus.NOT_FOUND,
  );
}

export function playbookHasNoSteps(): ApiException {
  return new ApiException(
    PLAYBOOK_ERROR_CODES.playbookHasNoSteps,
    'That playbook has no steps to walk.',
    HttpStatus.BAD_REQUEST,
  );
}

export function stepScriptNotFound(): ApiException {
  return new ApiException(
    PLAYBOOK_ERROR_CODES.stepScriptNotFound,
    'A step names a script that does not exist.',
    HttpStatus.BAD_REQUEST,
  );
}

export function leadNotEnrolled(): ApiException {
  return new ApiException(
    PLAYBOOK_ERROR_CODES.leadNotEnrolled,
    'That lead is not on a playbook.',
    HttpStatus.BAD_REQUEST,
  );
}

export function playbookAlreadyComplete(): ApiException {
  return new ApiException(
    PLAYBOOK_ERROR_CODES.playbookAlreadyComplete,
    'That playbook is already complete.',
    HttpStatus.BAD_REQUEST,
  );
}
