import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import { Mailer, type MailMessage } from './mailer';

/**
 * Sends real internet emails using Nodemailer with SMTP credentials configured via environment variables:
 * - SMTP_HOST (e.g. 'smtp.gmail.com')
 * - SMTP_PORT (e.g. 587 or 465)
 * - SMTP_SECURE ('true' or 'false')
 * - SMTP_USER (e.g. 'your-email@gmail.com')
 * - SMTP_PASS (e.g. Gmail App Password or SMTP password)
 * - SMTP_FROM / MAIL_FROM (e.g. '"Company Sales" <your-email@gmail.com>')
 */
@Injectable()
export class SmtpMailer extends Mailer {
  private readonly logger = new Logger(SmtpMailer.name);
  private transporter: nodemailer.Transporter | null = null;

  constructor() {
    super();
    this.initTransporter();
  }

  private initTransporter(): void {
    const host = process.env.SMTP_HOST;
    const port = Number(process.env.SMTP_PORT || 587);
    const secure = process.env.SMTP_SECURE === 'true' || port === 465;
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;

    if (host) {
      this.transporter = nodemailer.createTransport({
        host,
        port,
        secure,
        auth: user || pass ? { user, pass } : undefined,
      });
      this.logger.log(`SMTP Mailer initialized using ${host}:${port}`);
    }
  }

  async send(message: MailMessage): Promise<void> {
    const from =
      process.env.SMTP_FROM ||
      process.env.MAIL_FROM ||
      process.env.SMTP_USER ||
      'no-reply@company.test';

    if (!this.transporter) {
      this.logger.warn(
        `SMTP Transporter not configured. Message to ${message.to} logged instead:\n${message.body}`,
      );
      return;
    }

    try {
      const info = await this.transporter.sendMail({
        from,
        to: message.to,
        subject: message.subject,
        text: message.body,
        html: message.html || message.body.replace(/\n/g, '<br/>'),
      });
      this.logger.log(`Email sent successfully to ${message.to}. MessageId: ${info.messageId}`);
    } catch (error) {
      this.logger.error(
        `Failed to send email to ${message.to}: ${(error as Error).message}`,
        (error as Error).stack,
      );
      throw error;
    }
  }
}
