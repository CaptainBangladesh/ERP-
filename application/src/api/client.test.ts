import { describe, expect, it, beforeEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { LEAD_PATHS } from '@erp/shared';
import { server } from '../test/server';
import { api, setAuthToken } from './client';
import { SESSION_TOKEN_STORAGE_KEY } from '../session/token-storage';

/**
 * What the client sends, and whether it survives the module being replaced underneath it.
 */
describe('the api client', () => {
  beforeEach(() => {
    window.localStorage.clear();
    setAuthToken(undefined);
  });

  /** The Authorization header the API actually received, or null. */
  function captureAuthHeader(): { read: () => string | null } {
    let seen: string | null = null;
    server.use(
      http.get(LEAD_PATHS.leads, ({ request }) => {
        seen = request.headers.get('Authorization');
        return HttpResponse.json({ items: [], page: { number: 1, size: 25, total: 0, pages: 0 } });
      }),
    );
    return { read: () => seen };
  }

  it('sends the token it was given', async () => {
    const header = captureAuthHeader();
    setAuthToken('a-token');

    await api.get(LEAD_PATHS.leads);

    expect(header.read()).toBe('Bearer a-token');
  });

  /**
   * A hot module replacement hands the application a fresh copy of this file, whose
   * module-level `authToken` is `undefined` — while React state, and so `SessionProvider`,
   * carries on untouched and never re-supplies it. Clearing the variable without clearing
   * storage is exactly that situation.
   *
   * Before the stored-token fallback, every request after any save in development went out
   * with no Authorization header at all, and the board emptied itself behind a screen still
   * showing the user as signed in.
   */
  it('still authenticates after its module state is wiped by a hot reload', async () => {
    const header = captureAuthHeader();
    window.localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, 'a-token');

    setAuthToken(undefined);

    await api.get(LEAD_PATHS.leads);

    expect(header.read()).toBe('Bearer a-token');
  });

  it('sends nothing once the session has been given up', async () => {
    const header = captureAuthHeader();
    window.localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, 'a-token');
    setAuthToken('a-token');

    // Signing out clears storage first, then the in-memory copy — the order that leaves no
    // window in which the fallback could resurrect a token the user has just given up.
    window.localStorage.removeItem(SESSION_TOKEN_STORAGE_KEY);
    setAuthToken(undefined);

    await api.get(LEAD_PATHS.leads);

    expect(header.read()).toBeNull();
  });
});
