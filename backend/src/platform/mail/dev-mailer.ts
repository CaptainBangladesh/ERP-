import { Injectable, Logger } from '@nestjs/common';
import { Mailer, type MailMessage } from './mailer';

/**
 * The only `Mailer` this system has. Logs every message and keeps it in memory, which is what
 * lets a test recover the invitation or reset link nobody actually sent anywhere: `app.nest.get
 * (DevMailer).sent` is the inbox.
 *
 * `sent` grows for the lifetime of the process — fine for a dev server nobody leaves running
 * for months and for a test app that is torn down between suites, and not something a real
 * provider would ever need to answer for.
 */
@Injectable()
export class DevMailer extends Mailer {
  private readonly logger = new Logger(DevMailer.name);
  private readonly messages: MailMessage[] = [];

  async send(message: MailMessage): Promise<void> {
    this.messages.push(message);
    this.logger.log(`Email to ${message.to}: ${message.subject}\n${message.body}`);
  }

  get sent(): readonly MailMessage[] {
    return this.messages;
  }
}
