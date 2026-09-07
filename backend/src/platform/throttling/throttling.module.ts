import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { ThrottlingGuard } from './throttling.guard';

/**
 * HTTP rate limiting, application-wide.
 *
 * Until ticket 11 there was none anywhere in this application, while three unauthenticated
 * endpoints took writes — one of them straight into the CRM pipeline. The mechanism is global
 * so that a new public endpoint only has to declare `@Throttle(...)`; the numbers are per
 * handler so that no endpoint inherits a limit nobody chose for it.
 *
 * **Storage is in-memory, and that is a decision rather than a default.** The counters live in
 * one process, so the limits are *per instance*: two instances behind a load balancer mean
 * twice the stated number, and a restart forgets every window. That is acceptable while the
 * deploy is single-instance, and adding Redis for it would contradict the marketing module's
 * zero-new-infrastructure charter. The moment this runs on more than one instance, shared
 * storage becomes a blocker rather than an improvement — see
 * `src/modules/marketing/README.md`, which carries the numbers and this caveat together.
 */
@Global()
@Module({
  imports: [
    ThrottlerModule.forRoot({
      // Named 'default' because that is the bucket `@Throttle({ limit, ttl })` overrides. The
      // values here are never reached: the guard skips any handler that did not declare one.
      throttlers: [{ name: 'default', limit: 60, ttl: 60_000 }],
    }),
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlingGuard }],
})
export class ThrottlingModule {}
