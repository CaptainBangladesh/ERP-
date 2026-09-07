import { randomBytes } from 'node:crypto';
import { Injectable, NestMiddleware } from '@nestjs/common';

/** Where the nonce is left for the handler that renders the page. */
export const CSP_NONCE = 'marketingCspNonce';

export interface NonceCarrier {
  [CSP_NONCE]?: string;
}

/**
 * The Content Security Policy every public bio-page response carries.
 *
 * Ordered *behind* the validation in `schemas.ts`, never in place of it: this turns a future
 * escaping mistake into a blocked console error rather than a session-stealing script, and it
 * must never become the reason a bad stored value is considered acceptable.
 *
 * No `unsafe-inline`, no `unsafe-eval`, no wildcard `script-src`. `connect-src 'self'` is the
 * one addition to the policy the design pass listed, and it is there because the page's own
 * click beacon is a `sendBeacon` back to this origin — without it the page would render and
 * quietly stop reporting clicks. It grants nothing the other directives were protecting.
 */
function contentSecurityPolicy(nonce: string): string {
  return [
    `default-src 'none'`,
    `style-src 'nonce-${nonce}'`,
    `img-src https: data:`,
    `script-src 'nonce-${nonce}'`,
    `connect-src 'self'`,
    `frame-ancestors 'none'`,
    `base-uri 'none'`,
    `form-action 'none'`,
  ].join('; ');
}

/**
 * Issues one nonce per response and sets the policy that names it.
 *
 * Middleware rather than a handler taking the response object: a handler in this codebase
 * returns a value and throws to refuse, and reaching for the response directly is how a module
 * ends up bypassing `ApiExceptionFilter`. A response *header* that every route under `/b`
 * carries is exactly what middleware is for — and it means a new bio-page route cannot be added
 * without the policy, which is the whole point of putting it here.
 */
@Injectable()
export class BioPageCspMiddleware implements NestMiddleware {
  use(
    req: NonceCarrier,
    res: { setHeader(name: string, value: string): unknown },
    next: () => void,
  ): void {
    // A reused nonce is not a nonce.
    const nonce = randomBytes(16).toString('base64');
    req[CSP_NONCE] = nonce;
    res.setHeader('Content-Security-Policy', contentSecurityPolicy(nonce));
    next();
  }
}
