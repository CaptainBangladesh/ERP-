import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  AUTH_PATHS,
  ERROR_CODES,
  type AuthenticatedSession,
  type SignInRequest,
} from '@erp/shared';
import { ApiFailure, api } from '../../../api/client';
import { useSession } from '../../../session/SessionProvider';
import { linkProps, navigate } from '../../../app/location';
import { Field } from '../components/Field';
import { FormError } from '../components/FormError';

export function SignInPage() {
  const { adopt, hasExpired } = useSession();
  const [form, setForm] = useState<SignInRequest>({ email: '', password: '' });

  const signIn = useMutation({
    mutationFn: () => api.post<AuthenticatedSession>(AUTH_PATHS.signIn, form),
    onSuccess: (session) => {
      adopt(session);
      navigate('/', { replace: true });
    },
  });

  const failure = signIn.error instanceof ApiFailure ? signIn.error : undefined;
  const fields = failure?.fields ?? {};

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-8 p-6">
      <header>
        <h1 className="text-2xl font-semibold text-slate-900">Sign in</h1>
        {/* Arriving here because a session ran out is not the same as arriving here to
            sign in, and saying so is the difference between an explanation and a
            mysterious logout. */}
        {hasExpired && (
          <p role="status" className="mt-2 text-sm text-amber-700">
            Your session expired. Sign in again to continue.
          </p>
        )}
      </header>

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
        <Field
          id="password"
          label="Password"
          type="password"
          autoComplete="current-password"
          value={form.password}
          error={fields.password}
          onChange={(password) => setForm({ ...form, password })}
        />

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
        <a {...linkProps('/sign-up')} className="font-medium text-slate-900 underline">
          Create your company
        </a>
      </p>
    </main>
  );
}
