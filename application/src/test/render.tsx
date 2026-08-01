import { render, type RenderResult } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { AppProviders, createQueryClient } from '../providers/AppProviders';
import { setAuthToken } from '../api/client';
import { SESSION_TOKEN_STORAGE_KEY } from '../session/token-storage';

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

  const client = createQueryClient();
  const user = userEvent.setup();

  const result = render(<AppProviders client={client}>{ui}</AppProviders>);

  return { ...result, user };
}
