import {
  AUTH_PATHS,
  GOOGLE_AUTH_RETURN_PARAMS,
  type GoogleAuthMode,
  type SignUpIntent,
} from '@erp/shared';
import { apiUrl } from '../../api/client';

/**
 * Starting a Google sign-in, and reading what comes back from one.
 *
 * The flow is a redirect rather than a popup or an embedded script: the browser leaves for
 * accounts.google.com and returns to the backend's callback, which sends it on to whichever
 * screen the outcome calls for. That costs the tab its memory — nothing in it survives a
 * navigation away — which is why what the user had chosen travels to the server and comes
 * back on the URL instead of living in this module.
 *
 * There is no client id and no Google URL here. The frontend navigates to *its own API* and
 * the server answers with the redirect, so the credentials and the registered callback
 * address stay in one place: the backend's environment. A bundle carrying them would have to
 * be rebuilt to point at a different Google project, and could drift from what the callback
 * sends back to Google when the code arrives.
 */
export function startGoogleAuth(choice: {
  mode: GoogleAuthMode;
  /** Which of the sign-up screen's two options. Ignored when signing in. */
  intent?: SignUpIntent;
  /** The company being opened or joined. Required by the server when signing up. */
  companyName?: string;
  name?: string;
}): void {
  const query = new URLSearchParams({ mode: choice.mode });
  if (choice.intent) query.set('intent', choice.intent);
  if (choice.companyName?.trim()) query.set('companyName', choice.companyName.trim());
  if (choice.name?.trim()) query.set('name', choice.name.trim());

  // A whole-page navigation, not a fetch: the response is a redirect to Google's own
  // consent screen, which has to be somewhere the user can see and interact with.
  window.location.assign(`${apiUrl(AUTH_PATHS.googleLogin)}?${query.toString()}`);
}

/**
 * What a Google attempt that failed left on the URL of the screen it sent the user back to.
 *
 * An `IDENTITY_ERROR_CODES` value, and — for a sign-up — the option and company name the
 * user had already chosen, so the form can come back the way they left it rather than empty.
 */
export interface GoogleAuthReturn {
  error?: string;
  intent?: SignUpIntent;
  companyName?: string;
}

export function readGoogleAuthReturn(params: URLSearchParams): GoogleAuthReturn {
  const intent = params.get(GOOGLE_AUTH_RETURN_PARAMS.intent);

  return {
    error: params.get(GOOGLE_AUTH_RETURN_PARAMS.error) ?? undefined,
    intent: intent === 'company' || intent === 'account' ? intent : undefined,
    companyName: params.get(GOOGLE_AUTH_RETURN_PARAMS.companyName) ?? undefined,
  };
}
