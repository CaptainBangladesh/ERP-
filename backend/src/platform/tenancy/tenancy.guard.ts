import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { SESSION_REQUEST_KEY, type RequestSession } from '../auth';
import { Tenancy } from './tenancy';

/**
 * Establishes the acting company, once, from the session.
 *
 * Registered after `SessionGuard`, which is what makes it work: guards run in the order they
 * are provided, so by the time this one is asked the session is on the request. It never
 * refuses anything — it is a guard because that is where in a Nest request the answer first
 * exists, not because it decides anything.
 *
 * A request with no session leaves the scope empty rather than failing here. `@Public()`
 * routes are exactly that case and they are legitimate; what makes it safe is that a query
 * against a company-owned table with no company throws, so the failure lands on the query
 * that should not have been possible rather than on the route that was allowed to be
 * anonymous.
 */
@Injectable()
export class TenancyGuard implements CanActivate {
  constructor(private readonly tenancy: Tenancy) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Record<string, unknown>>();
    const session = request[SESSION_REQUEST_KEY] as RequestSession | undefined;

    if (session) {
      this.tenancy.enter({
        companyId: session.company.id,
        /**
         * `session.permissions` is already `'all'` for the owner and the union of every role
         * they hold for anybody else — identity resolves it once, in `authenticate()`, from
         * the real `Role`/`RolePermission` tables. This one line is what ADR 0003 and
         * `tenancy.ts` both earmarked for this ticket; nothing else in the tenancy platform
         * changed to make it real.
         */
        grants: session.permissions === 'all' ? 'all' : new Set(session.permissions),
      });
    }

    return true;
  }
}
