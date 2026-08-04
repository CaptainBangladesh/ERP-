/**
 * In-process domain events — how one module tells the rest of the system what happened without
 * knowing who is listening.
 *
 * A module needs `DomainEvents` and the two types below, and nothing else. The event *names*
 * are not here: they belong to the module that emits them, declared in its wire contract and in
 * its manifest, because a name only the platform knew would be a seam nobody could bind to.
 *
 * See `domain-events.ts` for why this is a class with a `Map` in it rather than a broker, and
 * what happens when a listener throws.
 */
export {
  DomainEvents,
  type DomainEvent,
  type DomainEventListener,
} from './domain-events';
export { EventsModule } from './events.module';
