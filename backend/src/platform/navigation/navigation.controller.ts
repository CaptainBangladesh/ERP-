import { Controller, Get, Inject } from '@nestjs/common';
import { NAVIGATION_PATH, tierRank, type NavigationResponse } from '@erp/shared';
import { CurrentSession, type RequestSession } from '../auth';
import { NoPermissionRequired } from '../authorization';
import { Tenancy } from '../tenancy';
// By file rather than through `../modules`: that barrel exports `ApplicationModule`, which
// imports this controller, and a cycle through it leaves the injection token undefined at
// the moment the decorator runs. Inside the platform, import the file you mean.
import { MODULE_REGISTRY } from '../modules/registry';
import type { AssembledModules } from '../modules/manifest';

/**
 * The menu, assembled from what the modules said about themselves and filtered by who is
 * asking.
 *
 * The decision is the server's rather than the client's, because a menu the client assembled
 * would be a menu the client could be talked into showing. Two filters, both server-side: an
 * entry's owning module has to be within the caller's company's tier, and — where the module
 * named one — the caller has to hold the guarding permission. Neither `tier` nor `permission`
 * leaves this handler; the response carries only what a screen renders.
 *
 * Guarded like everything else: there is no navigation for somebody who is not signed in. It
 * needs no permission of its own — everybody signed in gets *a* navigation response, and what
 * is in it is exactly as guarded as the endpoints it links to.
 */
@Controller()
export class NavigationController {
  constructor(
    @Inject(MODULE_REGISTRY) private readonly registry: AssembledModules,
    private readonly tenancy: Tenancy,
  ) {}

  @Get(NAVIGATION_PATH.replace(/^\//, ''))
  @NoPermissionRequired(
    'Every signed-in user gets a navigation response; its entries are filtered by permission ' +
      'and tier above, not the endpoint as a whole.',
  )
  navigation(@CurrentSession() session: RequestSession): NavigationResponse {
    return {
      entries: this.registry.navigation
        .filter(
          (entry) =>
            tierRank(session.company.tier) >= tierRank(entry.tier) &&
            (!entry.permission || this.tenancy.holds(entry.permission)),
        )
        .map(({ module, label, path, order }) => ({
          module,
          label,
          path,
          order,
        })),
    };
  }
}
