/** Exported so the test harness can arrange a returning user without duplicating it. */
export const SESSION_TOKEN_STORAGE_KEY = 'erp.session.token';

/**
 * Where a session survives a page reload.
 *
 * `localStorage` rather than a cookie because the API authenticates with a bearer header
 * and takes no cookies at all, which is what makes it immune to CSRF without a token dance.
 * The trade is exposure to XSS — worth taking only because the frontend ships no
 * third-party markup or CSS by rule, so there is no vendor script to be the vector.
 *
 * Every read is guarded: a browser with storage disabled, or a private window that refuses
 * it, should mean "not signed in", never a blank screen.
 */
export function readStoredToken(): string | undefined {
  try {
    return window.localStorage.getItem(SESSION_TOKEN_STORAGE_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

export function writeStoredToken(token: string | undefined): void {
  try {
    if (token) window.localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, token);
    else window.localStorage.removeItem(SESSION_TOKEN_STORAGE_KEY);
  } catch {
    // A session that cannot be remembered is still a session that works until reload.
  }
}
