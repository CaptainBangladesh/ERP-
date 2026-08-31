import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { AUTH_PATHS, ERROR_CODES, IDENTITY_ERROR_CODES } from '@erp/shared';
import { server } from '../../../test/server';
import { renderPage } from '../../../test/render';
import { captureNavigationAway } from '../../../test/navigation';
import { SignInPage } from './SignInPage';

describe('SignInPage', () => {
  async function fillIn(user: ReturnType<typeof renderPage>['user']) {
    await user.type(screen.getByLabelText(/email address/i), 'ada@northwind.test');
    await user.type(screen.getByLabelText(/^password$/i), 'correct-horse-battery');
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

    const password = await screen.findByLabelText(/^password$/i);
    await waitFor(() => expect(password).toHaveAccessibleDescription(/enter your password/i));
  });

  it('warns about Caps Lock, which a masked box would otherwise hide', async () => {
    const { user } = renderPage(<SignInPage />, { path: '/sign-in' });

    await user.click(screen.getByLabelText(/^password$/i));
    expect(screen.queryByText(/caps lock/i)).not.toBeInTheDocument();

    await user.keyboard('{CapsLock}CORRECT');

    // Otherwise the only feedback is a refusal that blames the password, and the user
    // retypes the same thing in the same state.
    expect(await screen.findByText(/caps lock is on/i)).toBeInTheDocument();

    await user.keyboard('{CapsLock}x');
    await waitFor(() => expect(screen.queryByText(/caps lock/i)).not.toBeInTheDocument());
  });

  it('stops warning about Caps Lock once the field is left', async () => {
    const { user } = renderPage(<SignInPage />, { path: '/sign-in' });

    await user.click(screen.getByLabelText(/^password$/i));
    await user.keyboard('{CapsLock}SECRET');
    expect(await screen.findByText(/caps lock is on/i)).toBeInTheDocument();

    // A warning about a keyboard nobody is typing on is noise.
    await user.click(screen.getByLabelText(/email address/i));
    await waitFor(() => expect(screen.queryByText(/caps lock/i)).not.toBeInTheDocument());

    await user.keyboard('{CapsLock}');
  });

  it('offers the way to sign up when there is no account yet', () => {
    renderPage(<SignInPage />, { path: '/sign-in' });

    expect(screen.getByRole('link', { name: /create a company/i })).toHaveAttribute(
      'href',
      '/sign-up',
    );
  });

  it('offers a way back in for somebody who has forgotten their password', () => {
    renderPage(<SignInPage />, { path: '/sign-in' });

    expect(screen.getByRole('link', { name: /forgot password/i })).toHaveAttribute(
      'href',
      '/forgot-password',
    );
  });

  describe('continue with Google', () => {
    it('leaves for the API endpoint that begins a sign-in', async () => {
      const navigation = captureNavigationAway();
      try {
        const { user } = renderPage(<SignInPage />, { path: '/sign-in' });
        await user.click(screen.getByRole('button', { name: /continue with google/i }));

        const destination = navigation.destination() ?? '';
        expect(destination).toContain(AUTH_PATHS.googleLogin);

        // As a sign-in, explicitly. The server creates nothing in this mode, so the button
        // cannot become a way to sign up by accident.
        expect(new URL(destination, 'http://localhost').searchParams.get('mode')).toBe('signin');
      } finally {
        navigation.restore();
      }
    });

    it('explains an address Google knows and this system does not, and links to sign-up', () => {
      // How the round trip comes back when Google confirmed somebody who never signed up —
      // on the URL, because the tab that started it was navigated away and back.
      renderPage(<SignInPage />, {
        path: `/sign-in?error=${IDENTITY_ERROR_CODES.googleAccountNotRegistered}`,
      });

      expect(screen.getByRole('alert')).toHaveTextContent(/nobody has signed up here/i);
      expect(screen.getByRole('link', { name: /sign up with google/i })).toHaveAttribute(
        'href',
        '/sign-up',
      );
    });

    it('says an attempt failed without inventing a reason for it', () => {
      renderPage(<SignInPage />, {
        path: `/sign-in?error=${IDENTITY_ERROR_CODES.googleAuthFailed}`,
      });

      const alert = screen.getByRole('alert');
      expect(alert).toHaveTextContent(/did not complete/i);
      // Specifically not the "you have no account" message: nothing established that.
      expect(alert).not.toHaveTextContent(/nobody has signed up here/i);
    });
  });
});
