import type { Session } from '../../session/principal.js';

/**
 * The identity module's wire contract: its paths, its request bodies, its responses, and
 * the codes it refuses with.
 *
 * Wire shapes and the constants both sides must agree on — no rules, no tables, no screens.
 * The behaviour behind these types lives entirely in `backend/src/modules/identity`.
 *
 * What a *signed-in caller* is does not live here: that is `session/principal.ts`, because
 * every module sees a caller and only this one knows how to authenticate.
 */

export const IDENTITY_MODULE = 'identity';

/** No leading slash — Nest composes controller prefixes. */
export const AUTH_ROUTE = 'api/auth';

export const AUTH_PATHS = {
  signUp: `/${AUTH_ROUTE}/sign-up`,
  signIn: `/${AUTH_ROUTE}/sign-in`,
  signOut: `/${AUTH_ROUTE}/sign-out`,
  /** Who the bearer of this token is. The frontend calls it to restore a stored session. */
  session: `/${AUTH_ROUTE}/session`,
} as const;

export interface SignUpRequest {
  companyName: string;
  name: string;
  email: string;
  password: string;
}

export interface SignInRequest {
  email: string;
  password: string;
}

/** Sign-up and sign-in hand back the token that authenticates later calls. */
export interface AuthenticatedSession extends Session {
  token: string;
}

/**
 * The refusals only this module can produce, so a screen can branch on them without the
 * shared package accumulating one module's vocabulary.
 *
 * The codes every module shares — `unauthenticated`, `session_expired`, `validation_failed`
 * — are in `http/error.ts`, because the platform raises them on behalf of modules that do
 * not exist yet.
 */
export const IDENTITY_ERROR_CODES = {
  invalidCredentials: 'invalid_credentials',
  emailAlreadyRegistered: 'email_already_registered',
} as const;

/**
 * Shared because the form's hint and the server's rule must be the same number. The rule
 * itself is enforced only on the server.
 */
export const PASSWORD_MIN_LENGTH = 12;
