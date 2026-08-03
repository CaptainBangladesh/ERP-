import type { ModuleTier } from '../modules/tier.js';

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
  /**
   * Which modules this company can reach at all. Ticket 07's `AccessGuard` reads it fresh on
   * every request — nothing caches it — which is what makes changing a company's tier take
   * effect without a restart.
   */
  tier: ModuleTier;
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
  /**
   * Every permission this caller holds, or `'all'` for the company's owner.
   *
   * `'all'` is not a lie standing in for "we didn't check" — an owner's access is derived from
   * having created the company, the same way `isOwner` is, and it is unconditional so that an
   * owner can never be locked out by a role assigned (or not assigned) to them. Anybody else's
   * array is the union of every role they hold — see `backend/src/modules/identity` — and it is
   * sent to the frontend for exactly one reason: deciding what to render. The API itself checks
   * again on every request; nothing trusts the client's copy.
   */
  permissions: 'all' | string[];
}

/**
 * How a session travels. The transport, not the mechanism: the platform reads these to find
 * a token without knowing what issued it or what it means.
 */
export const AUTH_HEADER = 'authorization';
export const AUTH_SCHEME = 'Bearer';
