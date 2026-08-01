import { Module } from '@nestjs/common';
import { SkeletonController } from './skeleton.controller';
import { SkeletonService } from './skeleton.service';

/** TEMPORARY — deleted by ticket 02. See packages/src/skeleton/probe.ts. */
@Module({
  controllers: [SkeletonController],
  providers: [SkeletonService],
})
export class SkeletonModule {}
