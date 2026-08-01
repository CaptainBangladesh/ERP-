import { Module, type DynamicModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { PrismaModule } from '../../prisma/prisma.module';
import { SessionGuard } from '../auth';
import { NavigationController } from '../navigation/navigation.controller';
import { assembleModules } from './assemble';
import { MODULE_REGISTRY } from './registry';
import type { ModuleManifest } from './manifest';

/**
 * The application, built from a set of manifests.
 *
 * Taking the manifests as an argument rather than discovering them itself is what makes the
 * deletion test something a test can actually perform: `from([])` boots a real application
 * with no business modules at all, which is the claim "the application boots with any subset
 * of modules present" is making. A module that discovered its own dependencies could only be
 * checked by deleting directories.
 */
@Module({})
export class ApplicationModule {
  static from(manifests: readonly ModuleManifest[]): DynamicModule {
    const assembled = assembleModules(manifests);

    return {
      module: ApplicationModule,
      imports: [PrismaModule, ...assembled.nestModules],
      controllers: [NavigationController],
      providers: [
        { provide: MODULE_REGISTRY, useValue: assembled },
        /**
         * Every endpoint requires a session unless its handler says `@Public()`. Registered
         * once here rather than per controller so that protection is what a new module gets
         * by default, and exposure is what it has to ask for.
         *
         * `APP_GUARD` binds globally from any module, so this covers every module the
         * application was assembled from — including ones that know nothing about it.
         */
        { provide: APP_GUARD, useClass: SessionGuard },
      ],
    };
  }
}
