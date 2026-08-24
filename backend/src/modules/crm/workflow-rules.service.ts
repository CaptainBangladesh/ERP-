import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  WORKFLOW_RULE_ERROR_CODES,
  type NotificationListResponse,
  type NotificationSummary,
  type WorkflowActionType,
  type WorkflowRuleListResponse,
  type WorkflowRuleResponse,
  type WorkflowRuleSummary,
  type WorkflowTriggerType,
} from '@erp/shared';
import { ApiException } from '../../http/api-exception';
import { listQuery } from '../../platform/list';
import { companyApplied, InjectPrisma, type ScopedPrisma } from '../../platform/tenancy';
import type { Valid } from '../../platform/validation';
import { ActivitiesService } from './activities.service';
import {
  CreateWorkflowRuleBody,
  UpdateWorkflowRuleBody,
  WORKFLOW_RULE_LIST,
} from './schemas';

@Injectable()
export class WorkflowRulesService {
  constructor(
    @InjectPrisma() private readonly prisma: ScopedPrisma,
    private readonly activitiesService: ActivitiesService,
  ) {}

  async createRule(input: Valid<typeof CreateWorkflowRuleBody>): Promise<WorkflowRuleResponse> {
    const actionConfigObj = (input.actionConfig ?? {}) as Record<string, unknown>;
    this.validateActionConfig(input.actionType, actionConfigObj);

    const rule = await this.prisma.workflowRule.create({
      data: companyApplied<Prisma.WorkflowRuleUncheckedCreateInput>({
        name: input.name,
        triggerType: input.triggerType,
        triggerConfig: input.triggerConfig ? (input.triggerConfig as Prisma.InputJsonValue) : Prisma.JsonNull,
        actionType: input.actionType,
        actionConfig: actionConfigObj as Prisma.InputJsonValue,
        enabled: typeof input.enabled === 'boolean' ? input.enabled : true,
      }),
    });

    return describeRule(rule);
  }

  async listRules(query: Record<string, unknown>): Promise<WorkflowRuleListResponse> {
    const slice = listQuery(query, WORKFLOW_RULE_LIST);

    const [rows, total] = await Promise.all([
      this.prisma.workflowRule.findMany(slice.findMany<Prisma.WorkflowRuleFindManyArgs>()),
      this.prisma.workflowRule.count(slice.count<Prisma.WorkflowRuleCountArgs>()),
    ]);

    return slice.respond(rows.map(describeRule), total);
  }

  async getRule(id: string): Promise<WorkflowRuleResponse> {
    const rule = await this.requireRule(id);
    return describeRule(rule);
  }

  async updateRule(id: string, input: Valid<typeof UpdateWorkflowRuleBody>): Promise<WorkflowRuleResponse> {
    const existing = await this.requireRule(id);

    const actionType = input.actionType ?? (existing.actionType as WorkflowActionType);
    const actionConfigObj = (input.actionConfig ?? existing.actionConfig) as Record<string, unknown>;
    this.validateActionConfig(actionType, actionConfigObj);

    const data: Prisma.WorkflowRuleUncheckedUpdateInput = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.triggerType !== undefined) data.triggerType = input.triggerType;
    if (input.triggerConfig !== undefined) {
      data.triggerConfig = input.triggerConfig ? (input.triggerConfig as Prisma.InputJsonValue) : Prisma.JsonNull;
    }
    if (input.actionType !== undefined) data.actionType = input.actionType;
    if (input.actionConfig !== undefined) data.actionConfig = input.actionConfig as Prisma.InputJsonValue;
    if (typeof input.enabled === 'boolean') data.enabled = input.enabled;

    const updated = await this.prisma.workflowRule.update({
      where: { id },
      data,
    });

    return describeRule(updated);
  }

  async deleteRule(id: string): Promise<void> {
    await this.requireRule(id);
    await this.prisma.workflowRule.delete({ where: { id } });
  }

  async listNotifications(userId: string): Promise<NotificationListResponse> {
    const items = await this.prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });

    return {
      items: items.map((item) => ({
        id: item.id,
        userId: item.userId,
        title: item.title,
        message: item.message,
        read: item.read,
        createdAt: item.createdAt.toISOString(),
      })),
    };
  }

  /**
   * Synchronously evaluates matching rules after a triggering event commits.
   * Best-effort execution: errors in actions are caught and swallowed so the triggering write is not rolled back.
   */
  async evaluateRules(event: {
    triggerType: WorkflowTriggerType;
    leadId?: string;
    dealId?: string;
    toStageId?: string;
    toStatus?: string;
    actor: { userId: string; name: string };
  }): Promise<void> {
    try {
      const activeRules = await this.prisma.workflowRule.findMany({
        where: {
          triggerType: event.triggerType,
          enabled: true,
        },
      });

      for (const ruleItem of activeRules) {
        try {
          const config = (ruleItem.triggerConfig as { toStageId?: string; toStatus?: string } | null) ?? {};

          if (event.triggerType === 'deal.stage_changed' && config.toStageId && config.toStageId !== event.toStageId) {
            continue;
          }

          if (event.triggerType === 'lead.status_changed' && config.toStatus && config.toStatus !== event.toStatus) {
            continue;
          }

          await this.executeAction(ruleItem, event);
        } catch {
          // Best-effort execution: swallow errors per rule
        }
      }
    } catch {
      // Best-effort execution: swallow overall evaluation errors
    }
  }

  private async executeAction(
    ruleItem: { id: string; name: string; actionType: string; actionConfig: unknown },
    event: {
      leadId?: string;
      dealId?: string;
      toStageId?: string;
      toStatus?: string;
      actor: { userId: string; name: string };
    },
  ): Promise<void> {
    const actionConfig = (ruleItem.actionConfig as Record<string, unknown>) ?? {};

    if (ruleItem.actionType === 'notify_user') {
      const targetUserId = (actionConfig.userId as string | undefined) ?? event.actor.userId;
      await this.prisma.notification.create({
        data: companyApplied<Prisma.NotificationUncheckedCreateInput>({
          userId: targetUserId,
          title: `Workflow Automation: ${ruleItem.name}`,
          message: `Rule "${ruleItem.name}" triggered on ${event.leadId ? `Lead ${event.leadId}` : `Deal ${event.dealId}`}.`,
          read: false,
        }),
      });
    } else if (ruleItem.actionType === 'update_field') {
      const field = actionConfig.field as string;
      const value = actionConfig.value as string;

      if (field === 'stageId' || field === 'status') {
        throw invalidActionField();
      }

      if (event.leadId && field) {
        await this.prisma.lead.update({
          where: { id: event.leadId },
          data: { [field]: value },
        });
      } else if (event.dealId && field) {
        await this.prisma.deal.update({
          where: { id: event.dealId },
          data: { [field]: value },
        });
      }
    } else if (ruleItem.actionType === 'create_task') {
      const notes = (actionConfig.notes as string | undefined) ?? `Follow up: ${ruleItem.name}`;
      const dueInDays = (actionConfig.dueInDays as number | undefined) ?? 1;
      const dueAtDate = new Date();
      dueAtDate.setDate(dueAtDate.getDate() + dueInDays);

      await this.activitiesService.logActivity(event.actor, {
        type: 'task',
        notes,
        occurredAt: undefined,
        dueAt: dueAtDate as any,
        leadId: event.leadId ?? undefined,
        dealId: event.dealId ?? undefined,
        partyId: undefined,
      });
    }
  }

  private validateActionConfig(actionType: WorkflowActionType, actionConfig: Record<string, unknown>): void {
    if (actionType === 'update_field') {
      const field = actionConfig?.field as string | undefined;
      if (field === 'stageId' || field === 'status') {
        throw invalidActionField();
      }
    }
  }

  private async requireRule(id: string) {
    const rule = await this.prisma.workflowRule.findFirst({ where: { id } });
    if (!rule) throw ruleNotFound();
    return rule;
  }
}

function describeRule(row: {
  id: string;
  name: string;
  triggerType: string;
  triggerConfig: unknown;
  actionType: string;
  actionConfig: unknown;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}): WorkflowRuleSummary {
  return {
    id: row.id,
    name: row.name,
    triggerType: row.triggerType as WorkflowTriggerType,
    triggerConfig: (row.triggerConfig as any) ?? null,
    actionType: row.actionType as WorkflowActionType,
    actionConfig: (row.actionConfig as any) ?? {},
    enabled: row.enabled,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function ruleNotFound(): ApiException {
  return new ApiException(
    WORKFLOW_RULE_ERROR_CODES.ruleNotFound,
    'That workflow rule does not exist.',
    HttpStatus.NOT_FOUND,
  );
}

function invalidActionField(): ApiException {
  return new ApiException(
    WORKFLOW_RULE_ERROR_CODES.invalidActionField,
    'update_field action cannot target stageId or status.',
    HttpStatus.UNPROCESSABLE_ENTITY,
  );
}
