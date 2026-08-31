import { Injectable } from '@nestjs/common';
import type { CompanyMailSettingsResponse, UpdateCompanyMailSettingsRequest } from '@erp/shared';
import { decryptSmtpPassword, encryptSmtpPassword } from '../../platform/secrets';
import { InjectPrisma, type ScopedPrisma } from '../../platform/tenancy';
import { mailPasswordRequired } from './errors';
import { MailHostVerifier } from './mail-host-verifier';

/** The settings a send actually needs, with the password decrypted for immediate use. */
export interface CompanySmtpSettings {
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password: string;
  fromAddress: string;
  fromName?: string;
}

/**
 * A company's own outgoing mail, read and written by the people who run that company.
 *
 * Identity owns `Company`, so these settings live here — and identity is also the only thing
 * that sends system mail, which is what makes `CompanyMailer` its neighbour rather than a
 * port on the platform.
 *
 * Configuring mail here rather than in the server's environment is the point: an owner can
 * fix a wrong password from a screen, and the next invitation uses it. Nothing is cached and
 * nothing needs restarting.
 */
@Injectable()
export class CompanyMailService {
  constructor(
    @InjectPrisma() private readonly prisma: ScopedPrisma,
    private readonly verifier: MailHostVerifier,
  ) {}

  /**
   * What the platform asks for on the way to sending.
   *
   * Answers `null` — not an error — whenever this company has not configured mail, or there
   * is no company in scope at all. Password reset runs for somebody who is not signed in, so
   * that second case is ordinary rather than exceptional, and the deployment's own mail
   * configuration takes over.
   */
  async forCurrentCompany(): Promise<CompanySmtpSettings | null> {
    const company = await this.prisma.company.findFirst().catch(() => null);

    if (!company?.mailSmtpHost || !company.mailSmtpPassword || !company.mailFromAddress) {
      return null;
    }

    return {
      host: company.mailSmtpHost,
      port: company.mailSmtpPort ?? 587,
      secure: company.mailSmtpSecure ?? false,
      username: company.mailSmtpUsername || company.mailFromAddress,
      password: decryptSmtpPassword(company.mailSmtpPassword),
      fromAddress: company.mailFromAddress,
      fromName: company.mailFromName ?? undefined,
    };
  }

  /** The decrypted settings this company sends through, or null when it has configured none. */
/** What the settings screen shows. Never the password — there is no route that returns it. */
  async settings(): Promise<CompanyMailSettingsResponse> {
    const company = await this.prisma.company.findFirstOrThrow();

    return {
      configured: Boolean(company.mailSmtpHost && company.mailSmtpPassword),
      fromAddress: company.mailFromAddress ?? '',
      fromName: company.mailFromName ?? '',
      host: company.mailSmtpHost ?? '',
      port: company.mailSmtpPort ?? 465,
      secure: company.mailSmtpSecure ?? true,
      username: company.mailSmtpUsername ?? '',
    };
  }

  /**
   * Saves settings, having first proved them against the mail host.
   *
   * Proved before stored, for the same reason a mailbox connection is: the alternative is a
   * screen that says mail is configured and an invitation that vanishes, with the failure
   * arriving somewhere nobody is looking. If the host will not accept these details, nothing
   * is written and the message is what the host actually said.
   *
   * The password may be omitted on an update, which means "keep the one already stored" —
   * otherwise editing the sender's name would require typing the password again, and a form
   * that demands a password to change an unrelated field is a form people paste secrets into.
   */
  async update(input: UpdateCompanyMailSettingsRequest): Promise<CompanyMailSettingsResponse> {
    const company = await this.prisma.company.findFirstOrThrow();

    const password = input.password
      ? encryptSmtpPassword(input.password)
      : company.mailSmtpPassword;

    if (!password) throw mailPasswordRequired();

    await this.verifier.verify({
      host: input.host.trim(),
      port: input.port,
      secure: input.secure,
      username: input.username.trim() || input.fromAddress.trim(),
      password: decryptSmtpPassword(password),
    });

    await this.prisma.company.update({
      where: { id: company.id },
      data: {
        mailFromAddress: input.fromAddress.trim(),
        mailFromName: input.fromName?.trim() || null,
        mailSmtpHost: input.host.trim(),
        mailSmtpPort: input.port,
        mailSmtpSecure: input.secure,
        mailSmtpUsername: input.username.trim() || input.fromAddress.trim(),
        mailSmtpPassword: password,
      },
    });

    return this.settings();
  }

  /** Stops using this company's own mail, falling back to the deployment's. */
  async clear(): Promise<CompanyMailSettingsResponse> {
    const company = await this.prisma.company.findFirstOrThrow();

    await this.prisma.company.update({
      where: { id: company.id },
      data: {
        mailFromAddress: null,
        mailFromName: null,
        mailSmtpHost: null,
        mailSmtpPort: null,
        mailSmtpSecure: null,
        mailSmtpUsername: null,
        mailSmtpPassword: null,
      },
    });

    return this.settings();
  }
}
