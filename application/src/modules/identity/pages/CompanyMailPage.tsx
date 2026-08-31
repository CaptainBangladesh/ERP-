import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  IDENTITY_PATHS,
  ERROR_CODES,
  type CompanyMailSettingsResponse,
  type UpdateCompanyMailSettingsRequest,
} from '@erp/shared';
import { ApiFailure, api } from '../../../api/client';
import { Field, FormError } from '@erp/shared/ui';

/**
 * Where this company's own mail goes out from.
 *
 * Invitations and password resets used to leave through whatever the server's environment
 * said, which meant changing them was a file edit and a restart by whoever had access to the
 * machine — not the person who actually knows the mailbox password. This is that setting,
 * moved to where the people who run the company can reach it.
 *
 * Saving proves the details against the mail host before storing them, so "saved" here means
 * the next invitation will genuinely arrive rather than that seven fields were written down.
 */
export function CompanyMailPage() {
  const queryClient = useQueryClient();

  const settings = useQuery({
    queryKey: ['company-mail'],
    queryFn: () => api.get<CompanyMailSettingsResponse>(IDENTITY_PATHS.companyMail),
  });

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold text-slate-900">Company mail</h1>
        <p className="mt-2 text-sm text-slate-600">
          The account this company's invitations and password resets are sent from. Until this
          is set, they go out through whatever the server itself is configured with.
        </p>
      </header>

      {settings.isPending ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : settings.isError ? (
        <FormError>Could not load these settings.</FormError>
      ) : (
        <MailSettingsForm
          current={settings.data}
          onSaved={() => queryClient.invalidateQueries({ queryKey: ['company-mail'] })}
        />
      )}
    </main>
  );
}

function MailSettingsForm({
  current,
  onSaved,
}: {
  current: CompanyMailSettingsResponse;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<UpdateCompanyMailSettingsRequest>({
    fromAddress: current.fromAddress,
    fromName: current.fromName,
    host: current.host,
    port: current.port,
    secure: current.secure,
    username: current.username,
    password: '',
  });

  const save = useMutation({
    mutationFn: () =>
      api.patch<CompanyMailSettingsResponse>(IDENTITY_PATHS.companyMail, {
        ...form,
        // Blank means "keep the stored one" rather than "set it to nothing", so editing the
        // sender's name does not make somebody retype a password.
        password: form.password?.trim() ? form.password : undefined,
      }),
    onSuccess: () => {
      setForm({ ...form, password: '' });
      onSaved();
    },
  });

  const stop = useMutation({
    mutationFn: () => api.delete<CompanyMailSettingsResponse>(IDENTITY_PATHS.companyMail),
    onSuccess: onSaved,
  });

  const failure = save.error instanceof ApiFailure ? save.error : undefined;
  const fields = failure?.fields ?? {};

  return (
    <form
      noValidate
      className="flex flex-col gap-4 rounded-lg border border-slate-200 bg-white p-6"
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate();
      }}
    >
      <div
        role="status"
        className={`rounded-md px-3 py-2 text-xs font-medium ${
          current.configured
            ? 'bg-emerald-50 text-emerald-800'
            : 'bg-amber-50 text-amber-900'
        }`}
      >
        {current.configured
          ? `Sending through ${current.host} as ${current.fromAddress}.`
          : 'Not set up yet — mail is going out through the server’s own configuration.'}
      </div>

      <Field
        id="fromAddress"
        label="Send from"
        type="email"
        value={form.fromAddress}
        error={fields.fromAddress}
        hint={fields.fromAddress ? undefined : 'The address your team will see mail arrive from.'}
        onChange={(fromAddress) => setForm({ ...form, fromAddress })}
      />
      <Field
        id="fromName"
        label="Sender name"
        value={form.fromName ?? ''}
        error={fields.fromName}
        onChange={(fromName) => setForm({ ...form, fromName })}
      />
      <Field
        id="host"
        label="Mail server"
        value={form.host}
        error={fields.host}
        hint={fields.host ? undefined : 'For Namecheap Private Email: mail.privateemail.com'}
        onChange={(host) => setForm({ ...form, host })}
      />
      <Field
        id="port"
        label="Port"
        value={String(form.port)}
        error={fields.port}
        inputMode="numeric"
        onChange={(value) => setForm({ ...form, port: Number(value) || 0 })}
      />
      <Field
        id="username"
        label="Username"
        value={form.username}
        error={fields.username}
        hint={fields.username ? undefined : 'Usually the same as the address above.'}
        onChange={(username) => setForm({ ...form, username })}
      />
      <Field
        id="password"
        label="Password"
        type="password"
        value={form.password ?? ''}
        error={fields.password}
        hint={
          fields.password
            ? undefined
            : current.configured
              ? 'Leave blank to keep the password already saved.'
              : 'Stored encrypted. It is never shown again.'
        }
        onChange={(password) => setForm({ ...form, password })}
      />

      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input
          type="checkbox"
          checked={form.secure}
          onChange={(event) => setForm({ ...form, secure: event.target.checked })}
          className="rounded border-slate-300"
        />
        Use SSL (port 465). Leave off for STARTTLS on 587.
      </label>

      {failure && failure.code !== ERROR_CODES.validationFailed && (
        <FormError>{failure.message}</FormError>
      )}

      <div className="mt-2 flex items-center gap-3">
        <button
          type="submit"
          disabled={save.isPending}
          className="rounded-md bg-slate-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
        >
          {save.isPending ? 'Checking with your mail server…' : 'Save and test'}
        </button>

        {current.configured && (
          <button
            type="button"
            onClick={() => stop.mutate()}
            disabled={stop.isPending}
            className="text-sm text-slate-600 underline hover:text-slate-900 disabled:opacity-50"
          >
            Stop using this account
          </button>
        )}
      </div>
    </form>
  );
}
