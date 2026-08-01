import { AsyncLocalStorage } from 'node:async_hooks';
import { Injectable } from '@nestjs/common';

/**
 * Which company is acting, and what it is allowed to see.
 *
 * Established once per request from the session and read by the Prisma extension on every
 * query. Nothing above the foundation ever constructs one, and no module ever reads one:
 * that is the point — a module that could read the company could also forget to.
 */
export interface TenantContext {
  readonly companyId: string;

  /**
   * The grants the caller holds, for fields restricted beyond company scope.
   *
   * `'all'` until ticket 07 introduces roles. Until then the only distinction the system can
   * actually make is the one it derives rather than stores: a company's owner created it and
   * holds everything; nobody else holds anything. That is a deliberately blunt interim rule,
   * and it lives here so ticket 07 changes this one line and nothing else.
   */
  readonly grants: 'all' | ReadonlySet<string>;
}

export function holdsGrant(context: TenantContext, grant: string): boolean {
  return context.grants === 'all' || context.grants.has(grant);
}

/**
 * What is in scope right now. Mutable because the two halves happen at different moments:
 * the request opens the scope before anything is known about the caller, and the guard fills
 * the company in once the session has resolved.
 *
 * That split is not incidental. Async local storage keeps a value for the duration of a
 * *callback*, and the only place in a Nest request with a callback wrapping the whole of it
 * is middleware — which runs before guards, when there is no session yet. Opening an empty
 * scope early and filling it later is what lets one mechanism cover the whole request
 * without reaching for `enterWith`, whose leakage between sibling tasks is exactly the kind
 * of bug this file exists to prevent.
 */
interface Scope {
  context?: TenantContext;
  /** Set by `withoutCompanyScope`, carrying the reason for the audit trail in the message. */
  suspendedFor?: string;
}

/**
 * The company context for the current unit of work.
 *
 * Injectable so a module can reach `withoutCompanyScope` — identity does, because it
 * establishes the tenant and therefore runs before one exists. Everything else about it is
 * the platform's business.
 */
@Injectable()
export class Tenancy {
  private readonly storage = new AsyncLocalStorage<Scope>();

  /**
   * Opens an empty scope for the whole of a request. Called by the middleware, before the
   * guard knows who the caller is.
   */
  openScope<T>(work: () => T): T {
    return this.storage.run({}, work);
  }

  /** Fills in the company, once the session has resolved. Called by the tenancy guard. */
  enter(context: TenantContext): void {
    const scope = this.storage.getStore();
    if (!scope) {
      throw new Error(
        'Tenancy.enter was called outside a scope. The tenancy middleware opens one for ' +
          'every request; work outside a request uses runInCompany instead.',
      );
    }
    scope.context = context;
  }

  /**
   * Acts as a company for the duration of a callback.
   *
   * For work that is not a request — a test arranging state, a script, and eventually a
   * scheduled job. A request never needs it: the middleware and the guard have already done
   * it, and doing it again would be a second answer to a settled question.
   *
   * The `await` inside is load-bearing. A Prisma call returns a lazy promise that does not
   * touch the database until something awaits it, so handing the caller's promise back
   * unawaited would run the query *after* the scope had closed — and the query would then
   * throw for want of a company it was given. Awaiting here means the work happens inside
   * the scope whether or not the caller's callback remembers to await anything.
   */
  async runInCompany<T>(context: TenantContext, work: () => Promise<T> | T): Promise<T> {
    return this.storage.run({ context }, async () => await work());
  }

  /**
   * Suspends scoping, for the small number of places that legitimately act before a company
   * exists.
   *
   * There is exactly one such place today and it is identity: sign-in finds a user by email
   * across every company, because until it has found them there is no company to be in. Any
   * other use is almost certainly a bug being worked around.
   *
   * The reason is required and goes in the message of anything that fails inside — the same
   * bargain `@Public()` strikes. A hole in the mechanism should be greppable and should cost
   * whoever opens it a sentence.
   */
  async withoutCompanyScope<T>(reason: string, work: () => Promise<T> | T): Promise<T> {
    return this.storage.run(
      { ...this.storage.getStore(), suspendedFor: reason },
      async () => await work(),
    );
  }

  /**
   * The acting company, or `undefined` if there is none — because no scope was opened, or
   * because the caller is not signed in, or because scoping is suspended.
   *
   * The extension turns `undefined` into a throw. Nothing else reads this.
   */
  current(): TenantContext | undefined {
    const scope = this.storage.getStore();
    if (!scope || scope.suspendedFor) return undefined;
    return scope.context;
  }

  /**
   * Whether the caller holds a grant.
   *
   * The interim of an interim. A module needs this only where a restricted field is central
   * to what an endpoint does — calculating a pay run reads salaries, so it has to refuse
   * outright rather than quietly compute over omitted values. Ticket 07 turns that into a
   * declarative permission on the handler, at which point this has one caller fewer.
   */
  holds(grant: string): boolean {
    const context = this.current();
    return context !== undefined && holdsGrant(context, grant);
  }

  /** Whether scoping is deliberately suspended, as against simply absent. */
  isSuspended(): boolean {
    return this.storage.getStore()?.suspendedFor !== undefined;
  }
}
