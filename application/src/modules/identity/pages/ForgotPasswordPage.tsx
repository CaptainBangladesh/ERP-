import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { AUTH_PATHS, type ForgotPasswordRequest } from '@erp/shared';
import { ApiFailure, api } from '../../../api/client';
import { linkProps } from '../../../app/location';
import { Field, FormError } from '@erp/shared/ui';

/**
 * Asking for a way back in.
 *
 * The confirmation is the same sentence whether or not the address has an account — the API
 * answers identically either way, and a screen that branched on the difference would be
 * reintroducing the leak the server just closed. There is nothing here for this screen to
 * decide about who has an account; it just relays the one message.
 */
export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');

  const request = useMutation({
    mutationFn: () => api.post<void>(AUTH_PATHS.forgotPassword, { email } satisfies ForgotPasswordRequest),
  });

  const failure = request.error instanceof ApiFailure ? request.error : undefined;

  if (request.isSuccess) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-6 p-6">
        <h1 className="text-2xl font-semibold text-slate-900">Check your email</h1>
        <p role="status" className="text-sm text-slate-600">
          If an account exists for {email}, we've sent a link to reset the password. It works
          once and expires soon, so use it before requesting another.
        </p>
        <p className="text-sm text-slate-600">
          <a {...linkProps('/sign-in')} className="font-medium text-slate-900 underline">
            Back to sign in
          </a>
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-8 p-6">
      <header>
        <h1 className="text-2xl font-semibold text-slate-900">Reset your password</h1>
        <p className="mt-2 text-sm text-slate-600">
          Enter your email address and we'll send you a link to choose a new password.
        </p>
      </header>

      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          request.mutate();
        }}
      >
        <Field
          id="email"
          label="Email address"
          type="email"
          autoComplete="email"
          value={email}
          onChange={setEmail}
        />

        {failure && <FormError>{failure.message}</FormError>}

        <button
          type="submit"
          disabled={request.isPending}
          className="mt-2 rounded-md bg-slate-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
        >
          {request.isPending ? 'Sending…' : 'Send reset link'}
        </button>
      </form>

      <p className="text-sm text-slate-600">
        <a {...linkProps('/sign-in')} className="font-medium text-slate-900 underline">
          Back to sign in
        </a>
      </p>
    </main>
  );
}
