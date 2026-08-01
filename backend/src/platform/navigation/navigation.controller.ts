import { Controller, Get, Inject } from '@nestjs/common';
import { NAVIGATION_PATH, type NavigationResponse } from '@erp/shared';
// By file rather than through `../modules`: that barrel exports `ApplicationModule`, which
// imports this controller, and a cycle through it leaves the injection token undefined at
// the moment the decorator runs. Inside the platform, import the file you mean.
import { MODULE_REGISTRY } from '../modules/registry';
import type { AssembledModules } from '../modules/manifest';

/**
 * The menu, assembled from what the modules said about themselves.
 *
 * The decision is the server's rather than the client's because ticket 07 filters these by
 * the caller's permissions and their company's tier, and a menu the client assembles is a
 * menu the client can be talked into showing. Doing it here now means that ticket changes
 * one function instead of two codebases.
 *
 * Guarded like everything else: there is no navigation for somebody who is not signed in.
 */
@Controller()
export class NavigationController {
  constructor(
    @Inject(MODULE_REGISTRY) private readonly registry: AssembledModules,
  ) {}

  @Get(NAVIGATION_PATH.replace(/^\//, ''))
  navigation(): NavigationResponse {
    return {
      entries: this.registry.navigation.map(({ module, label, path, order }) => ({
        module,
        label,
        path,
        order,
      })),
    };
  }
}
