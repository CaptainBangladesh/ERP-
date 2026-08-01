import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module';
import { SkeletonModule } from './skeleton/skeleton.module';

/**
 * The application root.
 *
 * Ticket 02 replaces this hand-written import list with assembly from module manifests, so
 * that adding one of the forty-plus modules never means editing a central registry.
 *
 * Environment comes from `./env`, imported first in `main.ts`. There is deliberately only
 * one env mechanism: Prisma reads DATABASE_URL when its client is constructed, which happens
 * while Nest is still building the module graph, so a Nest-managed config module would load
 * too late to be the source of truth and having both would mean two answers to one question.
 */
@Module({
  imports: [PrismaModule, SkeletonModule],
})
export class AppModule {}
