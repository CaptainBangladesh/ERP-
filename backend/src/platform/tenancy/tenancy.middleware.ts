import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { Tenancy } from './tenancy';

/**
 * Opens a company scope around every request, before anything is known about the caller.
 *
 * Middleware rather than an interceptor, and this is the whole reason: async local storage
 * keeps a value for the duration of a callback, and middleware is the only place in a Nest
 * request whose callback wraps the entire rest of it — guards, pipes, the handler, and
 * everything they await. An interceptor's `next.handle()` is subscribed to after every
 * interceptor has returned, by which time the scope would be closed.
 *
 * The scope starts empty. `TenancyGuard` fills the company in once the session guard has
 * resolved who is asking, which is the first moment there is an answer. Until then — and for
 * the whole of a `@Public()` request — there is no company, and any query against a
 * company-owned table throws. That is the correct failure: sign-in has no company yet, so a
 * query that needed one would be a bug.
 */
@Injectable()
export class TenancyMiddleware implements NestMiddleware {
  constructor(private readonly tenancy: Tenancy) {}

  use(_request: Request, _response: Response, next: NextFunction): void {
    this.tenancy.openScope(() => next());
  }
}
