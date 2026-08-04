import { INVENTORY_MODULE, LOCATIONS_ROUTE } from '@erp/shared';
import type { ModuleManifest } from '../../platform/modules';
import { InventoryModule } from './inventory.module';

/**
 * Inventory, declared — the first module the foundation was built *for* rather than around.
 *
 * Generated with `npm run new:module -- --name inventory --tier core --depends-on products
 * --record Location`, then filled in. Everything structural here — the shape of the manifest,
 * the permission namespace, the navigation entry, the migration that came with it — is what
 * the generator wrote; what was added is the domain.
 */
export const manifest: ModuleManifest = {
  name: INVENTORY_MODULE,

  /**
   * Core. Stock is not an upsell: Sales cannot promise what it has not got, Purchase cannot
   * receive against nothing, and Manufacturing both consumes and produces it. A module in a
   * tier above them could not be depended on by the ones below in any case.
   */
  tier: 'core',

  /**
   * Products, and only products.
   *
   * Stock is stock *of something*, and that something is a row in the catalogue rather than a
   * name typed onto a movement. The reference is resolved through `ProductCatalogue` — the
   * public contract — so nothing here reads a products table or knows that a product has a
   * unit column. Locations alone do not need it; movements, in ticket 09, are what call it,
   * and it is the module that depends on products rather than whichever screen happens to.
   *
   * Declaring it now is not free ceremony: it is what makes this module's migrations sort
   * after products', which is the only thing that makes the dependency real to Prisma.
   *
   * Not identity, which looks missing and is not: the company is applied by the platform's
   * tenant scoping and the caller arrives through its session seam. Both are the platform's,
   * and the platform is not a module.
   */
  dependsOn: ['products'],

  nestModule: InventoryModule,

  /**
   * One route today, named for the resource rather than for the module — `api/locations`, as
   * products owns `api/units`. Movements will be a second route beside it rather than a
   * segment underneath it.
   */
  routes: [LOCATIONS_ROUTE],

  migrations: ['20260804023340_inventory'],

  models: ['Location'],

  /**
   * `locations` rather than `inventory`, because a permission is about a resource. When
   * movements arrive they get a pair of their own: somebody who maintains the list of
   * warehouses is not thereby somebody who may write to the stock ledger, and a single
   * `inventory:inventory:write` would have made those one job for ever.
   */
  permissions: ['inventory:locations:read', 'inventory:locations:write'],

  navigation: [
    { label: 'Locations', path: '/locations', order: 30, permission: 'inventory:locations:read' },
  ],

  /**
   * Nothing yet, and that is the right default. A declared event is a promise the assembler
   * enforces; one nobody consumes is a promise made to nobody. Ticket 09 declares the first —
   * a movement, carrying what a journal entry would need — because that is the ticket where
   * there is finally something worth telling somebody about.
   */
  events: {
    emits: [],
    consumes: [],
  },
};
