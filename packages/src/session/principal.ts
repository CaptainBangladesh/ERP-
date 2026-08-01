/**
 * Who is making a request.
 *
 * A primitive rather than part of identity's contract, because it is what *every* module
 * sees. The platform guard resolves one on each request; ticket 03 takes the company from
 * it and pushes it into async local storage, which is what makes tenant scoping automatic.
 * If this lived in identity's contract, the platform would have to import a module to
 * describe its own callers.
 *
 * Identity is the module that knows how to produce one. It is not the only module that
 * consumes one.
 */

export interface SignedInCompany {
  id: string;
  name: string;
}

export interface SignedInUser {
  id: string;
  name: string;
  email: string;
  /** Derived from having created the company, never from a seeded role row. */
  isOwner: boolean;
}

/** What a signed-in caller is, as it crosses the network. */
export interface Session {
  user: SignedInUser;
  company: SignedInCompany;
  /** ISO 8601. The frontend does not enforce it — the API does — but it can pre-empt it. */
  expiresAt: string;
}

/**
 * How a session travels. The transport, not the mechanism: the platform reads these to find
 * a token without knowing what issued it or what it means.
 */
export const AUTH_HEADER = 'authorization';
export const AUTH_SCHEME = 'Bearer';
