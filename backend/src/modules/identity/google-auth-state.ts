import {
  AUTH_PATHS,
  AUTH_SCREEN_PATHS,
  GOOGLE_AUTH_RETURN_PARAMS,
  IDENTITY_ERROR_CODES,
  SESSION_TOKEN_PARAM,
  type GoogleAuthMode,
  type SignUpIntent,
} from '@erp/shared';
import { ApiException } from '../../http/api-exception';

/**
 * Everything about a Google sign-in that has to survive leaving the application.
 *
 * The round trip through accounts.google.com is two full page loads, so the tab that started
 * it keeps nothing: not which button was pressed, not which of the two sign-up options was
 * chosen, not the company name that was typed into the form. All of it travels in Google's
 * `state` parameter, which is handed back untouched alongside the code, and comes out the
 * other side in `decodeGoogleAuthState`.
 *
 * `kind` marks it as this flow's, so a `state` that came from somewhere else is recognised as
 * not ours rather than misread as a sign-in.
 */
export interface GoogleAuthState {
  mode: GoogleAuthMode;
  intent: SignUpIntent;
  companyName: string;
  name: string;
  /** The application's origin, so the callback sends the browser back where it came from. */
  returnTo: string;
}

/** Marks a `state` as belonging to this flow rather than the mailbox one. */
const IDENTITY_AUTH = 'identity_auth';

export function encodeGoogleAuthState(state: GoogleAuthState): string {
  return Buffer.from(JSON.stringify({ kind: IDENTITY_AUTH, ...state }), 'utf-8').toString(
    'base64url',
  );
}

/**
 * Reads a `state` back, or answers `null` for one that did not come from here.
 *
 * `null` is not a failure: the mailbox connection uses the same callback with a state of its
 * own, and "this is not an identity sign-in" is the ordinary answer for it.
 *
 * Nothing that arrives in `state` is trusted as fact about *who* anybody is — it carries only
 * what the user themselves chose on the form. The identity in this flow comes from the code
 * exchange with Google and from nowhere else.
 */
export function decodeGoogleAuthState(state: unknown): GoogleAuthState | null {
  if (typeof state !== 'string' || state.length === 0) return null;

  try {
    const decoded = JSON.parse(Buffer.from(state, 'base64url').toString('utf-8'));
    if (decoded?.kind !== IDENTITY_AUTH) return null;

    return {
      mode: decoded.mode === 'signup' ? 'signup' : 'signin',
      intent: decoded.intent === 'account' ? 'account' : 'company',
      companyName: typeof decoded.companyName === 'string' ? decoded.companyName : '',
      name: typeof decoded.name === 'string' ? decoded.name : '',
      returnTo: typeof decoded.returnTo === 'string' ? decoded.returnTo : frontendOrigin(),
    };
  } catch {
    return null;
  }
}

/**
 * The address Google is told to send the browser back to.
 *
 * It must match what is registered in the Google project exactly, character for character —
 * and it is sent twice, once to start the flow and again to exchange the code — which is why
 * it is one function read by both halves rather than a string written out at each end.
 *
 * Its own variable rather than the one the mailbox connection uses: they are two different
 * flows landing on two different routes, and a single setting would mean one of them always
 * pointed at the other's callback.
 */
export function googleRedirectUri(): string {
  const envUri = process.env.GOOGLE_AUTH_REDIRECT_URI?.trim();
  return envUri || `${backendOrigin()}${AUTH_PATHS.googleCallback}`;
}

function backendOrigin(): string {
  const url = process.env.BACKEND_URL || process.env.RENDER_EXTERNAL_URL;
  if (url) return url.trim().replace(/\/$/, '');
  return `http://localhost:${process.env.PORT || 3000}`;
}

/**
 * Where the application lives, as an origin the callback can redirect to.
 *
 * Taken from the request's `Referer` when there is one, so a developer on a second port and a
 * deployment on a real domain both come back to the tab they started in, and fall back to
 * `FRONTEND_URL` for a request that carried none.
 */
export function frontendOrigin(referer?: unknown): string {
  if (process.env.FRONTEND_URL) {
    try {
      return new URL(process.env.FRONTEND_URL).origin;
    } catch {
      // Invalid FRONTEND_URL, fall through to referer check
    }
  }

  if (typeof referer === 'string' && referer.length > 0) {
    try {
      const url = new URL(referer);
      if (!url.hostname.includes('google.com') && !url.hostname.includes('googleapis.com')) {
        return url.origin;
      }
    } catch {
      // Not a URL. The configured origin below is the better answer than a guess.
    }
  }

  return 'http://localhost:5173';
}

/**
 * Where the browser goes once a Google round trip has succeeded: the dashboard, carrying the
 * session it just earned.
 */
export function googleSuccessUrl(state: GoogleAuthState, token: string): string {
  const url = new URL(AUTH_SCREEN_PATHS.dashboard, state.returnTo);
  url.searchParams.set(SESSION_TOKEN_PARAM, token);
  return url.toString();
}

/**
 * Where the browser goes when it has not: back to the form it started from, told what went
 * wrong and still holding what the user had chosen.
 *
 * A redirect is the only channel available — the failure happens in a callback the user's tab
 * is being bounced through, with no page of ours running to receive a response body — so the
 * refusal travels as its own error code on the query string, and each screen decides how to
 * say it. The company name and the chosen option come back too, so returning to a refused
 * sign-up means fixing one field rather than filling the form again.
 *
 * An unknown failure is never dressed up as something specific: it comes back as the generic
 * code, and the screen says the attempt failed rather than inventing a reason.
 */
export function googleFailureUrl(state: GoogleAuthState, cause: unknown): string {
  const code = cause instanceof ApiException ? cause.code : undefined;

  if (state.mode !== 'signup') {
    const url = new URL(AUTH_SCREEN_PATHS.signIn, state.returnTo);
    url.searchParams.set(
      GOOGLE_AUTH_RETURN_PARAMS.error,
      code ?? IDENTITY_ERROR_CODES.googleAuthFailed,
    );
    return url.toString();
  }

  const url = new URL(AUTH_SCREEN_PATHS.signUp, state.returnTo);
  url.searchParams.set(
    GOOGLE_AUTH_RETURN_PARAMS.error,
    code ?? IDENTITY_ERROR_CODES.googleAuthFailed,
  );
  url.searchParams.set(GOOGLE_AUTH_RETURN_PARAMS.intent, state.intent);
  if (state.companyName) {
    url.searchParams.set(GOOGLE_AUTH_RETURN_PARAMS.companyName, state.companyName);
  }
  return url.toString();
}

/**
 * A link that works in an email.
 *
 * `RECOVERY_LINKS` builds frontend *paths* — `/accept-invitation?token=…` — which is right
 * for a browser already on the site and useless in a mailbox: a recipient sees text with no
 * host, nothing to click, and no way to guess where it belongs. Every link this system mails
 * has to carry the origin, and it is the same origin the Google round trip returns to, so it
 * is read here rather than assembled again per message.
 *
 * `FRONTEND_URL` is what makes this correct in a deployment. Without it the fallback is the
 * development server, which is the right answer on a laptop and a broken link in production —
 * so a deployment that sends mail must set it.
 */
export function emailLink(path: string): string {
  return new URL(path, frontendOrigin()).toString();
}
