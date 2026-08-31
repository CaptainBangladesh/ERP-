import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  AUTH_PATHS,
  AUTH_SCREEN_PATHS,
  ERROR_CODES,
  IDENTITY_ERROR_CODES,
  RECOVERY_SCREEN_PATHS,
  type AuthenticatedSession,
  type SignInRequest,
} from '@erp/shared';
import { ApiFailure, api } from '../../../api/client';
import { useSession } from '../../../session/SessionProvider';
import { linkProps, navigate, currentSearchParams } from '../../../app/location';
import { Field, FormError } from '@erp/shared/ui';
import { GoogleButton } from '../components/GoogleButton';
import { readGoogleAuthReturn, startGoogleAuth } from '../google-auth';

export function SignInPage() {
  const { adopt, hasExpired } = useSession();
  const [form, setForm] = useState<SignInRequest>({ email: '', password: '' });

  // Whatever a Google attempt left behind on its way back here. Read at render rather than
  // in an effect: it is on the URL this screen was loaded with, so there is nothing to wait
  // for and nothing to fetch.
  const googleReturn = readGoogleAuthReturn(currentSearchParams());

  const signIn = useMutation({
    mutationFn: () => api.post<AuthenticatedSession>(AUTH_PATHS.signIn, form),
    onSuccess: (session) => {
      adopt(session);
      navigate(AUTH_SCREEN_PATHS.dashboard, { replace: true });
    },
  });

  const failure = signIn.error instanceof ApiFailure ? signIn.error : undefined;
  const fields = failure?.fields ?? {};

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-8 p-6">
      <header>
        <h1 className="text-2xl font-semibold text-slate-900">Sign in</h1>

        {googleReturn.error === IDENTITY_ERROR_CODES.googleAccountNotRegistered && (
          <div
            role="alert"
            className="mt-3 flex flex-col gap-2 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm font-medium text-amber-900 shadow-2xs"
          >
            <span className="font-semibold text-amber-950">
              No account here uses that Google address
            </span>
            <span>
              Google confirmed who you are, but nobody has signed up here with that address
              yet. Sign up to create a company, or to join the one you work for.
            </span>
            <a
              {...linkProps(AUTH_SCREEN_PATHS.signUp)}
              className="mt-1 self-start font-bold text-slate-900 underline hover:text-slate-700"
            >
              Sign up with Google →
            </a>
          </div>
        )}

        {/* Every other way the round trip can end badly says the same thing, because there
            is nothing more specific to act on: the attempt did not complete. */}
        {googleReturn.error &&
          googleReturn.error !== IDENTITY_ERROR_CODES.googleAccountNotRegistered && (
            <div
              role="alert"
              className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm font-medium text-amber-900 shadow-2xs"
            >
              Signing in with Google did not complete. Try again, or use your email address
              and password below.
            </div>
          )}

        {hasExpired && !googleReturn.error && (
          <div
            role="status"
            className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3.5 text-xs font-medium text-amber-800 shadow-2xs"
          >
            Your session expired. Anything you had not saved is still in this browser and will
            be restored as soon as you sign back in.
          </div>
        )}
      </header>

      <div className="flex flex-col gap-3">
        <GoogleButton
          label="Continue with Google"
          onClick={() => startGoogleAuth({ mode: 'signin' })}
        />

        <div className="relative my-2 flex items-center">
          <div className="grow border-t border-slate-200" />
          <span className="mx-3 shrink text-xs tracking-wider text-slate-400 uppercase">or</span>
          <div className="grow border-t border-slate-200" />
        </div>
      </div>

      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          signIn.mutate();
        }}
      >
        <Field
          id="email"
          label="Email address"
          type="email"
          autoComplete="email"
          value={form.email}
          error={fields.email}
          onChange={(email) => setForm({ ...form, email })}
        />
        <div className="flex flex-col gap-1.5">
          <Field
            id="password"
            label="Password"
            type="password"
            autoComplete="current-password"
            value={form.password}
            error={fields.password}
            onChange={(password) => setForm({ ...form, password })}
          />
          <a
            {...linkProps(RECOVERY_SCREEN_PATHS.forgotPassword)}
            className="self-start text-sm text-slate-600 underline hover:text-slate-900"
          >
            Forgot password?
          </a>
        </div>

        {failure && failure.code !== ERROR_CODES.validationFailed && (
          <FormError>{failure.message}</FormError>
        )}

        <button
          type="submit"
          disabled={signIn.isPending}
          className="mt-2 rounded-md bg-slate-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
        >
          {signIn.isPending ? 'Signing in…' : 'Sign in'}
        </button>
      </form>

      <p className="text-sm text-slate-600">
        No account yet?{' '}
        <a
          {...linkProps(AUTH_SCREEN_PATHS.signUp)}
          className="font-medium text-slate-900 underline"
        >
          Create a company, or join the one you work for
        </a>
      </p>
    </main>
  );
}
