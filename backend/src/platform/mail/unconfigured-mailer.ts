import { HttpStatus, Injectable } from '@nestjs/common';
import { ERROR_CODES } from '@erp/shared';
import { ApiException } from '../../http/api-exception';
import { Mailer, type MailMessage } from './mailer';

/**
 * The `Mailer` bound in production when no SMTP host is configured: it refuses.
 *
 * `DevMailer` records a message to an array and logs it, which is exactly right for a
 * developer and for the suite — a test recovers the reset link from `sent`. What it must not
 * be is the mailer a deployment quietly falls back to. Nothing downstream can tell the two
 * apart: `send` resolves, the CRM reports "Email sent", a timeline activity is written saying
 * so, and the customer never hears from anybody. A password reset disappears the same way.
 *
 * Refusing turns that into a failure at the moment of sending, naming the missing
 * configuration, which is a problem an operator can act on. It is the same choice made for
 * Google sign-in and for mailbox connections: a system that cannot do the thing says so,
 * rather than reporting success it has no basis for.
 */
@Injectable()
export class UnconfiguredMailer extends Mailer {
  async send(_message: MailMessage): Promise<void> {
    throw new ApiException(
      ERROR_CODES.moduleUnavailable,
      'Email is not configured on this server, so nothing was sent. Set SMTP_HOST and its ' +
        'credentials to enable sending.',
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }
}
