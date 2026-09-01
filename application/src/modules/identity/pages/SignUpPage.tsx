import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  AUTH_PATHS,
  AUTH_SCREEN_PATHS,
  ERROR_CODES,
  IDENTITY_ERROR_CODES,
  PASSWORD_MIN_LENGTH,
  type AuthenticatedSession,
  type SignUpIntent,
  type SignUpRequest,
} from '@erp/shared';
import { ApiFailure, api } from '../../../api/client';
import { useSession } from '../../../session/SessionProvider';
import { linkProps, navigate, currentSearchParams } from '../../../app/location';
import { Field, FormError } from '@erp/shared/ui';
import { PasswordStrength } from '../components/PasswordStrength';
import { GoogleButton } from '../components/GoogleButton';
import { readGoogleAuthReturn, startGoogleAuth } from '../google-auth';

/**
 * The way into the system, in the two senses somebody can mean it.
 *
 * Either they are starting a company here, or the company is already here and they are not.
 * Those are different acts with opposite rules about the same field — the name must be free
 * for one and taken for the other — so the screen asks which before it asks anything else,
 * rather than guessing from whether the name turns out to exist. Guessing is how somebody
 * ends up alone inside an empty second copy of their own employer.
 *
 * The company's name is required either way, which is what makes the question answerable at
 * all: it is the only thing either person can say that identifies a company.
 *
 * A visitor with no session is still sent to sign-in rather than here, because the
 * application has no way to know whether the database is empty without an endpoint that
 * would tell an anonymous caller how many companies exist. Sign-in links here prominently
 * instead, which costs a first user one click and tells a prober nothing.
 */
export function SignUpPage() {
  const { adopt } = useSession();

  // A Google attempt that was refused comes back here carrying what the user had chosen, so
  // the form reopens the way they left it and they correct one field instead of all of them.
  const googleReturn = readGoogleAuthReturn(currentSearchParams());

  const [intent, setIntent] = useState<SignUpIntent>(googleReturn.intent ?? 'company');
  const [form, setForm] = useState<SignUpRequest>({
    companyName: googleReturn.companyName ?? '',
    name: '',
    email: '',
    password: '',
  });
  /**
   * The one thing this screen checks itself. Everything else is the server's to judge, but
   * leaving for Google without a company name means a round trip through another website
   * only to come back and be told about an empty box that was in front of them all along.
   */
  const [missingCompanyName, setMissingCompanyName] = useState(false);

  const signUp = useMutation({
    mutationFn: () => api.post<AuthenticatedSession>(AUTH_PATHS.signUp, { ...form, intent }),
    onSuccess: (session) => {
      adopt(session);
      navigate(AUTH_SCREEN_PATHS.dashboard, { replace: true });
    },
  });

  const failure = signUp.error instanceof ApiFailure ? signUp.error : undefined;
  const fields = failure?.fields ?? {};

  const opening = intent === 'company';

  const companyNameError =
    (missingCompanyName ? 'Enter your company name.' : undefined) ??
    fields.companyName ??
    googleFieldMessage(googleReturn.error);

  function chooseIntent(next: SignUpIntent) {
    setIntent(next);
    // The name is judged by the opposite rule now, so whatever it was refused for no longer
    // applies. Leaving the old message under the box would be telling them the wrong thing.
    setMissingCompanyName(false);
    signUp.reset();
  }

  function continueWithGoogle() {
    if (!form.companyName.trim()) {
      setMissingCompanyName(true);
      return;
    }

    startGoogleAuth({
      mode: 'signup',
      intent,
      companyName: form.companyName,
      name: form.name,
    });
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-8 p-6">
      <header className="flex flex-col gap-4">
        {googleReturn.error && !companyNameError && (
          <div
            role="alert"
            className="flex flex-col gap-2 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm font-medium text-amber-900 shadow-2xs"
          >
            {googleReturn.error === IDENTITY_ERROR_CODES.emailAlreadyRegistered ? (
              <>
                <span className="font-semibold text-amber-950">
                  That Google account already has an account here
                </span>
                <span>Sign in with it instead — there is nothing left to set up.</span>
                <a
                  {...linkProps(AUTH_SCREEN_PATHS.signIn)}
                  className="mt-1 self-start font-bold text-slate-900 underline hover:text-slate-700"
                >
                  Sign in with Google →
                </a>
              </>
            ) : googleReturn.error === ERROR_CODES.moduleUnavailable ? (
              <span>Signing up with Google is not configured on this server. Use the form below.</span>
            ) : (
              <span>Signing up with Google did not complete. Try again.</span>
            )}
          </div>
        )}

        <div>
          <h1 className="text-2xl font-semibold text-slate-900">
            {opening ? 'Create a company' : 'Join your company'}
          </h1>
          <p className="mt-2 text-sm text-slate-600">
            {opening
              ? 'You will own it, and can invite the rest of your team once you are in.'
              : 'Your company is already here. This creates your own account inside it.'}
          </p>
        </div>

        <fieldset
          role="radiogroup"
          aria-label="Are you creating a company, or do you work for one?"
          className="grid grid-cols-2 gap-1 rounded-lg border border-slate-200 bg-slate-100 p-1"
        >
          <IntentChoice
            label="Create a company"
            selected={opening}
            onSelect={() => chooseIntent('company')}
          />
          <IntentChoice
            label="I work for a company"
            selected={!opening}
            onSelect={() => chooseIntent('account')}
          />
        </fieldset>
      </header>

      <div className="flex flex-col gap-3">
        <GoogleButton
          label={opening ? 'Create company with Google' : 'Join with Google'}
          onClick={continueWithGoogle}
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
          signUp.mutate();
        }}
      >
        {/* Required for both options — it is the only thing that says which company this is
            about. What differs is the rule behind it, which the hint spells out. */}
        <Field
          id="companyName"
          label="Company name"
          value={form.companyName}
          error={companyNameError}
          hint={
            companyNameError
              ? undefined
              : opening
                ? 'The name you are opening. It cannot be one that already exists.'
                : 'The company you work for, spelled the way it was registered.'
          }
          onChange={(companyName) => {
            setForm({ ...form, companyName });
            if (missingCompanyName) setMissingCompanyName(false);
          }}
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
        <div className="flex flex-col gap-1.5">
          <Field
            id="password"
            label="Password"
            type="password"
            autoComplete="new-password"
            hint={form.password ? undefined : `At least ${PASSWORD_MIN_LENGTH} characters.`}
            value={form.password}
            error={fields.password}
            onChange={(password) => setForm({ ...form, password })}
          />

          {!fields.password && (
            <PasswordStrength
              password={form.password}
              context={[form.companyName, form.name, form.email]}
            />
          )}
        </div>

        {failure && failure.code !== ERROR_CODES.validationFailed && !fields.email && !fields.companyName && (
          <FormError>{failure.message}</FormError>
        )}

        <button
          type="submit"
          disabled={signUp.isPending}
          className="mt-2 rounded-md bg-slate-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
        >
          {signUp.isPending
            ? opening
              ? 'Creating your company…'
              : 'Creating your account…'
            : opening
              ? 'Create company'
              : 'Join company'}
        </button>
      </form>

      <p className="text-sm text-slate-600">
        Already have an account?{' '}
        <a
          {...linkProps(AUTH_SCREEN_PATHS.signIn)}
          className="font-medium text-slate-900 underline"
        >
          Sign in
        </a>
      </p>
    </main>
  );
}

/**
 * The two refusals that are about the company name specifically, said beside the box rather
 * than at the top of the form — the round trip through Google leaves them on the URL, so
 * they arrive without the per-field breakdown an ordinary refusal carries.
 */
function googleFieldMessage(error: string | undefined): string | undefined {
  switch (error) {
    case IDENTITY_ERROR_CODES.companyAlreadyExists:
      return 'A company with that name already exists. If you work there, choose “I work for a company”.';
    case IDENTITY_ERROR_CODES.companyDoesNotExist:
      return 'No company is registered under that name. Check the spelling, or choose “Create a company” to open it.';
    case IDENTITY_ERROR_CODES.companyNameRequired:
      return 'Enter your company name.';
    default:
      return undefined;
  }
}

function IntentChoice({
  label,
  selected,
  onSelect,
}: {
  label: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      // The pair is a choice rather than two actions, and that is what a screen reader has to
      // hear: which one is currently in force, not merely that both can be pressed.
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={`rounded-md py-2 text-xs font-semibold transition ${
        selected ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-600 hover:text-slate-900'
      }`}
    >
      {label}
    </button>
  );
}
