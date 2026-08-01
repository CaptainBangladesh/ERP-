import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { AUTH_PATHS, ERROR_CODES, IDENTITY_ERROR_CODES } from '@erp/shared';
import { server } from '../../../test/server';
import { renderPage } from '../../../test/render';
import { SignInPage } from './SignInPage';

describe('SignInPage', () => {
  async function fillIn(user: ReturnType<typeof renderPage>['user']) {
    await user.type(screen.getByLabelText(/email address/i), 'ada@northwind.test');
    await user.type(screen.getByLabelText(/password/i), 'correct-horse-battery');
  }

  it('signs in and goes to the home screen', async () => {
    let authorization: string | null = null;
    server.use(
      http.post(AUTH_PATHS.signIn, () =>
        HttpResponse.json({
          token: 'a-token',
          expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
          user: { id: 'u1', name: 'Ada Okafor', email: 'ada@northwind.test', isOwner: true },
          company: { id: 'c1', name: 'Northwind Trading' },
        }),
      ),
      http.get(AUTH_PATHS.session, ({ request }) => {
        authorization = request.headers.get('authorization');
        return HttpResponse.json({
          user: { id: 'u1', name: 'Ada Okafor', email: 'ada@northwind.test', isOwner: true },
          company: { id: 'c1', name: 'Northwind Trading' },
          expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
        });
      }),
    );

    const { user } = renderPage(<SignInPage />, { path: '/sign-in' });
    await fillIn(user);
    await user.click(screen.getByRole('button', { name: /^sign in$/i }));

    await waitFor(() => expect(window.location.pathname).toBe('/'));

    // The token has to reach the next request, or every screen behind sign-in is a 401.
    await waitFor(() => expect(authorization).toBe('Bearer a-token'));
  });

  it('refuses a wrong password without saying which half was wrong', async () => {
    server.use(
      http.post(AUTH_PATHS.signIn, () =>
        HttpResponse.json(
          {
            code: IDENTITY_ERROR_CODES.invalidCredentials,
            message: 'That email address and password do not match an account.',
          },
          { status: 401 },
        ),
      ),
    );

    const { user } = renderPage(<SignInPage />, { path: '/sign-in' });
    await fillIn(user);
    await user.click(screen.getByRole('button', { name: /^sign in$/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/do not match an account/i);
    expect(window.location.pathname).toBe('/sign-in');
  });

  it('shows validation messages against the offending fields', async () => {
    server.use(
      http.post(AUTH_PATHS.signIn, () =>
        HttpResponse.json(
          {
            code: ERROR_CODES.validationFailed,
            message: 'Some of the details you entered need attention.',
            fields: { password: 'Enter your password.' },
          },
          { status: 422 },
        ),
      ),
    );

    const { user } = renderPage(<SignInPage />, { path: '/sign-in' });
    await user.type(screen.getByLabelText(/email address/i), 'ada@northwind.test');
    await user.click(screen.getByRole('button', { name: /^sign in$/i }));

    const password = await screen.findByLabelText(/password/i);
    await waitFor(() => expect(password).toHaveAccessibleDescription(/enter your password/i));
  });

  it('offers the way to create a company when there is no account yet', () => {
    renderPage(<SignInPage />, { path: '/sign-in' });

    expect(screen.getByRole('link', { name: /create your company/i })).toHaveAttribute(
      'href',
      '/sign-up',
    );
  });
});
