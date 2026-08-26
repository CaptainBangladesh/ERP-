import { describe, expect, it, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { AUTH_PATHS, LEAD_PATHS } from '@erp/shared';
import { server } from '../test/server';
import { renderPage } from '../test/render';
import { api } from '../api/client';
import { useSession } from './SessionProvider';
import { SESSION_TOKEN_STORAGE_KEY } from './token-storage';

/**
 * What happens to a session while it is being replaced.
 *
 * A session does not end tidily. It runs out in the middle of whatever somebody is doing,
 * with several requests already in flight, and their refusals keep landing for as long as the
 * network takes — including after the person has signed back in. Everything here is about that
 * overlap, because it is invisible in manual testing: it needs a refusal that is slower than a
 * sign-in, which is a race you cannot reliably click your way into.
 */
describe('SessionProvider', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  /** Shows who the provider currently believes is signed in, and can adopt a new session. */
  function Probe() {
    const { session, adopt } = useSession();

    return (
      <div>
        <span data-testid="who">{session ? session.user.email : 'nobody'}</span>
        <button
          type="button"
          onClick={() =>
            adopt({
              token: 'fresh-token',
              user: { id: 'u1', name: 'Rose Fo', email: 'rose.fo@thenearbuy.com', isOwner: true },
              company: { id: 'c1', name: 'The Near Buy', tier: 'core' },
              expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
              permissions: 'all',
            } as never)
          }
        >
          Sign in
        </button>
        <button type="button" onClick={() => void api.get(LEAD_PATHS.leads).catch(() => undefined)}>
          Load leads
        </button>
      </div>
    );
  }

  it('keeps the new session when a refusal from the old one lands after signing back in', async () => {
    // The old session's request hangs, so its 401 is guaranteed to arrive after the sign-in
    // below — which is exactly the ordering that made a signed-in screen render an empty,
    // unauthenticated board.
    let refuseTheStaleRequest: (() => void) | undefined;
    const staleRefusalSent = new Promise<void>((resolve) => {
      refuseTheStaleRequest = resolve;
    });

    server.use(
      http.get(LEAD_PATHS.leads, async ({ request }) => {
        if (request.headers.get('Authorization') === 'Bearer stale-token') {
          await staleRefusalSent;
          return HttpResponse.json(
            { code: 'unauthenticated', message: 'Sign in to continue.' },
            { status: 401 },
          );
        }
        return HttpResponse.json({ items: [], page: { number: 1, size: 25, total: 0, pages: 0 } });
      }),
      http.get(AUTH_PATHS.session, ({ request }) =>
        request.headers.get('Authorization') === 'Bearer fresh-token'
          ? HttpResponse.json({
              user: { id: 'u1', name: 'Rose Fo', email: 'rose.fo@thenearbuy.com', isOwner: true },
              company: { id: 'c1', name: 'The Near Buy', tier: 'core' },
              expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
              permissions: 'all',
            })
          : HttpResponse.json(
              { code: 'unauthenticated', message: 'Sign in to continue.' },
              { status: 401 },
            ),
      ),
    );

    window.localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, 'stale-token');

    const { user } = renderPage(<Probe />, { token: 'stale-token', path: '/' });

    // A request goes out under the dying session and does not come back yet.
    await user.click(screen.getByRole('button', { name: 'Load leads' }));

    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() =>
      expect(screen.getByTestId('who')).toHaveTextContent('rose.fo@thenearbuy.com'),
    );

    // Now the old session's refusal finally lands.
    refuseTheStaleRequest?.();

    // It must not take the new session down with it.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.getByTestId('who')).toHaveTextContent('rose.fo@thenearbuy.com');
    expect(window.localStorage.getItem(SESSION_TOKEN_STORAGE_KEY)).toBe('fresh-token');
  });

  it('still ends the session when the refusal belongs to the token in use', async () => {
    server.use(
      http.get(AUTH_PATHS.session, () =>
        HttpResponse.json({
          user: { id: 'u1', name: 'Rose Fo', email: 'rose.fo@thenearbuy.com', isOwner: true },
          company: { id: 'c1', name: 'The Near Buy', tier: 'core' },
          expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
          permissions: 'all',
        }),
      ),
      http.get(LEAD_PATHS.leads, () =>
        HttpResponse.json(
          { code: 'unauthenticated', message: 'Sign in to continue.' },
          { status: 401 },
        ),
      ),
    );

    window.localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, 'current-token');

    const { user } = renderPage(<Probe />, { token: 'current-token', path: '/' });

    await waitFor(() =>
      expect(screen.getByTestId('who')).toHaveTextContent('rose.fo@thenearbuy.com'),
    );

    await user.click(screen.getByRole('button', { name: 'Load leads' }));

    await waitFor(() => expect(screen.getByTestId('who')).toHaveTextContent('nobody'));
    expect(window.localStorage.getItem(SESSION_TOKEN_STORAGE_KEY)).toBeNull();
  });
});
