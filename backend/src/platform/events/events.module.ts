import { Global, Module } from '@nestjs/common';
import { DomainEvents } from './domain-events';

/**
 * Global, like `TenancyModule` and `MailModule` and for the same reason: announcing something
 * is a thing any module may need to do, and none of them should have to declare a dependency
 * on the platform to do it — the platform is not a module and cannot be named in a manifest's
 * `dependsOn`.
 *
 * What a module *does* declare is the event names themselves, in `events.emits` and
 * `events.consumes`. That is where the checking lives: `assembleModules` refuses a consumed
 * event no declared dependency emits, so the graph is real without this module knowing a single
 * name.
 */
@Global()
@Module({
  providers: [DomainEvents],
  exports: [DomainEvents],
})
export class EventsModule {}
