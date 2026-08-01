# ADR 0002 — Sessions are database rows that tokens name

Status: accepted (ticket 02)

## Context

The spec fixes JWT as the authentication mechanism. A bare JWT is self-contained: the server
verifies a signature and trusts the claims, with no lookup.

That property is also its problem. A token nobody can withdraw stays valid until it expires,
so "sign out" becomes a request the client is trusted to honour rather than a fact the server
holds. Signing out on a shared machine would not end the session; it would ask the browser to
forget it.

The acceptance criteria require sign-out to end the session, and an expired session to be
distinguishable from an absent one.

## Decision

A `sessions` row is the session. The JWT names one — `sid` — and carries the user and
company for context. Authenticating verifies the token *and* loads the row:

- Token unverifiable, row missing, or row revoked → `unauthenticated`
- Row past `expiresAt` → `session_expired`

Signing out sets `revokedAt` on exactly the session that asked, so signing out of one browser
leaves the other alone. Revoking rather than deleting keeps "this was withdrawn"
distinguishable from "this was never issued".

Lifetime is twelve hours, fixed in code. The token's own expiry is set to match the row's, so
a token that outlives its session cannot exist.

`session_expired` is a separate code from `unauthenticated` because the two mean different
things to a person: one was signed in and was timed out, the other never signed in. Only the
first warrants telling them their session ended.

## Consequences

- One indexed primary-key lookup per authenticated request. Cheap, and the alternative is
  either no revocation or a denylist that is a second store to keep consistent.
- The database is now on the authentication path. It already is for every request that does
  anything, so this adds no new dependency.
- Ticket 03 takes the company from the resolved session and pushes it into async local
  storage, which is what makes tenant scoping automatic. That needs a resolved session per
  request, which this already produces.
- Tokens are stored in `localStorage` and sent as `Authorization: Bearer`. The API accepts no
  cookies at all, so CSRF is not reachable. The trade is XSS exposure, acceptable only
  because the frontend dependency rule bars anything shipping third-party markup or CSS, so
  there is no vendor script to be the vector.

## Alternatives considered

**Bare stateless JWT with a short expiry and refresh tokens.** More moving parts, and the
refresh token needs revocation anyway — which is a session row under a different name.

**Session ID in an httpOnly cookie, no JWT.** Immune to XSS token theft and arguably better,
but the spec fixes JWT, and cookies would require CSRF protection that the bearer scheme does
not.
