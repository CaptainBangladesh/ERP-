import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import { Mailer, type MailMessage } from '../../platform/mail';
import { CompanyMailService } from './company-mail.service';
import { mailSendFailed } from './errors';

/**
 * System mail, sent through the company's own account when it has one.
 *
 * Identity is the only thing in this system that sends on its own behalf — invitations and
 * password resets — so the company-aware layer lives here rather than in the platform. That
 * is not merely convenient: the settings are rows in a table identity owns, and the platform
 * may not read a module's tables. Putting this in `platform/mail` would either break that
 * rule or need a port the global mail module could not resolve anyway.
 *
 * Falling back to the platform `Mailer` is what makes the feature optional. A company that
 * has configured nothing behaves exactly as before, and password reset — which runs for
 * somebody not signed in, with no company in scope — always lands there.
 */
@Injectable()
export class CompanyMailer extends Mailer {
  private readonly logger = new Logger(CompanyMailer.name);

  constructor(
    private readonly settings: CompanyMailService,
    private readonly deploymentMailer: Mailer,
  ) {
    super();
  }

  async send(message: MailMessage): Promise<void> {
    // The suite reads what was sent out of `DevMailer` and has no mail host to reach, so a
    // company's settings must never become a real connection attempt there.
    if (process.env.NODE_ENV === 'test') return this.deploymentMailer.send(message);

    let company: Awaited<ReturnType<CompanyMailService['forCurrentCompany']>>;
    try {
      company = await this.settings.forCurrentCompany();
    } catch (cause) {
      // Reading the settings failed — a decryption failure, or no company in scope. Falling
      // back is still right, but silently is not: this used to be a bare `.catch(() => null)`,
      // which turned every such failure into mail that looked sent and went to a log nobody
      // was reading.
      this.logger.error(
        `Could not read this company's mail settings; using the deployment's mailer instead.`,
        cause instanceof Error ? cause.stack : String(cause),
      );
      return this.deploymentMailer.send(message);
    }

    if (!company) {
      this.logger.log(
        `No company mail configured; sending "${message.subject}" through the deployment's mailer.`,
      );
      return this.deploymentMailer.send(message);
    }

    const transport = nodemailer.createTransport({
      host: company.host,
      port: company.port,
      secure: company.secure,
      auth: { user: company.username, pass: company.password },
    });

    try {
      const receipt = await transport.sendMail({
        from: { name: company.fromName || company.fromAddress, address: company.fromAddress },
        to: message.to,
        subject: message.subject,
        text: message.body,
        html: message.html,
      });

      // What the receiving server said it did with it. The one line that turns "the user says
      // no mail arrived" from a guess into a fact — either it left here or it did not.
      this.logger.log(
        `Sent "${message.subject}" to ${message.to} via ${company.host} — ${receipt.response ?? 'accepted'}`,
      );
    } catch (cause) {
      // Not swallowed and not fallen back from: the company asked for its own mail account,
      // and quietly sending through something else would be a message from the wrong sender.
      this.logger.error(
        `Failed to send "${message.subject}" to ${message.to} via ${company.host}.`,
        cause instanceof Error ? cause.stack : String(cause),
      );
      throw mailSendFailed(cause instanceof Error ? cause.message : String(cause));
    } finally {
      transport.close();
    }
  }
}
