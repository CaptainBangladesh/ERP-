import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { AUTH_PATHS, IDENTITY_ERROR_CODES } from '@erp/shared';
import { server } from '../../../test/server';
import { renderPage } from '../../../test/render';
import { AcceptInvitationPage } from './AcceptInvitationPage';

describe('AcceptInvitationPage', () => {
  const TOKEN = 'a-live-invitation';

  function invitation() {
    server.use(
      http.get(AUTH_PATHS.invitation(TOKEN), () =>
        HttpResponse.json({ companyName: 'Northwind Trading', email: 'kit@northwind.test' }),
      ),
    );
  }

  it('says which company and which address before anybody types anything', async () => {
    invitation();

    renderPage(<AcceptInvitationPage />, { path: `/accept-invitation?token=${TOKEN}` });

    expect(
      await screen.findByRole('heading', { name: /you're invited to join northwind trading/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/kit@northwind.test/i)).toBeInTheDocument();
  });

  it('creates the account and signs the new colleague straight in', async () => {
    invitation();
    let sent: unknown;
    server.use(
      http.post(AUTH_PATHS.acceptInvitation(TOKEN), async ({ request }) => {
        sent = await request.json();
        return HttpResponse.json(
          {
            token: 'a-session-token',
            expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
            user: { id: 'u2', name: 'Kit Moreau', email: 'kit@northwind.test', isOwner: false },
            company: { id: 'c1', name: 'Northwind Trading', tier: 'core' },
            permissions: ['products:products:read'],
          },
          { status: 201 },
        );
      }),
      http.get(AUTH_PATHS.session, () => HttpResponse.json({})),
    );

    const { user } = renderPage(<AcceptInvitationPage />, {
      path: `/accept-invitation?token=${TOKEN}`,
    });

    await user.type(await screen.findByLabelText(/company name/i), 'Northwind Trading');
    await user.type(screen.getByLabelText(/your name/i), 'Kit Moreau');
    await user.type(screen.getByLabelText(/^password$/i), 'a-strong-enough-password');
    await user.click(screen.getByRole('button', { name: /accept invitation/i }));

    // The email is the invitation's, never the form's: accepting is not a chance to join a
    // company as somebody else.
    await waitFor(() =>
      expect(sent).toEqual({
        companyName: 'Northwind Trading',
        name: 'Kit Moreau',
        password: 'a-strong-enough-password',
      }),
    );
    // Accepting signs you in — there is no second step and no sign-in screen in between.
    await waitFor(() => expect(window.location.pathname).toBe('/'));
  });

  it('refuses a spent link before anybody fills in a form that could not work', async () => {
    server.use(
      http.get(AUTH_PATHS.invitation(TOKEN), () =>
        HttpResponse.json(
          {
            code: IDENTITY_ERROR_CODES.invitationInvalid,
            message:
              'This invitation link is invalid or has expired. Ask whoever invited you to send another.',
          },
          { status: 410 },
        ),
      ),
    );

    renderPage(<AcceptInvitationPage />, { path: `/accept-invitation?token=${TOKEN}` });

    expect(await screen.findByText(/no longer valid/i)).toBeInTheDocument();
    expect(screen.getByText(/ask whoever invited you/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /accept invitation/i })).not.toBeInTheDocument();
  });

  it('says so when the link arrived with no token at all', () => {
    renderPage(<AcceptInvitationPage />, { path: '/accept-invitation' });

    expect(screen.getByText(/no longer valid/i)).toBeInTheDocument();
  });
});
