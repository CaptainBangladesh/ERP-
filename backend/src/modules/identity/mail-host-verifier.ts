import { Injectable } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import {
  SMTP_TIMEOUTS,
  describeResendSenderProblem,
  isSmtpRelayConfigured,
  verifyThroughRelay,
} from '../../platform/mail';
import { mailSettingsRejected } from './errors';

/** Enough to open a connection and authenticate, before anything is stored. */
export interface MailHostCredentials {
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password: string;
  /**
   * The address mail will claim to be from, which is not always the account it authenticates
   * as. Needed because an HTTPS sender like Resend accepts or refuses on the strength of the
   * *sender's* domain, so proving the login says nothing about whether a send will work.
   */
  fromAddress?: string;
}

/**
 * Proving a company's mail settings by using them.
 *
 * A seam because the suite has no mail host to reach, and because "these settings work" is
 * exactly the claim that must not be assumed: settings accepted on trust turn into a screen
 * that says mail is configured and invitations that quietly never arrive.
 */
export abstract class MailHostVerifier {
  abstract verify(credentials: MailHostCredentials): Promise<void>;
}

@Injectable()
export class SmtpMailHostVerifier extends MailHostVerifier {
  async verify(credentials: MailHostCredentials): Promise<void> {
    if (isSmtpRelayConfigured()) {
      try {
        await verifyThroughRelay(credentials);
        return;
      } catch (cause) {
        throw mailSettingsRejected(cause instanceof Error ? cause.message : String(cause));
      }
    }

    // Resend never uses these SMTP credentials, so connecting with them would prove nothing.
    // Whether a send works turns on the sender's domain being verified with Resend, so that
    // is what gets checked — proving only the API key is what let a company save settings
    // that were accepted here and refused at the first real send.
    if (process.env.RESEND_API_KEY) {
      const problem = await describeResendSenderProblem(
        process.env.RESEND_API_KEY,
        credentials.fromAddress || credentials.username,
      );
      if (problem) throw mailSettingsRejected(problem);
      return;
    }

    const transport = nodemailer.createTransport({
      host: credentials.host,
      port: credentials.port,
      secure: credentials.secure,
      auth: { user: credentials.username, pass: credentials.password },
      ...SMTP_TIMEOUTS,
    });

    try {
      await transport.verify();
    } catch (cause) {
      throw mailSettingsRejected(cause instanceof Error ? cause.message : String(cause));
    } finally {
      transport.close();
    }
  }
}

/**
 * The verifier under test. Accepts anything but one designated password, so that "the host
 * said no" is exercised without a host to say it.
 */
@Injectable()
export class StubMailHostVerifier extends MailHostVerifier {
  static readonly REJECTED_PASSWORD = 'wrong-password';

  async verify(credentials: MailHostCredentials): Promise<void> {
    if (credentials.password === StubMailHostVerifier.REJECTED_PASSWORD) {
      throw mailSettingsRejected('535 Authentication failed');
    }
  }
}
