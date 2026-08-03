import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { tierRank } from '@erp/shared';
import { IS_PUBLIC, SESSION_REQUEST_KEY, type RequestSession } from '../auth';
// By file rather than through `../modules`: that barrel exports `ApplicationModule`, which
// imports this guard, and a cycle through it leaves the injection token undefined at the
// moment the decorator runs. Inside the platform, import the file you mean — the same trap
// `navigation.controller.ts` already documents.
import { MODULE_REGISTRY } from '../modules/registry';
import type { AssembledModules } from '../modules/manifest';
import { Tenancy } from '../tenancy';
import { NO_PERMISSION_KEY } from './no-permission-required.decorator';
import { PERMISSION_KEY } from './require-permission.decorator';
import { forbidden, moduleUnavailable } from './refusals';

/**
 * The last of the three guards on every request: who you are, what company you act as, and now
 * whether that company's plan and your own permissions reach this particular handler.
 *
 * Registered after `TenancyGuard`, which is what makes `tenancy.holds(...)` mean anything here —
 * by the time this guard runs, the caller's grants are already the ones their roles resolved to
 * (or `'all'`, for the owner). Nothing below reads `session.user.isOwner` directly; that
 * distinction is already folded into `session.permissions` by the time a session exists at all.
 *
 * Tier and permission are checked from the *same* string. A required permission's own prefix —
 * `hrm:pay-runs:write` names module `hrm` — is which module a handler belongs to, so there is no
 * second declaration for tier availability to drift from the first, and no module anywhere has
 * to know tiers exist.
 */
@Injectable()
export class AccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tenancy: Tenancy,
    @Inject(MODULE_REGISTRY) private readonly registry: AssembledModules,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const handlers = [context.getHandler(), context.getClass()];

    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, handlers)) return true;
    if (this.reflector.getAllAndOverride<string>(NO_PERMISSION_KEY, handlers)) return true;

    // Nothing declared at all. `check:conformance` refuses this over every backend controller,
    // so it should be unreachable — and it refuses rather than allows anyway, because the one
    // way to be wrong about that is to have left an endpoint open. Guarded by default is the
    // posture everywhere else here; an undeclared handler is not an exception to it.
    const permission = this.reflector.getAllAndOverride<string>(PERMISSION_KEY, handlers);
    if (!permission) throw forbidden();

    const request = context.switchToHttp().getRequest<Record<string, unknown>>();
    const session = request[SESSION_REQUEST_KEY] as RequestSession | undefined;
    // No session at all, on a handler that requires a permission: `SessionGuard` refuses that
    // before this runs, so there is nothing to resolve a permission against if we get here.
    if (!session) throw forbidden();

    const owner = this.registry.manifests.find(
      (manifest) => manifest.name === permission.split(':')[0],
    );
    if (owner && tierRank(session.company.tier) < tierRank(owner.tier)) {
      throw moduleUnavailable();
    }

    if (!this.tenancy.holds(permission)) throw forbidden();

    return true;
  }
}
