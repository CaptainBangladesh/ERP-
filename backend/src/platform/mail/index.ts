/**
 * The one seam anything sends email through. Identity is the only consumer today —
 * invitations and password resets — and any later module needing to send mail reaches for the
 * same `Mailer`, never a provider of its own.
 */
export { Mailer, type MailMessage } from './mailer';
export { DevMailer } from './dev-mailer';
export { SmtpMailer } from './smtp-mailer';
export { DeploymentMailer } from './deployment-mailer';
export { UnconfiguredMailer } from './unconfigured-mailer';
export { MailModule } from './mail.module';
export { SMTP_TIMEOUTS } from './smtp-timeouts';
export {
  checkRelayReachable,
  isSmtpRelayConfigured,
  sendThroughRelay,
  smtpRelayUrl,
  verifyThroughRelay,
  type SmtpRelayConfig,
  type SmtpRelayFailure,
  type SmtpRelayMessage,
} from './smtp-relay';
export { isNameResolutionFailure, isUnreachableMailHost } from './smtp-failure';
export { describeResendSenderProblem } from './resend-sender-check';
