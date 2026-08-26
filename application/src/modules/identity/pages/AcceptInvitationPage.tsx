import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  AUTH_PATHS,
  PASSWORD_MIN_LENGTH,
  RECOVERY_TOKEN_PARAM,
  type AcceptInvitationRequest,
  type AuthenticatedSession,
  type InvitationDetails,
} from '@erp/shared';
import { ApiFailure, api } from '../../../api/client';
import { useSession } from '../../../session/SessionProvider';
import { currentSearchParams, linkProps, navigate } from '../../../app/location';
import { Field, FormError } from '@erp/shared/ui';

/**
 * Accepting a colleague invitation.
 *
 * Read before anything is typed, the same reasoning `AUTH_PATHS.invitation` exists for: an
 * expired or already-used link fails here, before somebody has spent effort on a form that
 * was never going to work.
 */
export function AcceptInvitationPage() {
  const { adopt } = useSession();
  const [token] = useState(() => currentSearchParams().get(RECOVERY_TOKEN_PARAM) ?? '');
  const [companyName, setCompanyName] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');

  const invitation = useQuery({
    queryKey: ['invitation', token],
    queryFn: () => api.get<InvitationDetails>(AUTH_PATHS.invitation(token)),
    enabled: Boolean(token),
    retry: false,
  });

  const accept = useMutation({
    mutationFn: () =>
      api.post<AuthenticatedSession>(AUTH_PATHS.acceptInvitation(token), {
        companyName,
        name,
        password,
      } satisfies AcceptInvitationRequest),
    onSuccess: (session) => {
      adopt(session);
      navigate('/', { replace: true });
    },
  });

  const acceptFailure = accept.error instanceof ApiFailure ? accept.error : undefined;
  const fields = acceptFailure?.fields ?? {};

  if (!token || invitation.isError) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-6 p-6">
        <h1 className="text-2xl font-semibold text-slate-900">This invitation is no longer valid</h1>
        <p className="text-sm text-slate-600">
          {invitation.error instanceof ApiFailure
            ? invitation.error.message
            : 'Ask whoever invited you to send another invitation.'}
        </p>
        <p className="text-sm text-slate-600">
          <a {...linkProps('/sign-in')} className="font-medium text-slate-900 underline">
            Back to sign in
          </a>
        </p>
      </main>
    );
  }

  if (invitation.isPending || !invitation.data) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-slate-500">Loading…</p>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-8 p-6">
      <header>
        <h1 className="text-2xl font-semibold text-slate-900">
          You're invited to join {invitation.data.companyName}
        </h1>
        <p className="mt-2 text-sm text-slate-600">
          Signing in as {invitation.data.email}. Enter the company name, your name and a password to finish opening your account.
        </p>
      </header>

      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          accept.mutate();
        }}
      >
        <Field
          id="companyName"
          label="Company name"
          value={companyName}
          error={fields.companyName}
          onChange={setCompanyName}
        />
        <Field
          id="name"
          label="Your name"
          autoComplete="name"
          value={name}
          error={fields.name}
          onChange={setName}
        />
        <Field
          id="password"
          label="Password"
          type="password"
          autoComplete="new-password"
          hint={password ? undefined : `At least ${PASSWORD_MIN_LENGTH} characters.`}
          value={password}
          error={fields.password}
          onChange={setPassword}
        />

        {acceptFailure && !fields.companyName && !fields.name && !fields.password && (
          <FormError>{acceptFailure.message}</FormError>
        )}

        <button
          type="submit"
          disabled={accept.isPending}
          className="mt-2 rounded-md bg-slate-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
        >
          {accept.isPending ? 'Joining…' : 'Accept invitation'}
        </button>
      </form>
    </main>
  );
}
