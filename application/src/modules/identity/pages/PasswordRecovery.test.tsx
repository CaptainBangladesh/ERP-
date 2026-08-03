import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { AUTH_PATHS, IDENTITY_ERROR_CODES } from '@erp/shared';
import { server } from '../../../test/server';
import { renderPage } from '../../../test/render';
import { ForgotPasswordPage } from './ForgotPasswordPage';
import { ResetPasswordPage } from './ResetPasswordPage';

/**
 * The way back in, from the user's side — the two screens ticket 02's sign-up left missing.
 *
 * The property worth asserting on the request screen is that it says the *same* thing however
 * the server answers, because the server answers the same way whether or not the address has
 * an account. A screen that branched on the difference would reintroduce the leak the API just
 * closed.
 */
describe('ForgotPasswordPage', () => {
  it('confirms in the same words whether or not the address has an account', async () => {
    let asked: unknown;
    server.use(
      http.post(AUTH_PATHS.forgotPassword, async ({ request }) => {
        asked = await request.json();
        return new HttpResponse(null, { status: 204 });
      }),
    );

    const { user } = renderPage(<ForgotPasswordPage />, { path: '/forgot-password' });

    await user.type(screen.getByLabelText(/email address/i), 'nobody@northwind.test');
    await user.click(screen.getByRole('button', { name: /send reset link/i }));

    await waitFor(() => expect(asked).toEqual({ email: 'nobody@northwind.test' }));
    // "If an account exists" rather than "we've sent you a link": the screen does not know,
    // and saying it did would be the tell.
    expect(await screen.findByText(/if an account exists/i)).toBeInTheDocument();
  });

  it('offers the way back to sign in', () => {
    renderPage(<ForgotPasswordPage />, { path: '/forgot-password' });

    expect(screen.getByRole('link', { name: /back to sign in/i })).toHaveAttribute(
      'href',
      '/sign-in',
    );
  });
});

describe('ResetPasswordPage', () => {
  it('sets a new password from the token in the link, and says other sessions ended', async () => {
    let sent: unknown;
    server.use(
      http.post(AUTH_PATHS.resetPassword, async ({ request }) => {
        sent = await request.json();
        return new HttpResponse(null, { status: 204 });
      }),
    );

    const { user } = renderPage(<ResetPasswordPage />, {
      path: '/reset-password?token=a-live-token',
    });

    await user.type(screen.getByLabelText(/new password/i), 'a-completely-new-password');
    await user.click(screen.getByRole('button', { name: /change password/i }));

    await waitFor(() =>
      expect(sent).toEqual({ token: 'a-live-token', password: 'a-completely-new-password' }),
    );
    expect(await screen.findByText(/password changed/i)).toBeInTheDocument();
    // Worth telling somebody plainly: the reset signed out whatever else was signed in, which
    // is the point of a reset rather than an inconvenience.
    expect(screen.getByText(/has been signed out|have been signed out/i)).toBeInTheDocument();
  });

  it('says the link is spent rather than blaming the password', async () => {
    server.use(
      http.post(AUTH_PATHS.resetPassword, () =>
        HttpResponse.json(
          {
            code: IDENTITY_ERROR_CODES.resetTokenInvalid,
            message: 'This password reset link is invalid or has expired. Request a new one.',
          },
          { status: 410 },
        ),
      ),
    );

    const { user } = renderPage(<ResetPasswordPage />, {
      path: '/reset-password?token=a-spent-token',
    });

    await user.type(screen.getByLabelText(/new password/i), 'a-completely-new-password');
    await user.click(screen.getByRole('button', { name: /change password/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/invalid or has expired/i);
    // And a way onward rather than a dead end.
    expect(screen.getByRole('link', { name: /request a fresh reset link/i })).toHaveAttribute(
      'href',
      '/forgot-password',
    );
  });

  it('says so when the link arrived with no token at all', () => {
    renderPage(<ResetPasswordPage />, { path: '/reset-password' });

    expect(screen.getByText(/this link is incomplete/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/new password/i)).not.toBeInTheDocument();
  });
});
