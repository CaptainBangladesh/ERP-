import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * The raw database connection, and its lifecycle.
 *
 * No module injects this and none can: `TenancyModule` provides it without exporting it, so
 * the only client reachable from a module is the tenant-scoped one wrapped around it. Scoping
 * is not a layer a module opts into — it is the only door. See ADR 0003.
 *
 * The one caller outside the platform is the test harness, which truncates every table
 * between tests. Truncation is raw SQL across the whole schema with no company to be scoped
 * to; it reaches this by asking the container for the class rather than by injection.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
