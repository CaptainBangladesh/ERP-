/**
 * The one error shape every endpoint returns.
 *
 * Ticket 04 formalises this across all modules and replaces the hand-written validation in
 * identity with a pipe that produces the same shape. The shape itself is settled here
 * because sign-up already needs a form to bind messages to the offending inputs, and a
 * screen written against a different shape would have to be rewritten later.
 */
export interface ApiError {
  /** Machine-readable, stable across releases. Clients branch on this, never on `message`. */
  code: string;
  /** Human-readable. Safe to show a user. */
  message: string;
  /**
   * Present only on validation failures. Maps a request field name to the message that
   * belongs beside that input. A form renders these against its fields; anything else
   * ignores them and shows `message`.
   */
  fields?: Record<string, string>;
}

export function isApiError(value: unknown): value is ApiError {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.code === 'string' && typeof candidate.message === 'string';
}

/**
 * The error codes every module shares.
 *
 * Only codes the platform itself raises, on behalf of modules that do not exist yet. A
 * module's own refusals — "that email is already registered", "that SKU exists" — belong in
 * that module's contract, or this file becomes the dumping ground the shared package rule
 * exists to prevent.
 *
 * `session_expired` is distinct from `unauthenticated` because the two mean different things
 * to a user: one has been signed in and was timed out, the other never signed in, and only
 * the first warrants telling them their session ended.
 */
export const ERROR_CODES = {
  unauthenticated: 'unauthenticated',
  sessionExpired: 'session_expired',
  validationFailed: 'validation_failed',
  /**
   * A caller named a field they may not read — in a sort, in a filter, or in a search.
   *
   * Distinct from `validation_failed` because the request was not malformed: the field is
   * real and the endpoint does sort by it, for somebody with the grant. Telling this caller
   * it was an invalid field name would be a refusal disguised as a typo. ADR 0004.
   */
  fieldRestricted: 'field_restricted',
  /**
   * A caller is signed in but lacks the specific permission a handler requires. Ticket 07's
   * `AccessGuard` raises this; distinct from `field_restricted` because nothing here was named
   * in a query string — the whole action was refused.
   */
  forbidden: 'forbidden',
  /**
   * The endpoint belongs to a module the caller's company tier does not reach. Distinct from
   * `forbidden`: the caller might hold the permission outright and still be refused, because
   * the module itself is not part of their plan.
   */
  moduleUnavailable: 'module_unavailable',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

/** True for the two codes that mean "this session cannot be used", whatever the reason. */
export function isAuthenticationFailure(code: string): boolean {
  return code === ERROR_CODES.unauthenticated || code === ERROR_CODES.sessionExpired;
}
