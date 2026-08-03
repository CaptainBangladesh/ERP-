/**
 * The one seam anything sends email through. Identity is the only consumer today —
 * invitations and password resets — and any later module needing to send mail reaches for the
 * same `Mailer`, never a provider of its own.
 */
export { Mailer, type MailMessage } from './mailer';
export { DevMailer } from './dev-mailer';
export { MailModule } from './mail.module';
