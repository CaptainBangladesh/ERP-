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

/**
 * Storage a module keeps *about the signed-in person*, cleared when they sign out.
 *
 * The session itself lives in `localStorage` (see above), so a second person signing in on the
 * same machine already inherits nothing of the first one's session — but they would inherit
 * every preference a module had stored, and at least one of those is not a preference. Marketing
 * remembers which client brand the composer is pointed at, and that choice selects *whose social
 * credentials get used*; the wrong one surviving a sign-out is the module's worst outcome
 * reached by the dullest possible route.
 *
 * Listed here rather than discovered by pattern, so adding a prefix is a deliberate act and
 * reading this file tells you everything that gets wiped.
 */
export const USER_SCOPED_STORAGE_PREFIXES = ['marketing:'];

export function clearUserScopedStorage(): void {
  try {
    const doomed = Object.keys(window.localStorage).filter((key) =>
      USER_SCOPED_STORAGE_PREFIXES.some((prefix) => key.startsWith(prefix)),
    );
    for (const key of doomed) window.localStorage.removeItem(key);
  } catch {
    // Storage refused is storage that held nothing to clear.
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
