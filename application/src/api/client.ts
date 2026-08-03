import { isApiError, isAuthenticationFailure, AUTH_SCHEME, type ApiError } from '@erp/shared';

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
 */
let onSessionUnusable: ((code: string) => void) | undefined;

export function setSessionUnusableHandler(handler: ((code: string) => void) | undefined): void {
  onSessionUnusable = handler;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;

  try {
    response = await fetch(path, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(authToken ? { Authorization: `${AUTH_SCHEME} ${authToken}` } : {}),
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

    if (isAuthenticationFailure(failure.code)) onSessionUnusable?.(failure.code);

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
};

function send<T>(method: string, path: string, payload?: unknown): Promise<T> {
  return request<T>(path, {
    method,
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
}
