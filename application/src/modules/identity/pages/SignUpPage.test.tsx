import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { AUTH_PATHS, ERROR_CODES, IDENTITY_ERROR_CODES } from '@erp/shared';
import { server } from '../../../test/server';
import { renderPage } from '../../../test/render';
import { SignUpPage } from './SignUpPage';

/**
 * Seam 2 — the network boundary. Assertions are on what a user sees and does, never on
 * hooks or component state.
 */
describe('SignUpPage', () => {
  // `^password$` because "Confirm password" also matches a loose /password/ — the exact
  // ambiguity a user faces if the two boxes are not clearly distinct.
  const passwordBox = () => screen.getByLabelText(/^password$/i);
  const confirmBox = () => screen.getByLabelText(/confirm password/i);

  async function fillIn(
    user: ReturnType<typeof renderPage>['user'],
    options: { password?: string; confirmation?: string } = {},
  ) {
    const password = options.password ?? 'correct-horse-battery';
    const confirmation = options.confirmation ?? password;

    await user.type(screen.getByLabelText(/company name/i), 'Northwind Trading');
    await user.type(screen.getByLabelText(/your name/i), 'Ada Okafor');
    await user.type(screen.getByLabelText(/email address/i), 'ada@northwind.test');
    await user.type(passwordBox(), password);
    await user.type(confirmBox(), confirmation);
  }

  it('creates a company and its first user in one step', async () => {
    let submitted: unknown;
    server.use(
      http.post(AUTH_PATHS.signUp, async ({ request }) => {
        submitted = await request.json();
        return HttpResponse.json(
          {
            token: 'a-token',
            expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
            user: { id: 'u1', name: 'Ada Okafor', email: 'ada@northwind.test', isOwner: true },
            company: { id: 'c1', name: 'Northwind Trading' },
          },
          { status: 201 },
        );
      }),
      http.get(AUTH_PATHS.session, () => HttpResponse.json({})),
    );

    const { user } = renderPage(<SignUpPage />, { path: '/sign-up' });
    await fillIn(user);
    await user.click(screen.getByRole('button', { name: /create company/i }));

    await waitFor(() => {
      expect(submitted).toEqual({
        companyName: 'Northwind Trading',
        name: 'Ada Okafor',
        email: 'ada@northwind.test',
        password: 'correct-horse-battery',
      });
    });

    // Signing up signs you in — there is no second step, so the browser moves to the home
    // screen rather than back to a sign-in form.
    await waitFor(() => expect(window.location.pathname).toBe('/'));
  });

  it('puts each validation message beside the input it belongs to', async () => {
    server.use(
      http.post(AUTH_PATHS.signUp, () =>
        HttpResponse.json(
          {
            code: ERROR_CODES.validationFailed,
            message: 'Some of the details you entered need attention.',
            fields: {
              email: 'Enter a valid email address.',
              password: 'Use at least 12 characters.',
            },
          },
          { status: 422 },
        ),
      ),
    );

    const { user } = renderPage(<SignUpPage />, { path: '/sign-up' });
    await fillIn(user);
    await user.click(screen.getByRole('button', { name: /create company/i }));

    // The message has to be reachable *from the input*, not merely present on the page —
    // that is the difference between a form somebody can fix and a wall of red text.
    const email = await screen.findByLabelText(/email address/i);
    await waitFor(() => expect(email).toHaveAccessibleDescription(/valid email address/i));
    expect(email).toBeInvalid();

    const password = passwordBox();
    expect(password).toHaveAccessibleDescription(/at least 12 characters/i);
    expect(password).toBeInvalid();
  });

  it('lets somebody read the password they are choosing', async () => {
    const { user } = renderPage(<SignUpPage />, { path: '/sign-up' });

    // Masked by default — revealing is a decision the user makes about their own
    // surroundings, not one the form makes for them.
    expect(passwordBox()).toHaveAttribute('type', 'password');

    const toggles = screen.getAllByRole('button', { name: /show password/i });
    await user.click(toggles[0]!);

    expect(passwordBox()).toHaveAttribute('type', 'text');
    expect(screen.getAllByRole('button', { name: /hide password/i })[0]).toBeInTheDocument();

    // Each box reveals independently, so revealing one does not expose the other.
    expect(confirmBox()).toHaveAttribute('type', 'password');
  });

  describe('password strength', () => {
    it('advises on the password being chosen without ever blocking it', async () => {
      let submitted: unknown;
      server.use(
        http.post(AUTH_PATHS.signUp, async ({ request }) => {
          submitted = await request.json();
          return HttpResponse.json({}, { status: 201 });
        }),
        http.get(AUTH_PATHS.session, () => HttpResponse.json({})),
      );

      const { user } = renderPage(<SignUpPage />, { path: '/sign-up' });

      // Nothing typed, nothing to judge — a verdict on an empty box is just noise.
      expect(screen.queryByText(/weak|fair|good|strong/i)).not.toBeInTheDocument();

      // Sixteen characters long and one guess to break. Length cannot rescue it, so the
      // repetition check overrides the length band rather than nudging it down one.
      await user.type(passwordBox(), 'aaaaaaaaaaaaaaaa');
      expect(await screen.findByText(/weak/i)).toBeInTheDocument();
      expect(screen.getByText(/repeating one or two characters/i)).toBeInTheDocument();

      // Weak is advice, not a rule. The server's length minimum is the only gate, so a
      // password the meter dislikes still submits.
      await user.type(confirmBox(), 'aaaaaaaaaaaaaaaa');
      await user.type(screen.getByLabelText(/company name/i), 'Northwind Trading');
      await user.type(screen.getByLabelText(/your name/i), 'Ada Okafor');
      await user.type(screen.getByLabelText(/email address/i), 'ada@northwind.test');
      await user.click(screen.getByRole('button', { name: /create company/i }));

      await waitFor(() => expect(submitted).toBeTruthy());
    });

    it('rewards length rather than punctuation', async () => {
      const { user } = renderPage(<SignUpPage />, { path: '/sign-up' });

      // Short-but-fussy is what composition rules produce. Upper, lower, digits, symbols,
      // every box ticked — and it earns no more than Fair, because at twelve characters
      // that is honestly what it is worth.
      await user.type(passwordBox(), 'Pa$$w0rd!123');
      expect(await screen.findByText(/fair/i)).toBeInTheDocument();

      // Three ordinary words, not a symbol in sight, and far harder to guess. A meter that
      // said otherwise would be teaching people the wrong lesson.
      await user.clear(passwordBox());
      await user.type(passwordBox(), 'marmalade harbour lantern');
      expect(await screen.findByText(/strong/i)).toBeInTheDocument();
    });

    it('refuses to call a password strong when it is made of what they just typed', async () => {
      const { user } = renderPage(<SignUpPage />, { path: '/sign-up' });

      await user.type(screen.getByLabelText(/company name/i), 'Northwind Trading');
      await user.type(passwordBox(), 'northwind trading 2026');

      // Long, mixed, and the first thing anybody who knows them would try.
      expect(await screen.findByText(/weak/i)).toBeInTheDocument();
      expect(screen.getByText(/avoid your name, your company/i)).toBeInTheDocument();
    });
  });

  it('catches a mistyped confirmation before troubling the server', async () => {
    let attempted = false;
    server.use(
      http.post(AUTH_PATHS.signUp, () => {
        attempted = true;
        return HttpResponse.json({}, { status: 201 });
      }),
    );

    const { user } = renderPage(<SignUpPage />, { path: '/sign-up' });
    await fillIn(user, {
      password: 'correct-horse-battery',
      confirmation: 'correct-horse-bettery',
    });
    await user.click(screen.getByRole('button', { name: /create company/i }));

    // The message belongs to the confirmation box, which is also where the cursor goes:
    // a mismatch is not something to go hunting for.
    await waitFor(() => expect(confirmBox()).toHaveAccessibleDescription(/does not match/i));
    expect(confirmBox()).toHaveFocus();

    // A round trip to be told the two boxes on this screen differ would be a round trip
    // spent asking the server something only the screen knows.
    expect(attempted).toBe(false);
  });

  it('clears the mismatch as soon as the user starts correcting it', async () => {
    let submitted: unknown;
    server.use(
      http.post(AUTH_PATHS.signUp, async ({ request }) => {
        submitted = await request.json();
        return HttpResponse.json(
          {
            token: 'a-token',
            expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
            user: { id: 'u1', name: 'Ada Okafor', email: 'ada@northwind.test', isOwner: true },
            company: { id: 'c1', name: 'Northwind Trading' },
          },
          { status: 201 },
        );
      }),
      http.get(AUTH_PATHS.session, () => HttpResponse.json({})),
    );

    const { user } = renderPage(<SignUpPage />, { path: '/sign-up' });
    await fillIn(user, { password: 'correct-horse-battery', confirmation: 'wrong' });
    await user.click(screen.getByRole('button', { name: /create company/i }));
    await waitFor(() => expect(confirmBox()).toHaveAccessibleDescription(/does not match/i));

    await user.clear(confirmBox());
    // Standing accusation removed the moment they act on it, rather than left up while
    // they fix it.
    expect(confirmBox()).not.toBeInvalid();

    await user.type(confirmBox(), 'correct-horse-battery');
    await user.click(screen.getByRole('button', { name: /create company/i }));

    // The confirmation is a question about this screen; it never crosses the network.
    await waitFor(() => {
      expect(submitted).toEqual({
        companyName: 'Northwind Trading',
        name: 'Ada Okafor',
        email: 'ada@northwind.test',
        password: 'correct-horse-battery',
      });
    });
  });

  it('refuses a duplicate email against the email field, and says to sign in instead', async () => {
    server.use(
      http.post(AUTH_PATHS.signUp, () =>
        HttpResponse.json(
          {
            code: IDENTITY_ERROR_CODES.emailAlreadyRegistered,
            message: 'That email address is already registered.',
            fields: { email: 'That email address is already registered. Sign in instead.' },
          },
          { status: 409 },
        ),
      ),
    );

    const { user } = renderPage(<SignUpPage />, { path: '/sign-up' });
    await fillIn(user);
    await user.click(screen.getByRole('button', { name: /create company/i }));

    const email = await screen.findByLabelText(/email address/i);
    await waitFor(() => expect(email).toHaveAccessibleDescription(/already registered/i));

    // Still on the form, with what they typed intact. Being sent away would mean typing it
    // all again.
    expect(window.location.pathname).toBe('/sign-up');
    expect(screen.getByLabelText(/company name/i)).toHaveValue('Northwind Trading');
  });

  it('surfaces a failure that belongs to no particular field', async () => {
    server.use(
      http.post(AUTH_PATHS.signUp, () =>
        HttpResponse.json(
          { code: 'internal_error', message: 'Something went wrong. Please try again.' },
          { status: 500 },
        ),
      ),
    );

    const { user } = renderPage(<SignUpPage />, { path: '/sign-up' });
    await fillIn(user);
    await user.click(screen.getByRole('button', { name: /create company/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/something went wrong/i);
  });

  it('says plainly that nothing is set up in advance', async () => {
    renderPage(<SignUpPage />, { path: '/sign-up' });

    // An empty system is the normal first experience here, so the screen explains it
    // rather than leaving somebody wondering which company to pick.
    expect(screen.getByRole('heading', { name: /create your company/i })).toBeInTheDocument();
    expect(screen.getByText(/nothing is set up in advance/i)).toBeInTheDocument();
  });
});
