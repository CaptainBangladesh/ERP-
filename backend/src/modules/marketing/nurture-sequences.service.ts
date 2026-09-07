import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  NurtureSequenceListResponse,
  NurtureSequenceResponse,
  NurtureSequenceStep,
  NurtureSequenceSummary,
} from '@erp/shared';
import { ApiException } from '../../http/api-exception';
import { listQuery } from '../../platform/list';
import { companyApplied, InjectPrisma, type ScopedPrisma } from '../../platform/tenancy';
import type { Valid } from '../../platform/validation';
import {
  CreateNurtureSequenceBody,
  NURTURE_SEQUENCE_LIST,
  UpdateNurtureSequenceBody,
} from './schemas';

function notFound(): ApiException {
  return new ApiException(
    'nurture_sequence_not_found',
    'Nurture sequence not found.',
    HttpStatus.NOT_FOUND,
  );
}

function describeSequence(row: {
  id: string;
  brandId: string;
  name: string;
  description: string | null;
  triggerEvent: string;
  steps: Prisma.JsonValue;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}): NurtureSequenceSummary {
  return {
    id: row.id,
    brandId: row.brandId,
    name: row.name,
    description: row.description,
    triggerEvent: row.triggerEvent,
    steps: (Array.isArray(row.steps) ? row.steps : []) as unknown as NurtureSequenceStep[],
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

@Injectable()
export class NurtureSequencesService {
  constructor(@InjectPrisma() private readonly prisma: ScopedPrisma) {}

  async createSequence(
    input: Valid<typeof CreateNurtureSequenceBody>,
  ): Promise<NurtureSequenceResponse> {
    const brand = await this.prisma.marketingBrand.findUnique({
      where: { id: input.brandId },
    });
    if (!brand) {
      throw new ApiException('brand_not_found', 'Brand not found.', HttpStatus.BAD_REQUEST);
    }

    const defaultSteps: NurtureSequenceStep[] = [
      {
        orderIndex: 0,
        delayMinutes: 0,
        emailSubject: 'Welcome! Thanks for reaching out',
        emailBody: 'Hi {{name}}, thanks for your interest. We will be in touch shortly!',
      },
      {
        orderIndex: 1,
        delayMinutes: 1440, // 24 hours
        emailSubject: 'Quick resource to help you get started',
        emailBody: 'Here is our latest customer story and quick guide.',
      },
    ];

    const steps =
      Array.isArray(input.steps) && input.steps.length > 0 ? input.steps : defaultSteps;

    const sequence = await this.prisma.nurtureSequence.create({
      data: companyApplied<Prisma.NurtureSequenceUncheckedCreateInput>({
        brandId: input.brandId,
        name: input.name,
        description: input.description ?? null,
        triggerEvent: input.triggerEvent,
        steps: steps as unknown as Prisma.InputJsonValue,
        status: 'ACTIVE',
      }),
    });

    return describeSequence(sequence);
  }

  async listSequences(query: Record<string, unknown>): Promise<NurtureSequenceListResponse> {
    const slice = listQuery(query, NURTURE_SEQUENCE_LIST);
    const [rows, total] = await Promise.all([
      this.prisma.nurtureSequence.findMany({
        ...slice.findMany<Prisma.NurtureSequenceFindManyArgs>(),
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.nurtureSequence.count(slice.count<Prisma.NurtureSequenceCountArgs>()),
    ]);
    return slice.respond(rows.map(describeSequence), total);
  }

  async getSequence(id: string): Promise<NurtureSequenceResponse> {
    const sequence = await this.prisma.nurtureSequence.findUnique({
      where: { id },
    });
    if (!sequence) throw notFound();
    return describeSequence(sequence);
  }

  async updateSequence(
    id: string,
    input: Valid<typeof UpdateNurtureSequenceBody>,
  ): Promise<NurtureSequenceResponse> {
    const existing = await this.prisma.nurtureSequence.findUnique({ where: { id } });
    if (!existing) throw notFound();

    const updated = await this.prisma.nurtureSequence.update({
      where: { id },
      data: {
        ...(input.name ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.triggerEvent ? { triggerEvent: input.triggerEvent } : {}),
        ...(input.steps ? { steps: input.steps as unknown as Prisma.InputJsonValue } : {}),
        ...(input.status ? { status: input.status } : {}),
      },
    });

    return describeSequence(updated);
  }

  async deleteSequence(id: string): Promise<{ deleted: boolean }> {
    const existing = await this.prisma.nurtureSequence.findUnique({ where: { id } });
    if (!existing) throw notFound();

    await this.prisma.nurtureSequence.delete({ where: { id } });
    return { deleted: true };
  }
}
