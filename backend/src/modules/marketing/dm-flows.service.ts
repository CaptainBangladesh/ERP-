import { HttpStatus, Injectable } from '@nestjs/common';
import { ApiException } from '../../http/api-exception';
import { Prisma } from '@prisma/client';
import type {
  DmAutomationFlowListResponse,
  DmAutomationFlowResponse,
  DmAutomationFlowSummary,
  DmMatchType,
} from '@erp/shared';
import { listQuery } from '../../platform/list';
import { companyApplied, InjectPrisma, type ScopedPrisma } from '../../platform/tenancy';
import { Valid } from '../../platform/validation';
import { CreateDmAutomationFlowBody, DM_FLOW_LIST, UpdateDmAutomationFlowBody } from './schemas';

export function toDmFlowSummary(f: {
  id: string;
  brandId: string;
  socialAccountId: string | null;
  name: string;
  triggerKeyword: string;
  matchType: string;
  responseTemplate: string;
  leadMagnetUrl: string | null;
  isActive: boolean;
  triggerCount: number;
  createdAt: Date;
  updatedAt: Date;
}): DmAutomationFlowSummary {
  return {
    id: f.id,
    brandId: f.brandId,
    socialAccountId: f.socialAccountId,
    name: f.name,
    triggerKeyword: f.triggerKeyword,
    matchType: f.matchType as DmMatchType,
    responseTemplate: f.responseTemplate,
    leadMagnetUrl: f.leadMagnetUrl,
    isActive: f.isActive,
    triggerCount: f.triggerCount,
    createdAt: f.createdAt.toISOString(),
    updatedAt: f.updatedAt.toISOString(),
  };
}

@Injectable()
export class DmFlowsService {
  constructor(@InjectPrisma() private readonly prisma: ScopedPrisma) {}

  async createFlow(
    input: Valid<typeof CreateDmAutomationFlowBody>,
  ): Promise<DmAutomationFlowResponse> {
    const brand = await this.prisma.marketingBrand.findUnique({
      where: { id: input.brandId },
    });
    if (!brand) {
      throw new ApiException('brand_not_found', 'Brand not found.', HttpStatus.NOT_FOUND);
    }

    const flow = await this.prisma.dmAutomationFlow.create({
      data: companyApplied<Prisma.DmAutomationFlowUncheckedCreateInput>({
        brandId: input.brandId,
        socialAccountId: input.socialAccountId ?? null,
        name: input.name,
        triggerKeyword: input.triggerKeyword.trim(),
        matchType: input.matchType?.toUpperCase() === 'CONTAINS' ? 'CONTAINS' : 'EXACT',
        responseTemplate: input.responseTemplate,
        leadMagnetUrl: input.leadMagnetUrl ?? null,
        isActive: input.isActive ?? true,
      }),
    });

    return toDmFlowSummary(flow);
  }

  async listFlows(query: Record<string, unknown>): Promise<DmAutomationFlowListResponse> {
    const slice = listQuery(query, DM_FLOW_LIST);
    const [items, total] = await Promise.all([
      this.prisma.dmAutomationFlow.findMany({
        ...slice.findMany<Prisma.DmAutomationFlowFindManyArgs>(),
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.dmAutomationFlow.count(slice.count<Prisma.DmAutomationFlowCountArgs>()),
    ]);

    return slice.respond(items.map(toDmFlowSummary), total);
  }

  async getFlow(id: string): Promise<DmAutomationFlowResponse> {
    const flow = await this.prisma.dmAutomationFlow.findUnique({
      where: { id },
    });
    if (!flow) {
      throw new ApiException('dm_flow_not_found', 'DM Automation Flow not found.', HttpStatus.NOT_FOUND);
    }
    return toDmFlowSummary(flow);
  }

  async updateFlow(
    id: string,
    input: Valid<typeof UpdateDmAutomationFlowBody>,
  ): Promise<DmAutomationFlowResponse> {
    const existing = await this.prisma.dmAutomationFlow.findUnique({ where: { id } });
    if (!existing) {
      throw new ApiException('dm_flow_not_found', 'DM Automation Flow not found.', HttpStatus.NOT_FOUND);
    }

    const updateData: Prisma.DmAutomationFlowUncheckedUpdateInput = {};
    if (input.name !== undefined) updateData.name = input.name;
    if (input.triggerKeyword !== undefined) updateData.triggerKeyword = input.triggerKeyword.trim();
    if (input.matchType !== undefined) {
      updateData.matchType = input.matchType.toUpperCase() === 'CONTAINS' ? 'CONTAINS' : 'EXACT';
    }
    if (input.responseTemplate !== undefined) updateData.responseTemplate = input.responseTemplate;
    if (input.leadMagnetUrl !== undefined) updateData.leadMagnetUrl = input.leadMagnetUrl;
    if (input.socialAccountId !== undefined) updateData.socialAccountId = input.socialAccountId;
    if (input.isActive !== undefined) updateData.isActive = input.isActive;

    const updated = await this.prisma.dmAutomationFlow.update({
      where: { id },
      data: updateData,
    });

    return toDmFlowSummary(updated);
  }

  async deleteFlow(id: string): Promise<{ success: boolean }> {
    const existing = await this.prisma.dmAutomationFlow.findUnique({ where: { id } });
    if (!existing) {
      throw new ApiException('dm_flow_not_found', 'DM Automation Flow not found.', HttpStatus.NOT_FOUND);
    }
    await this.prisma.dmAutomationFlow.delete({ where: { id } });
    return { success: true };
  }

  /**
   * Evaluates incoming message content against active brand flows.
   * If a match occurs, increments triggerCount and constructs formatted reply.
   */
  async evaluateMessage(
    brandId: string,
    content: string,
    socialAccountId?: string | null,
  ): Promise<{ flow: DmAutomationFlowSummary; replyText: string } | null> {
    const flows = await this.prisma.dmAutomationFlow.findMany({
      where: {
        brandId,
        isActive: true,
        ...(socialAccountId ? { OR: [{ socialAccountId }, { socialAccountId: null }] } : {}),
      },
      orderBy: { createdAt: 'asc' },
    });

    const trimmedContent = content.trim();
    const normalizedContent = trimmedContent.toLowerCase();

    for (const flow of flows) {
      const keyword = flow.triggerKeyword.trim().toLowerCase();
      let matched = false;

      if (flow.matchType === 'CONTAINS') {
        matched = normalizedContent.includes(keyword);
      } else {
        // EXACT match
        matched = normalizedContent === keyword;
      }

      if (matched) {
        // Increment trigger count
        const updatedFlow = await this.prisma.dmAutomationFlow.update({
          where: { id: flow.id },
          data: { triggerCount: { increment: 1 } },
        });

        // Format template
        let replyText = flow.responseTemplate;
        const magnet = flow.leadMagnetUrl || '';
        if (replyText.includes('{{leadMagnetUrl}}')) {
          replyText = replyText.replace(/\{\{leadMagnetUrl\}\}/g, magnet);
        } else if (replyText.includes('{{link}}')) {
          replyText = replyText.replace(/\{\{link\}\}/g, magnet);
        } else if (magnet && !replyText.includes(magnet)) {
          replyText = `${replyText}\n\n${magnet}`;
        }

        return {
          flow: toDmFlowSummary(updatedFlow),
          replyText: replyText.trim(),
        };
      }
    }

    return null;
  }
}
