import { Injectable } from '@nestjs/common';
import { InjectPrisma, type ScopedPrisma } from '../tenancy';
import { CompanyDirectory, type CompanyMailAccount } from './company-directory';

/**
 * The seam, answered from the tenant-root row itself.
 *
 * Reads go through the scoped client like everything else, so "the company" always means the
 * one the caller is acting as — `findFirst` under tenancy is the root row, not an arbitrary
 * one. Absence is returned rather than thrown throughout: password reset and the other
 * unauthenticated paths run with no company in scope, and a seam that threw there would turn
 * an ordinary state into an error every caller had to catch.
 */
@Injectable()
export class CompanyRecord implements CompanyDirectory {
  constructor(@InjectPrisma() private readonly prisma: ScopedPrisma) {}

  async ownerUserId(): Promise<string | null> {
    const company = await this.prisma.company.findFirst().catch(() => null);
    return company?.ownerUserId ?? null;
  }

  async mailAccount(): Promise<CompanyMailAccount | null> {
    const company = await this.prisma.company.findFirst().catch(() => null);
    if (!company) return null;

    return {
      fromAddress: company.mailFromAddress ?? null,
      fromName: company.mailFromName ?? null,
      smtpHost: company.mailSmtpHost ?? null,
      smtpPort: company.mailSmtpPort ?? null,
      smtpSecure: company.mailSmtpSecure ?? null,
      smtpUsername: company.mailSmtpUsername ?? null,
      smtpPassword: company.mailSmtpPassword ?? null,
    };
  }

  async saveMailAccount(account: CompanyMailAccount): Promise<void> {
    // `updateMany` rather than `update`: there is exactly one row in scope and no id to hand,
    // and a company that does not exist should write nothing rather than throw at a caller
    // who was only saving settings.
    await this.prisma.company
      .updateMany({
        data: {
          mailFromAddress: account.fromAddress,
          mailFromName: account.fromName,
          mailSmtpHost: account.smtpHost,
          mailSmtpPort: account.smtpPort,
          mailSmtpSecure: account.smtpSecure,
          mailSmtpUsername: account.smtpUsername,
          mailSmtpPassword: account.smtpPassword,
        },
      })
      .catch(() => undefined);
  }
}
