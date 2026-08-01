import { Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import {
  SKELETON_PROBES_ROUTE,
  type SkeletonProbe,
  type SkeletonProbeCount,
} from '@erp/shared';
import { SkeletonService } from './skeleton.service';

/**
 * TEMPORARY — deleted by ticket 02. See packages/src/skeleton/probe.ts.
 *
 * The route comes from the shared package rather than being written out here, so the client
 * and the server cannot drift apart: changing the path in one place changes both, and a
 * mismatch is a type error rather than a 404 in production.
 */
@Controller(SKELETON_PROBES_ROUTE)
export class SkeletonController {
  constructor(private readonly skeleton: SkeletonService) {}

  @Get('count')
  async count(): Promise<SkeletonProbeCount> {
    return { count: await this.skeleton.count() };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(): Promise<SkeletonProbe> {
    return this.skeleton.create();
  }
}
