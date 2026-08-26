import { render, type RenderResult } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { http, HttpResponse } from 'msw';
import { AUTH_PATHS, type ModuleTier } from '@erp/shared';
import { AppProviders, createQueryClient } from '../providers/AppProviders';
import { setAuthToken } from '../api/client';
import { SESSION_TOKEN_STORAGE_KEY } from '../session/token-storage';
import { server } from './server';

export interface RenderOptions {
  /**
   * Starts the test with a session already stored, as a returning user has. The screen
   * still asks the API who the bearer is, so a test using this must handle
   * `GET /api/auth/session`.
   */
  token?: string;
  /** The path the browser is on. Defaults to `/`. */
  path?: string;
}

/**
 * Renders a page inside the same providers the real application uses, with a fresh query
 * cache per test so no state leaks between cases.
 *
 * Every later module's screens are tested through this. Assert on rendered output and user
 * interaction — never on hooks or component state.
 */
/**
 * Answers `GET /api/auth/session` as somebody holding the given permissions.
 *
 * A screen that hides a control the caller may not use has to be told what they hold, and
 * every such test needs the same three lines. Here rather than copied per file so that a
 * change to the session shape is one edit — the same reasoning `renderPage` itself follows.
 *
 * Pair it with `renderPage(…, { token })`: the token is what makes the application *ask*.
 */
export function signedInWith(
  permissions: 'all' | string[] = 'all',
  overrides: { isOwner?: boolean; tier?: ModuleTier } = {},
): void {
  server.use(
    http.get(AUTH_PATHS.session, () =>
      HttpResponse.json({
        user: {
          id: 'u1',
          name: 'Ada Okafor',
          email: 'ada@northwind.test',
          isOwner: overrides.isOwner ?? false,
        },
        company: { id: 'c1', name: 'Northwind Trading', tier: overrides.tier ?? 'core' },
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
        permissions,
      }),
    ),
  );
}

export function renderPage(
  ui: ReactElement,
  { token, path = '/' }: RenderOptions = {},
): RenderResult & { user: ReturnType<typeof userEvent.setup> } {
  window.history.replaceState(null, '', path);

  // Both halves, because the application keeps both: storage is what survives a reload,
  // and the client's copy is what goes out on the next request.
  if (token) window.localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, token);
  else window.localStorage.removeItem(SESSION_TOKEN_STORAGE_KEY);
  setAuthToken(token);

  // No retries under test: every response here is deterministic, so a retry only makes the
  // suite slower and a deliberate failure take four round trips to arrive.
  const client = createQueryClient(0);
  const user = userEvent.setup();

  const result = render(<AppProviders client={client}>{ui}</AppProviders>);

  return { ...result, user };
}
