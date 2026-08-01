import { HttpStatus } from '@nestjs/common';
import { ERROR_CODES } from '@erp/shared';
import { ApiException } from '../../http/api-exception';

/**
 * One refusal for every way of arriving without a usable session.
 *
 * The guard raises it for a request with no token; identity raises it for a token that is
 * unreadable, unknown, or withdrawn. They deliberately produce the same answer: a caller who
 * is not signed in cannot act on the difference, and spelling it out tells a prober more
 * than it tells a user.
 *
 * It lives here rather than in either caller so the two cannot drift into two different
 * messages for one situation.
 *
 * Expiry is the one distinction worth making, and identity raises that itself — it is the
 * only thing that knows a session was once real.
 */
export function unauthenticated(): ApiException {
  return new ApiException(
    ERROR_CODES.unauthenticated,
    'Sign in to continue.',
    HttpStatus.UNAUTHORIZED,
  );
}
