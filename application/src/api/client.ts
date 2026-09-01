import { isApiError, isAuthenticationFailure, AUTH_SCHEME, type ApiError } from '@erp/shared';
import { readStoredToken } from '../session/token-storage';

/**
 * The one way the frontend talks to the API.
 *
 * Every failure arrives as an `ApiFailure` carrying the backend's stable `code`, a message
 * safe to show a user, and — for validation failures — the fields at fault, so screens never
 * parse raw responses and forms never guess which input a message belongs to.
 */
export class ApiFailure extends Error {
  readonly code: string;
  readonly status: number;
  /** Field name to message. Empty unless the failure named fields. */
  readonly fields: Record<string, string>;

  constructor(status: number, error: ApiError) {
    super(error.message);
    this.name = 'ApiFailure';
    this.code = error.code;
    this.status = status;
    this.fields = error.fields ?? {};
  }
}

/**
 * The session token, held outside React.
 *
 * Every request needs it and no component should have to thread it through, so it lives
 * here and `SessionProvider` is the only thing that writes it. Keeping it in one place is
 * also what makes signing out complete: clearing it here means no later request can still
 * be carrying it.
 */
let authToken: string | undefined;

export function setAuthToken(token: string | undefined): void {
  authToken = token;
}

/**
 * The token to send, which is not always the one this module is holding.
 *
 * Module-level state does not survive a hot module replacement: Vite hands the application a
 * *new* copy of this file on every edit, and the new copy's `authToken` starts as `undefined`.
 * React state is preserved across the same update, so `SessionProvider` is never remounted and
 * never re-runs `setAuthToken` — leaving the screen showing who is signed in while every
 * request behind it goes out anonymous and comes back a 401. In development that turns any
 * save into "I have been signed out and my data is gone"; the storage read is what makes the
 * token outlive the module that caches it.
 *
 * Signing out clears storage before it clears this, so there is no window where a request
 * falls back to a token the user has just given up.
 */
function currentToken(): string | undefined {
  return authToken ?? readStoredToken();
}

/**
 * Told whenever any request is refused because the session is no longer usable.
 *
 * It belongs here rather than on a screen because a session does not only fail when the
 * application asks who you are — it fails on whatever request happens to be next after it
 * runs out, which could be any screen's. Watching one query for it would leave a user
 * clicking around a dead application, which is precisely the silent failure this is meant
 * to rule out.
 *
 * Deliberately narrow: `invalid_credentials` is a failed sign-in attempt, not an ended
 * session, and must not fire this.
 *
 * The token the refused request actually carried is passed along, because "the session is
 * over" is a claim about *a* session rather than about whoever is signed in now. Requests
 * from an expiring session are still in flight while the person signs back in, and their
 * refusals land afterwards: without knowing which token was refused, a stale 401 from the
 * previous session ends the new one microseconds after it starts — leaving somebody signed
 * in as far as the screen is concerned, and unauthenticated as far as every request is.
 */
let onSessionUnusable: ((code: string, token: string | undefined) => void) | undefined;

export function setSessionUnusableHandler(
  handler: ((code: string, token: string | undefined) => void) | undefined,
): void {
  onSessionUnusable = handler;
}

/**
 * An API path as an absolute URL.
 *
 * Exported because one thing the application does with the API is not a `fetch` at all: the
 * Google sign-in flow *navigates* the browser to an endpoint that answers with a redirect to
 * Google. That still has to reach the same backend as every request, wherever it is
 * configured to be.
 */
export function apiUrl(path: string): string {
  return resolveUrl(path);
}

function resolveUrl(path: string): string {
  if (path.startsWith('http://') || path.startsWith('https://')) return path;
  const baseUrl = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') || '';
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${baseUrl}${normalizedPath}`;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  // Read once, before awaiting: by the time a refusal comes back, `authToken` may already
  // belong to a different session than the one this request was made under.
  const sentWith = currentToken();

  try {
    response = await fetch(resolveUrl(path), {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(sentWith ? { Authorization: `${AUTH_SCHEME} ${sentWith}` } : {}),
        ...init?.headers,
      },
    });
  } catch {
    // A network failure is not an API error, but a screen should not have to tell the
    // difference to render something useful.
    throw new ApiFailure(0, {
      code: 'network_error',
      message: 'Could not reach the server. Check your connection and try again.',
    });
  }

  const body: unknown = await response.json().catch(() => undefined);

  if (!response.ok) {
    const failure = new ApiFailure(
      response.status,
      isApiError(body)
        ? body
        : { code: 'internal_error', message: 'Something went wrong. Please try again.' },
    );

    if (isAuthenticationFailure(failure.code)) onSessionUnusable?.(failure.code, sentWith);

    throw failure;
  }

  return body as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, payload?: unknown) => send<T>('POST', path, payload),
  /**
   * A partial change. `PATCH` rather than `PUT` throughout, because a screen editing one
   * field of a record should not have to send back every other field it happens to be
   * holding — which is how a stale copy overwrites somebody else's edit.
   */
  patch: <T>(path: string, payload?: unknown) => send<T>('PATCH', path, payload),
  /**
   * Answers with whatever the endpoint answers with, which for this API is usually the
   * record that was changed rather than nothing: removing one of a party's roles leaves the
   * party, and a screen that had to re-fetch it would have two chances to disagree.
   */
  delete: <T>(path: string) => send<T>('DELETE', path),
  /**
   * A `multipart/form-data` POST, for file uploads. Bypasses the JSON `Content-Type` that
   * every other request sends, since the browser must set its own header carrying the
   * multipart boundary — setting it explicitly here would omit that boundary and the server
   * could not parse the body.
   */
  postForm: <T>(path: string, form: FormData) => requestForm<T>(path, form),
  /**
   * A stored file's bytes, rather than JSON.
   *
   * Downloads go through the same request path as everything else because they need the same
   * `Authorization` header, and a bare `<a href>` to an API route carries no token — it would
   * be answered with a 401 the browser renders as a broken image or an empty tab. A screen
   * turns what comes back into an object URL and lets go of it when it is done.
   */
  getBlob: (path: string) => requestBlob(path),
};

function send<T>(method: string, path: string, payload?: unknown): Promise<T> {
  return request<T>(path, {
    method,
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
}

async function requestForm<T>(path: string, form: FormData): Promise<T> {
  let response: Response;
  const sentWith = currentToken();

  try {
    response = await fetch(resolveUrl(path), {
      method: 'POST',
      headers: sentWith ? { Authorization: `${AUTH_SCHEME} ${sentWith}` } : {},
      body: form,
    });
  } catch {
    throw new ApiFailure(0, {
      code: 'network_error',
      message: 'Could not reach the server. Check your connection and try again.',
    });
  }

  const body: unknown = await response.json().catch(() => undefined);

  if (!response.ok) {
    const failure = new ApiFailure(
      response.status,
      isApiError(body)
        ? body
        : { code: 'internal_error', message: 'Something went wrong. Please try again.' },
    );

    if (isAuthenticationFailure(failure.code)) onSessionUnusable?.(failure.code, sentWith);

    throw failure;
  }

  return body as T;
}

async function requestBlob(path: string): Promise<Blob> {
  let response: Response;
  const sentWith = currentToken();

  try {
    response = await fetch(resolveUrl(path), {
      headers: sentWith ? { Authorization: `${AUTH_SCHEME} ${sentWith}` } : {},
    });
  } catch {
    throw new ApiFailure(0, {
      code: 'network_error',
      message: 'Could not reach the server. Check your connection and try again.',
    });
  }

  if (!response.ok) {
    // A refusal is still JSON, even on an endpoint whose success is bytes.
    const body: unknown = await response.json().catch(() => undefined);
    const failure = new ApiFailure(
      response.status,
      isApiError(body)
        ? body
        : { code: 'internal_error', message: 'That file could not be downloaded.' },
    );

    if (isAuthenticationFailure(failure.code)) onSessionUnusable?.(failure.code, sentWith);

    throw failure;
  }

  return response.blob();
}
