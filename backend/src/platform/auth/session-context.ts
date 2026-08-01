import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { SignedInCompany, SignedInUser } from '@erp/shared';

/**
 * Who is making this request.
 *
 * Resolved once by the guard and carried on the request, so a handler never re-reads a
 * token and no two places can disagree about who the caller is. Ticket 03 takes the company
 * from here and pushes it into async local storage, which is what makes tenant scoping
 * automatic rather than remembered.
 */
export interface RequestSession {
  /** The session row this request is authenticated by. Sign-out revokes exactly this one. */
  readonly id: string;
  readonly user: SignedInUser;
  readonly company: SignedInCompany;
  readonly expiresAt: Date;
}

/** Where the guard leaves the resolved session. Read it through `@CurrentSession()`. */
export const SESSION_REQUEST_KEY = 'erpSession';

/**
 * The caller, in a handler's signature.
 *
 * Always populated on a guarded route: the guard refuses the request otherwise, so a
 * handler never has to consider the absent case. On a `@Public()` route it may be
 * undefined, which is why the parameter type there must say so.
 */
export const CurrentSession = createParamDecorator(
  (_data: unknown, context: ExecutionContext): RequestSession | undefined => {
    const request = context.switchToHttp().getRequest<Record<string, unknown>>();
    return request[SESSION_REQUEST_KEY] as RequestSession | undefined;
  },
);
