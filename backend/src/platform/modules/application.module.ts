import {
  Module,
  type DynamicModule,
  type MiddlewareConsumer,
  type NestModule,
} from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { SessionGuard } from '../auth';
import { AccessGuard } from '../authorization';
import { EventsModule } from '../events';
import { MailModule } from '../mail';
import { StorageModule } from '../storage';
import { TenancyModule } from '../tenancy';
import { TenancyGuard } from '../tenancy/tenancy.guard';
import { TenancyMiddleware } from '../tenancy/tenancy.middleware';
import { NavigationController } from '../navigation/navigation.controller';
import { PermissionsController } from '../navigation/permissions.controller';
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
export class ApplicationModule implements NestModule {
  static from(manifests: readonly ModuleManifest[]): DynamicModule {
    const assembled = assembleModules(manifests);

    return {
      module: ApplicationModule,
      imports: [TenancyModule, MailModule, StorageModule, EventsModule, ...assembled.nestModules],
      controllers: [NavigationController, PermissionsController],
      providers: [
        { provide: MODULE_REGISTRY, useValue: assembled },
        TenancyMiddleware,
        /**
         * Every endpoint requires a session unless its handler says `@Public()`. Registered
         * once here rather than per controller so that protection is what a new module gets
         * by default, and exposure is what it has to ask for.
         *
         * `APP_GUARD` binds globally from any module, so this covers every module the
         * application was assembled from — including ones that know nothing about it.
         */
        { provide: APP_GUARD, useClass: SessionGuard },
        /**
         * Then the company the caller acts as. Order matters and is the order these are
         * written in: guards run in registration order, so the session exists by the time
         * tenancy asks for it.
         */
        { provide: APP_GUARD, useClass: TenancyGuard },
        /**
         * Finally, whether that company's tier and that caller's permissions reach this
         * particular handler — last, because it needs the grants tenancy has just resolved.
         */
        { provide: APP_GUARD, useClass: AccessGuard },
      ],
    };
  }

  /**
   * Opens a company scope around every request, including the ones no module claimed — the
   * navigation endpoint, and anything that 404s. Scoping something as fundamental as which
   * company is acting per controller would make an unscoped request the result of an
   * omission, which at forty modules is a certainty rather than a risk.
   */
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(TenancyMiddleware).forRoutes('*');
  }
}
