import type { RequestSession } from './session-context';

/**
 * Whatever module can turn a token into a caller.
 *
 * The platform guards every endpoint but does not know how authentication works; identity
 * knows how authentication works but must not be something the platform imports. This
 * abstract class is the seam between them: it is the injection token and the interface at
 * once, identity binds an implementation to it, and the guard depends on neither the module
 * nor its internals.
 *
 * That is also what lets the application boot without identity present. Nothing is bound,
 * the guard finds no authority, and every non-public endpoint refuses — which is the right
 * failure, because an application with no way to authenticate should not be serving
 * authenticated requests.
 */
export abstract class SessionAuthority {
  /**
   * Resolves the caller, or throws an `ApiException` naming why not: `unauthenticated` for
   * a token that is absent, malformed, unknown, or withdrawn, and `session_expired` for one
   * that was valid and has run out.
   */
  abstract authenticate(token: string): Promise<RequestSession>;
}
