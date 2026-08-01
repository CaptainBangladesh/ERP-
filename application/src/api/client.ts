import { isApiError, type ApiError } from '@erp/shared';

/**
 * The one way the frontend talks to the API.
 *
 * Every failure arrives as an `ApiFailure` carrying the backend's stable `code` and a
 * message safe to show a user, so screens never parse raw responses. Ticket 04 extends this
 * with the per-field validation breakdown that forms bind to.
 */
export class ApiFailure extends Error {
  readonly code: string;
  readonly status: number;

  constructor(status: number, error: ApiError) {
    super(error.message);
    this.name = 'ApiFailure';
    this.code = error.code;
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;

  try {
    response = await fetch(path, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
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
    throw new ApiFailure(
      response.status,
      isApiError(body)
        ? body
        : { code: 'internal_error', message: 'Something went wrong. Please try again.' },
    );
  }

  return body as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, payload?: unknown) =>
    request<T>(path, {
      method: 'POST',
      body: payload === undefined ? undefined : JSON.stringify(payload),
    }),
};
