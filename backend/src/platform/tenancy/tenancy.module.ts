import { Global, Module } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { assertEveryModelIsClassified } from './company-owned';
import { SCOPED_PRISMA } from './inject-prisma';
import { Tenancy } from './tenancy';
import { createScopedPrisma } from './tenant-scope';

/**
 * The database, and the only way to reach it.
 *
 * `PrismaService` — the raw, unscoped client — is provided here but deliberately **not
 * exported**. Nothing in the container yields it to a module, so "inject the scoped client"
 * is not a convention modules follow but the only thing they can do. The alternative, a
 * global module exporting the raw client beside the scoped one, would leave the correct
 * choice as a thing a developer makes forty times.
 *
 * Global because every module needs the database and none of them should have to declare a
 * dependency on the platform to get it. The platform is not a module and cannot be named in
 * a manifest's `dependsOn`.
 */
@Global()
@Module({
  providers: [
    Tenancy,
    PrismaService,
    {
      provide: SCOPED_PRISMA,
      inject: [PrismaService, Tenancy],
      useFactory: (prisma: PrismaService, tenancy: Tenancy) => {
        // At boot, not at the first query: a table nobody classified is cheapest to notice
        // before it has rows in it. This is what makes "explicitly marked as not
        // company-owned" a thing the application enforces rather than a thing docs ask for.
        assertEveryModelIsClassified();
        return createScopedPrisma(prisma, tenancy);
      },
    },
  ],
  exports: [Tenancy, SCOPED_PRISMA],
})
export class TenancyModule {}
