import { Injectable } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import { mailSettingsRejected } from './errors';

/** Enough to open a connection and authenticate, before anything is stored. */
export interface MailHostCredentials {
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password: string;
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
    const transport = nodemailer.createTransport({
      host: credentials.host,
      port: credentials.port,
      secure: credentials.secure,
      auth: { user: credentials.username, pass: credentials.password },
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
