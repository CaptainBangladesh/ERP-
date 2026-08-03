import { SetMetadata } from '@nestjs/common';

export const NO_PERMISSION_KEY = 'erp:no-permission-required';

/**
 * A handler that needs a session and nothing more specific.
 *
 * Rare and explicit, in the same spirit as `@Public()` and `withoutCompanyScope`: a handler
 * with no declared permission would otherwise be indistinguishable from one somebody forgot to
 * guard, so this costs a written reason and is greppable across every module. `GET
 * /api/auth/session`, `POST /api/auth/sign-out` and `GET /api/navigation` are today's uses —
 * asking who you are, ending your own session, and reading a menu that is filtered internally
 * rather than gated as a whole.
 */
export const NoPermissionRequired = (reason: string): MethodDecorator =>
  SetMetadata(NO_PERMISSION_KEY, reason);
