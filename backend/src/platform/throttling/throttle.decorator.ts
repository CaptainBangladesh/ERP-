import { applyDecorators, SetMetadata } from '@nestjs/common';
import { Throttle as ThrottleUpstream, SkipThrottle } from '@nestjs/throttler';

/** Marks a handler as one the guard actually enforces. See `ThrottlingGuard.shouldSkip`. */
export const THROTTLED = 'platform:throttled';

/** Which route parameter, if any, forms part of the bucket key alongside the caller's IP. */
export const THROTTLE_BY = 'platform:throttle-by';

export interface ThrottleOptions {
  /**
   * Requests allowed inside the window.
   *
   * Named `max` rather than `limit` because `limit:` is the platform's paging word and the
   * conformance pack refuses it in a module — see `hand-rolled-paging`.
   */
  readonly max: number;
  /** The window, in milliseconds. */
  readonly ttl: number;
  /**
   * A route parameter to key on as well as the caller.
   *
   * `'formId'` on the form submit endpoint means one form being flooded cannot spend another
   * form's budget — the abusive caller exhausts one bucket, not the endpoint. Omit it and the
   * bucket is the caller plus the route.
   */
  readonly by?: string;
}

/**
 * A rate limit on one handler.
 *
 * Deliberately opt-in rather than a blanket default. Every limit in this application names a
 * number somebody chose for that endpoint, because a global default is a number nobody chose
 * that becomes the reason an internal screen starts failing under a busy day's traffic.
 *
 * Wraps `@nestjs/throttler` rather than replacing it — the storage, the window arithmetic and
 * the guard lifecycle are its business. What is ours is which handlers are enforced, how the
 * bucket is keyed, and what a refusal looks like on the wire.
 */
export function Throttle(options: ThrottleOptions): MethodDecorator & ClassDecorator {
  return applyDecorators(
    SetMetadata(THROTTLED, true),
    SetMetadata(THROTTLE_BY, options.by ?? null),
    ThrottleUpstream({ default: { limit: options.max, ttl: options.ttl } }),
  );
}

export { SkipThrottle };
