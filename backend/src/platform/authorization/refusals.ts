import { HttpStatus } from '@nestjs/common';
import { ERROR_CODES } from '@erp/shared';
import { ApiException } from '../../http/api-exception';

/**
 * A caller who is signed in, and simply may not do this.
 *
 * Not `unauthenticated` — they are somebody, and the system knows exactly who. This is the
 * clear-reason refusal the ticket asks for: a stable code a client can branch on and a message
 * safe to show, rather than a bare 403 somebody has to guess at.
 */
export function forbidden(): ApiException {
  return new ApiException(
    ERROR_CODES.forbidden,
    'You do not have permission to do that.',
    HttpStatus.FORBIDDEN,
  );
}

/**
 * The endpoint belongs to a module this company's tier does not reach.
 *
 * Deliberately not named after the specific module: the message a colleague sees should not
 * teach them what exists beyond their plan, only that this particular action is not part of
 * it — the same reasoning that keeps `forbidden()` from naming the permission it checked.
 */
export function moduleUnavailable(): ApiException {
  return new ApiException(
    ERROR_CODES.moduleUnavailable,
    "This feature is not available on your company's plan.",
    HttpStatus.FORBIDDEN,
  );
}
