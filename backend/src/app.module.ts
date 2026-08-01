import { Module } from '@nestjs/common';
import { ApplicationModule, discoverManifests } from './platform/modules';

/**
 * The application root — and nothing but assembly.
 *
 * There is no import list of business modules here and there never will be. Modules are
 * found by looking in `src/modules`, checked against each other, and ordered by what they
 * declare they depend on. Adding the fortieth module means creating a directory; removing
 * one means deleting it. A hand-kept list would have to stay in step with the filesystem
 * forty times over, and the first time it did not, the failure would be a module that
 * silently did not load.
 *
 * Discovery happens at import time, so a graph that cannot be assembled fails before Nest
 * builds anything — and the same assembly runs in CI with no database, which is what turns
 * a broken module graph into a failed build rather than a failed deployment.
 *
 * Environment comes from `./env`, imported first in `main.ts`. There is deliberately only
 * one env mechanism: Prisma reads DATABASE_URL when its client is constructed, which happens
 * while Nest is still building the module graph, so a Nest-managed config module would load
 * too late to be the source of truth and having both would mean two answers to one question.
 */
@Module({
  imports: [ApplicationModule.from(discoverManifests())],
})
export class AppModule {}
