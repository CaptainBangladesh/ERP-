/**
 * The one error shape every endpoint returns.
 *
 * Ticket 04 formalises this across all modules and adds the per-field validation
 * breakdown. It lives here from ticket 01 so the skeleton's client already handles
 * errors the way every later screen will.
 */
export interface ApiError {
  /** Machine-readable, stable across releases. Clients branch on this, never on `message`. */
  code: string;
  /** Human-readable. Safe to show a user. */
  message: string;
}

export function isApiError(value: unknown): value is ApiError {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.code === 'string' && typeof candidate.message === 'string';
}
