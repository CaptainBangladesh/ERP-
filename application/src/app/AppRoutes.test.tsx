import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { AUTH_PATHS, ERROR_CODES, NAVIGATION_PATH } from '@erp/shared';
import { server } from '../test/server';
import { renderPage } from '../test/render';
import { AppRoutes } from './AppRoutes';

const SESSION = {
  user: { id: 'u1', name: 'Ada Okafor', email: 'ada@northwind.test', isOwner: true },
  company: { id: 'c1', name: 'Northwind Trading', tier: 'core' },
  expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  permissions: 'all',
};

/**
 * The signed-in home screen, and the two ways of ending up somewhere else.
 *
 * Rendered through the real route table, which is assembled from the module manifests —
 * so this also exercises a screen being reachable because its module declared it, rather
 * than because a central list mentioned it.
 */
describe('AppRoutes', () => {
  function signedIn() {
    server.use(
      http.get(AUTH_PATHS.session, () => HttpResponse.json(SESSION)),
      http.get(NAVIGATION_PATH, () =>
        HttpResponse.json({
          entries: [{ module: 'identity', label: 'Home', path: '/', order: 0 }],
        }),
      ),
    );
  }

  it('shows the signed-in user, their company, and the navigation', async () => {
    signedIn();

    renderPage(<AppRoutes />, { token: 'a-token', path: '/' });

    expect(await screen.findByRole('heading', { name: /welcome, ada okafor/i })).toBeInTheDocument();
    expect(screen.getByText(/signed in to northwind trading/i)).toBeInTheDocument();

    // Assembled from the manifests on the server, not listed by the client.
    const nav = await screen.findByRole('navigation', { name: /main/i });
    expect(await screen.findByRole('link', { name: 'Home' })).toBeInTheDocument();
    expect(nav).toHaveTextContent('Home');
  });

  /**
   * The menu differs by tier and by role, and the difference is entirely the server's: this
   * screen renders whatever `GET /api/navigation` answered with and filters nothing.
   *
   * That is the property worth pinning. A client that decided for itself which entries to show
   * would be a client that could be talked into showing one — so these two cases send the same
   * user to the same screen and change only what the server said.
   */
  it('renders whatever menu the server assembled for this caller, and no more', async () => {
    // A Core-tier colleague holding only parties:read. No People entry, because hrm is
    // Enterprise; no Roles entry, because they do not hold identity:roles:read.
    server.use(
      http.get(AUTH_PATHS.session, () => HttpResponse.json(SESSION)),
      http.get(NAVIGATION_PATH, () =>
        HttpResponse.json({
          entries: [
            { module: 'identity', label: 'Home', path: '/', order: 0 },
            { module: 'parties', label: 'Parties', path: '/parties', order: 10 },
          ],
        }),
      ),
    );

    renderPage(<AppRoutes />, { token: 'a-token', path: '/' });

    const nav = await screen.findByRole('navigation', { name: /main/i });
    await waitFor(() => expect(nav).toHaveTextContent('Parties'));
    expect(nav).not.toHaveTextContent('People');
    expect(nav).not.toHaveTextContent('Roles');
  });

  it('shows the entries an enterprise-tier owner reaches that a core-tier colleague does not', async () => {
    server.use(
      http.get(AUTH_PATHS.session, () =>
        HttpResponse.json({ ...SESSION, company: { ...SESSION.company, tier: 'enterprise' } }),
      ),
      http.get(NAVIGATION_PATH, () =>
        HttpResponse.json({
          entries: [
            { module: 'identity', label: 'Home', path: '/', order: 0 },
            { module: 'hrm', label: 'People', path: '/hrm/employees', order: 20 },
            { module: 'identity', label: 'Roles', path: '/roles', order: 91 },
          ],
        }),
      ),
    );

    renderPage(<AppRoutes />, { token: 'a-token', path: '/' });

    const nav = await screen.findByRole('navigation', { name: /main/i });
    await waitFor(() => expect(nav).toHaveTextContent('People'));
    expect(nav).toHaveTextContent('Roles');
  });

  it('signs out and returns to sign-in', async () => {
    signedIn();
    let signedOut = false;
    server.use(
      http.post(AUTH_PATHS.signOut, () => {
        signedOut = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );

    const { user } = renderPage(<AppRoutes />, { token: 'a-token', path: '/' });
    await screen.findByRole('heading', { name: /welcome, ada okafor/i });

    await user.click(screen.getByRole('button', { name: /sign out/i }));

    // Told to the server, so the session is withdrawn rather than merely forgotten here.
    await waitFor(() => expect(signedOut).toBe(true));
    await waitFor(() => expect(window.location.pathname).toBe('/sign-in'));
    expect(await screen.findByRole('heading', { name: /^sign in$/i })).toBeInTheDocument();
  });

  it('sends an unauthenticated visitor to sign-in rather than showing them nothing', async () => {
    server.use(
      http.get(AUTH_PATHS.session, () =>
        HttpResponse.json(
          { code: ERROR_CODES.unauthenticated, message: 'Sign in to continue.' },
          { status: 401 },
        ),
      ),
    );

    renderPage(<AppRoutes />, { path: '/' });

    expect(await screen.findByRole('heading', { name: /^sign in$/i })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/sign-in');
  });

  it('returns an expired session to sign-in and says why', async () => {
    server.use(
      http.get(AUTH_PATHS.session, () =>
        HttpResponse.json(
          {
            code: ERROR_CODES.sessionExpired,
            message: 'Your session has expired. Please sign in again.',
          },
          { status: 401 },
        ),
      ),
    );

    // A returning user whose stored token has run out. Failing silently — a blank screen,
    // or an endless spinner — is the outcome this exists to rule out.
    renderPage(<AppRoutes />, { token: 'a-stale-token', path: '/' });

    expect(await screen.findByRole('heading', { name: /^sign in$/i })).toBeInTheDocument();
    expect(await screen.findByRole('status')).toHaveTextContent(/session expired/i);
  });

  it('returns to sign-in when a session expires part-way through using the app', async () => {
    // The restore succeeds — this user was signed in — and the very next request is
    // refused. That is what expiry actually looks like: it happens during whatever you
    // were doing, not when the application asks who you are.
    server.use(
      http.get(AUTH_PATHS.session, () => HttpResponse.json(SESSION)),
      http.get(NAVIGATION_PATH, () =>
        HttpResponse.json(
          {
            code: ERROR_CODES.sessionExpired,
            message: 'Your session has expired. Please sign in again.',
          },
          { status: 401 },
        ),
      ),
    );

    renderPage(<AppRoutes />, { token: 'a-token', path: '/' });

    // Watching only the session query would leave the user on a home screen with an empty
    // menu, clicking around an application that has quietly stopped working.
    expect(await screen.findByRole('heading', { name: /^sign in$/i })).toBeInTheDocument();
    expect(await screen.findByRole('status')).toHaveTextContent(/session expired/i);
    expect(window.location.pathname).toBe('/sign-in');
  });

  it('lets somebody with no session reach sign-up', async () => {
    renderPage(<AppRoutes />, { path: '/sign-up' });

    // The one door into an empty system has to open without a key.
    expect(
      await screen.findByRole('heading', { name: /create your company/i }),
    ).toBeInTheDocument();
  });

  it('says so when a path belongs to no module', async () => {
    signedIn();

    renderPage(<AppRoutes />, { token: 'a-token', path: '/inventory' });

    expect(await screen.findByRole('heading', { name: /page not found/i })).toBeInTheDocument();
  });
});
