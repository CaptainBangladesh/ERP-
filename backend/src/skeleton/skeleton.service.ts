import { Injectable } from '@nestjs/common';
import type { SkeletonProbe } from '@erp/shared';
import { PrismaService } from '../prisma/prisma.service';

/** TEMPORARY — deleted by ticket 02. See packages/src/skeleton/probe.ts. */
@Injectable()
export class SkeletonService {
  constructor(private readonly prisma: PrismaService) {}

  async count(): Promise<number> {
    return this.prisma.skeletonProbe.count();
  }

  async create(): Promise<SkeletonProbe> {
    const probe = await this.prisma.skeletonProbe.create({ data: {} });
    return { id: probe.id, createdAt: probe.createdAt.toISOString() };
  }
}
