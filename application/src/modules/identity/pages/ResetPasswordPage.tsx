import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  AUTH_PATHS,
  PASSWORD_MIN_LENGTH,
  RECOVERY_SCREEN_PATHS,
  RECOVERY_TOKEN_PARAM,
  type ResetPasswordRequest,
} from '@erp/shared';
import { ApiFailure, api } from '../../../api/client';
import { currentSearchParams, linkProps } from '../../../app/location';
import { Field, FormError } from '@erp/shared/ui';

/**
 * Setting a new password from the link `ForgotPasswordPage` sent.
 *
 * The token travels as `?token=…`, read once on mount rather than watched — a link somebody
 * clicked does not change while this screen is open. Using it ends every other session the
 * account held, which is the server's doing and not something this screen has to explain
 * beyond saying so.
 */
export function ResetPasswordPage() {
  const [token] = useState(() => currentSearchParams().get(RECOVERY_TOKEN_PARAM) ?? '');
  const [password, setPassword] = useState('');

  const reset = useMutation({
    mutationFn: () =>
      api.post<void>(AUTH_PATHS.resetPassword, { token, password } satisfies ResetPasswordRequest),
  });

  const failure = reset.error instanceof ApiFailure ? reset.error : undefined;
  const fields = failure?.fields ?? {};

  if (!token) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-6 p-6">
        <h1 className="text-2xl font-semibold text-slate-900">This link is incomplete</h1>
        <p className="text-sm text-slate-600">
          Request a fresh one from the sign-in screen.
        </p>
        <p className="text-sm text-slate-600">
          <a {...linkProps(RECOVERY_SCREEN_PATHS.forgotPassword)} className="font-medium text-slate-900 underline">
            Request a reset link
          </a>
        </p>
      </main>
    );
  }

  if (reset.isSuccess) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-6 p-6">
        <h1 className="text-2xl font-semibold text-slate-900">Password changed</h1>
        <p role="status" className="text-sm text-slate-600">
          Sign in with your new password. Every other device signed in to this account has
          been signed out.
        </p>
        <p className="text-sm text-slate-600">
          <a {...linkProps('/sign-in')} className="font-medium text-slate-900 underline">
            Sign in
          </a>
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-8 p-6">
      <header>
        <h1 className="text-2xl font-semibold text-slate-900">Choose a new password</h1>
      </header>

      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          reset.mutate();
        }}
      >
        <Field
          id="password"
          label="New password"
          type="password"
          autoComplete="new-password"
          hint={password ? undefined : `At least ${PASSWORD_MIN_LENGTH} characters.`}
          value={password}
          error={fields.password}
          onChange={setPassword}
        />

        {/* The token itself is invalid or expired — a link problem, not a password problem,
            so it does not belong beside the password field. */}
        {failure && !fields.password && <FormError>{failure.message}</FormError>}

        <button
          type="submit"
          disabled={reset.isPending}
          className="mt-2 rounded-md bg-slate-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
        >
          {reset.isPending ? 'Changing password…' : 'Change password'}
        </button>
      </form>

      {failure && !fields.password && (
        <p className="text-sm text-slate-600">
          <a {...linkProps(RECOVERY_SCREEN_PATHS.forgotPassword)} className="font-medium text-slate-900 underline">
            Request a fresh reset link
          </a>
        </p>
      )}
    </main>
  );
}
