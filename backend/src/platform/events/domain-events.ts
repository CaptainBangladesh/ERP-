import { Injectable, Logger } from '@nestjs/common';
import { Tenancy } from '../tenancy';

/**
 * One thing that happened, as it reaches a listener.
 *
 * The payload is whatever the emitting module declared in its contract. Everything around it is
 * the platform's, and stamped rather than passed: a module emitting an event should no more
 * write the company onto it than it should write a company filter onto a query, and for the
 * same reason — a module that could write it could forget it, and an event that reached a
 * listener without one would be an entry posted against nobody.
 */
export interface DomainEvent<T = unknown> {
  /** `<module>.<thing>.<happened>`, from the emitting module's own contract. */
  readonly name: string;
  /** The company the work happened in, taken from the acting scope. */
  readonly companyId: string;
  /** When it was emitted, which for an in-process listener is when it happened. */
  readonly at: Date;
  readonly payload: T;
}

export type DomainEventListener<T = unknown> = (event: DomainEvent<T>) => void | Promise<void>;

/**
 * The seam Accounting will bind to, built before Accounting exists.
 *
 * This is the ticket 09 spec's "accounting seam" in one file. Accounting is a *sink*: Sales,
 * Purchase, Payroll and Manufacturing all eventually post to it, and a sink is the expensive
 * retrofit — adding one later means reopening every module that should have been telling it
 * things and backfilling the history nobody recorded. What makes that retrofit cheap instead is
 * that the movements have carried an accounting classification and a value since the first one,
 * and that the announcement of each is a name in a contract rather than a method call.
 *
 * Deliberately small, and deliberately not a message broker:
 *
 * - **In-process and synchronous.** There is one process. A queue would be infrastructure
 *   serving an architecture diagram rather than a requirement, and the durability it would buy
 *   is already bought by the ledger — a listener that missed an event can replay from the rows,
 *   which is exactly what a future Accounting module will do for the movements recorded before
 *   it existed.
 * - **Emitted after the work is committed, and never inside its transaction.** A listener that
 *   ran inside the write would see a movement that could still roll back, and one that was slow
 *   would hold a row lock open. See `MovementsService.record`.
 * - **A listener that throws does not undo what happened.** The movement is the fact; a journal
 *   entry derived from it is a consequence. Letting a failed consequence roll back the fact
 *   would make recording stock depend on Accounting working, which is precisely the dependency
 *   direction this seam exists to prevent. Failures are logged, loudly, and the ledger is what
 *   makes them recoverable.
 *
 * `assembleModules` is the other half: a module declares what it emits and what it consumes, and
 * a consumed event no declared dependency emits fails the build. So the pairing of these strings
 * is checked without a database, and this class never has to be told which names are real.
 */
@Injectable()
export class DomainEvents {
  private readonly logger = new Logger(DomainEvents.name);
  private readonly listeners = new Map<string, Set<DomainEventListener>>();

  constructor(private readonly tenancy: Tenancy) {}

  /**
   * Announces something, to whoever is listening — which today is nobody, and that is the
   * point rather than a gap.
   *
   * Fire-and-forget from the caller's side. It returns nothing to await because there is
   * nothing a module should do differently based on how a listener got on: see the class note
   * on why a failed consequence does not undo the fact.
   */
  emit<T>(name: string, payload: T): void {
    const context = this.tenancy.current();
    if (!context) {
      // Unreachable from a request, where the guard has established the company long before a
      // service runs. Refused rather than defaulted because an event with no company is one a
      // listener would have to guess about, and a guess is how an entry lands on the wrong
      // books.
      throw new Error(
        `'${name}' was emitted with no company in scope. An event carries the company it ` +
          `happened in, taken from the acting scope — so it can only be emitted from inside ` +
          `one. Work outside a request uses 'Tenancy.runInCompany'.`,
      );
    }

    const event: DomainEvent<T> = {
      name,
      companyId: context.companyId,
      at: new Date(),
      payload,
    };

    for (const listener of this.listeners.get(name) ?? []) {
      try {
        // A listener may be async. Its rejection is caught here rather than left to become an
        // unhandled rejection that takes the process down for a journal entry.
        void Promise.resolve(listener(event as DomainEvent)).catch((cause: unknown) => {
          this.failed(name, cause);
        });
      } catch (cause) {
        this.failed(name, cause);
      }
    }
  }

  /**
   * Listens for one event, and answers with the way to stop.
   *
   * Returning the unsubscribe rather than offering an `off(name, listener)` is what makes
   * stopping possible without holding onto the exact function reference — which a test that
   * registered an inline arrow could not do, and a test that cannot unsubscribe is a test that
   * leaks into the next one.
   */
  on<T>(name: string, listener: DomainEventListener<T>): () => void {
    const existing = this.listeners.get(name) ?? new Set<DomainEventListener>();
    existing.add(listener as DomainEventListener);
    this.listeners.set(name, existing);

    return () => {
      existing.delete(listener as DomainEventListener);
    };
  }

  private failed(name: string, cause: unknown): void {
    this.logger.error(
      `A listener for '${name}' failed. What the event describes has already happened and ` +
        `stands; only the reaction to it did not. The ledger is the record, so this is ` +
        `recoverable by replaying from it.`,
      cause instanceof Error ? cause.stack : String(cause),
    );
  }
}
