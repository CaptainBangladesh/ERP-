import { Logger } from '@nestjs/common';

/**
 * What a deployment must have set, checked once at boot and said plainly.
 *
 * Every variable here has the same shape of failure: the code is correct, the laptop works,
 * and the hosted server does something subtly wrong that only shows up at the moment a user
 * tries something — a Google sign-in that comes back "did not complete", an email that fails
 * with a generic message, a reset link pointing at localhost. None of those name the setting
 * that caused them, and none of them are visible to whoever deployed until somebody reports
 * them.
 *
 * So they are named here instead, at startup, where a deploy log shows them. It warns rather
 * than exits: a running API with mail misconfigured is more useful than no API at all, and a
 * process that refuses to boot over `FRONTEND_URL` would take down every other module with
 * it. Warning is not the same as hiding — the lines below say the variable, what breaks
 * without it, and what to set.
 */
export function reportDeploymentConfiguration(): void {
  const logger = new Logger('DeploymentConfiguration');

  // Development sets none of this and does not need to: every fallback below is a sensible
  // localhost answer. The warnings are only true warnings once this is a deployment.
  if (process.env.NODE_ENV !== 'production') return;

  const problems: string[] = [];

  const sessionSecret = process.env.SESSION_SECRET;
  if (!sessionSecret || sessionSecret.length < 32) {
    problems.push(
      'SESSION_SECRET is unset or shorter than 32 characters, so session tokens are signed ' +
        'with the key committed to the repository and anyone can forge one. Set it to a ' +
        'random 32+ character value.',
    );
  }

  if (!process.env.MAILBOX_SECRET) {
    logger.log(
      'MAILBOX_SECRET is unset, so stored SMTP passwords are encrypted under SESSION_SECRET. ' +
        'Every server sharing this database must hold the same value, and changing it makes ' +
        'existing mailboxes unreadable until they are reconnected.',
    );
  }

  if (!process.env.FRONTEND_URL) {
    problems.push(
      'FRONTEND_URL is unset, so links in outgoing mail and the address a Google sign-in ' +
        'returns to fall back to the request headers or to http://localhost:5173. Set it to ' +
        "the site's own origin, e.g. https://erp-take.web.app.",
    );
  }

  const hasGoogleId = Boolean(process.env.GOOGLE_CLIENT_ID);
  const hasGoogleSecret = Boolean(process.env.GOOGLE_CLIENT_SECRET);
  if (hasGoogleId !== hasGoogleSecret) {
    problems.push(
      'Only one of GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET is set. Signing in with Google ' +
        'needs both, from the same OAuth client, or neither.',
    );
  }

  if (
    hasGoogleId &&
    !process.env.GOOGLE_AUTH_REDIRECT_URI &&
    !process.env.BACKEND_URL &&
    !process.env.RENDER_EXTERNAL_URL
  ) {
    problems.push(
      "Google sign-in is configured but this server cannot tell Google its own address: set " +
        'GOOGLE_AUTH_REDIRECT_URI (or BACKEND_URL) to <this API>/api/auth/google/callback, ' +
        'and register that exact address in the Google project.',
    );
  }

  for (const problem of problems) logger.warn(problem);
}
