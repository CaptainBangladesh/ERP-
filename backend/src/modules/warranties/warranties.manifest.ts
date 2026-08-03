import { WARRANTIES_MODULE, WARRANTIES_ROUTE } from '@erp/shared';
import type { ModuleManifest } from '../../platform/modules';
import { WarrantiesModule } from './warranties.module';

/**
 * Warranties, declared — the add-on shape stub.
 *
 * The second of the two shapes the foundation must never harden away from: an optional,
 * Custom-tier industry add-on that depends on and extends a Core module through its public
 * contract, without editing that module. Generated with `npm run new:module -- --name
 * warranties --tier custom --depends-on products --record Warranty`, then hand-filled — the
 * same two-step process `products` itself was built by.
 *
 * `custom` is the highest tier, so a company has to be granted it explicitly; a `core` or
 * `enterprise` company cannot reach this module's endpoints or see it in navigation, and
 * nothing in this file or in `warranties.service.ts` says so — `AccessGuard` and
 * `NavigationController` decide that from the tier declared below, which is the whole point
 * of "no module needs to know tiers exist".
 */
export const manifest: ModuleManifest = {
  name: WARRANTIES_MODULE,

  tier: 'custom',

  /**
   * `products`, and only `products`. A warranty is recorded against a product, resolved
   * through `ProductCatalogue` — `products`' public contract — never by reading its tables.
   * Note what does *not* belong here: the company comes from the platform's tenant scoping
   * and the caller from its session seam, so neither makes this module depend on identity.
   */
  dependsOn: ['products'],

  nestModule: WarrantiesModule,

  routes: [WARRANTIES_ROUTE],

  migrations: ['20260803181432_warranties', '20260803181622_warranties_product_and_months'],

  models: ['Warranty'],

  permissions: ['warranties:warranties:read', 'warranties:warranties:write'],

  navigation: [
    {
      label: 'Warranties',
      path: '/warranties',
      order: 50,
      permission: 'warranties:warranties:read',
    },
  ],

  /**
   * Nothing yet, and that is the right default. A declared event is a promise the assembler
   * enforces; one nobody consumes is a promise made to nobody. Declare it when something
   * listens.
   */
  events: {
    emits: [],
    consumes: [],
  },
};
