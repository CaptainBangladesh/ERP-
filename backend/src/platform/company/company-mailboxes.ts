import { Injectable } from '@nestjs/common';
import { InjectPrisma, Tenancy, type ScopedPrisma } from '../tenancy';
import type { CompanyMailAccount } from './company-directory';

/**
 * Every company's own mailbox, visited one tenant at a time — for a background job that has to
 * act across companies with nobody signed in.
 *
 * Separate from `CompanyDirectory` on purpose. That seam answers about the *one* company in
 * scope and is deliberately narrow; this one spans every tenant and exists for a single caller,
 * the inbound-reply poll, which runs on a schedule and has to find the mailboxes to read before
 * there is a company to read them as.
 *
 * It hands back a callback frame rather than a list of companies, and that is the point: the
 * cross-tenant enumeration *and* the re-entry into each company's own scope both live here, so
 * a caller only ever sees "the company in scope" and never writes a company filter of its own —
 * which is exactly the line the conformance pack draws for a business module.
 */
export abstract class CompanyMailboxes {
  /**
   * Runs `visit` once for every company that has configured outgoing mail, each call inside
   * that company's own tenant frame. A company with no host configured has no mailbox to read
   * and is skipped rather than visited with nothing.
   */
  abstract forEach(visit: (mailAccount: CompanyMailAccount) => Promise<void>): Promise<void>;
}

@Injectable()
export class CompanyMailboxesRecord extends CompanyMailboxes {
  constructor(
    @InjectPrisma() private readonly prisma: ScopedPrisma,
    private readonly tenancy: Tenancy,
  ) {
    super();
  }

  async forEach(visit: (mailAccount: CompanyMailAccount) => Promise<void>): Promise<void> {
    /**
     * The one read that has to cross tenants — nobody is signed in when the poll runs — so it
     * is a *named* suspension, the same shape marketing's schedulers use, and it shows up in
     * the tenancy audit as exactly what it is. Only companies with a host and a stored password
     * are returned: the rest have nothing to poll.
     */
    const companies = await this.tenancy.withoutCompanyScope(
      'mail.poll.enumerate-company-mailboxes',
      () =>
        this.prisma.company.findMany({
          where: { mailSmtpHost: { not: null }, mailSmtpPassword: { not: null } },
          select: {
            id: true,
            mailFromAddress: true,
            mailFromName: true,
            mailSmtpHost: true,
            mailSmtpPort: true,
            mailSmtpSecure: true,
            mailSmtpUsername: true,
            mailSmtpPassword: true,
          },
        }),
    );

    for (const company of companies) {
      const account: CompanyMailAccount = {
        fromAddress: company.mailFromAddress ?? null,
        fromName: company.mailFromName ?? null,
        smtpHost: company.mailSmtpHost ?? null,
        smtpPort: company.mailSmtpPort ?? null,
        smtpSecure: company.mailSmtpSecure ?? null,
        smtpUsername: company.mailSmtpUsername ?? null,
        smtpPassword: company.mailSmtpPassword ?? null,
      };

      await this.tenancy.runInCompany({ companyId: company.id, grants: 'all' }, () =>
        visit(account),
      );
    }
  }
}
