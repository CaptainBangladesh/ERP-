/**
 * How often one caller may hit one endpoint.
 *
 * A module declares `@Throttle({ limit, ttl, by })` on a handler and gets a 429 with
 * `Retry-After` when a caller exceeds it. Nothing is limited by default — see
 * `throttle.decorator.ts` for why opt-in, and `throttling.module.ts` for what the in-memory
 * store does not promise.
 */
export { SkipThrottle, Throttle, THROTTLE_BY, THROTTLED, type ThrottleOptions } from './throttle.decorator';
export { ThrottlingGuard } from './throttling.guard';
export { ThrottlingModule } from './throttling.module';
