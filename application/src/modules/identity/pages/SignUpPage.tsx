import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  AUTH_PATHS,
  ERROR_CODES,
  PASSWORD_MIN_LENGTH,
  type AuthenticatedSession,
  type SignUpRequest,
} from '@erp/shared';
import { ApiFailure, api } from '../../../api/client';
import { useSession } from '../../../session/SessionProvider';
import { linkProps, navigate } from '../../../app/location';
import { Field } from '../components/Field';
import { FormError } from '../components/FormError';

/**
 * The way into an empty system.
 *
 * There is nothing to sign in to until somebody does this: no company exists until one is
 * typed here, and the person who types it becomes its owner by having done so.
 *
 * A visitor with no session is still sent to sign-in rather than here, because the
 * application has no way to know whether the database is empty without an endpoint that
 * would tell an anonymous caller how many companies exist. Sign-in links here prominently
 * instead, which costs a first user one click and tells a prober nothing.
 */
export function SignUpPage() {
  const { adopt } = useSession();
  const [form, setForm] = useState<SignUpRequest>({
    companyName: '',
    name: '',
    email: '',
    password: '',
  });

  const signUp = useMutation({
    mutationFn: () => api.post<AuthenticatedSession>(AUTH_PATHS.signUp, form),
    onSuccess: (session) => {
      adopt(session);
      navigate('/', { replace: true });
    },
  });

  const failure = signUp.error instanceof ApiFailure ? signUp.error : undefined;
  // The server decides what is valid; this screen only renders the answer. Duplicating the
  // rules here would give two sources of truth that drift, and the one users would meet
  // second is the one that actually governs.
  const fields = failure?.fields ?? {};

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-8 p-6">
      <header>
        <h1 className="text-2xl font-semibold text-slate-900">Create your company</h1>
        <p className="mt-2 text-sm text-slate-600">
          Nothing is set up in advance. The company you name here is the first one in the
          system, and you will be its owner.
        </p>
      </header>

      <form
        // The browser's own validation would stop the request before the server ever saw
        // it, leaving two sets of rules to keep in step. One set, on the server.
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          signUp.mutate();
        }}
      >
        <Field
          id="companyName"
          label="Company name"
          value={form.companyName}
          error={fields.companyName}
          onChange={(companyName) => setForm({ ...form, companyName })}
        />
        <Field
          id="name"
          label="Your name"
          autoComplete="name"
          value={form.name}
          error={fields.name}
          onChange={(name) => setForm({ ...form, name })}
        />
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
          autoComplete="new-password"
          hint={`At least ${PASSWORD_MIN_LENGTH} characters.`}
          value={form.password}
          error={fields.password}
          onChange={(password) => setForm({ ...form, password })}
        />

        {/* Field-level messages already sit beside their inputs; repeating them at the top
            would say everything twice. Anything with no field of its own shows here. */}
        {failure && failure.code !== ERROR_CODES.validationFailed && !fields.email && (
          <FormError>{failure.message}</FormError>
        )}

        <button
          type="submit"
          disabled={signUp.isPending}
          className="mt-2 rounded-md bg-slate-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
        >
          {signUp.isPending ? 'Creating your company…' : 'Create company'}
        </button>
      </form>

      <p className="text-sm text-slate-600">
        Already have an account?{' '}
        <a {...linkProps('/sign-in')} className="font-medium text-slate-900 underline">
          Sign in
        </a>
      </p>
    </main>
  );
}
