import {
  INVENTORY_EVENTS,
  INVENTORY_MODULE,
  INVENTORY_SETTINGS_ROUTE,
  LOCATIONS_ROUTE,
  MOVEMENTS_ROUTE,
  STOCK_ROUTE,
} from '@erp/shared';
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
   * unit column. Locations alone did not need it; movements are what call it, and it is the
   * module that depends on products rather than whichever screen happens to.
   *
   * Not identity, even though every movement records who made it. The acting user arrives
   * through the platform's session seam and their *name* is copied onto the ledger row at the
   * moment of recording, so nothing here ever has to ask identity who somebody was — which is
   * just as well, since identity's public surface is deliberately empty. See `schema.prisma`
   * on why freezing the name is the right column for an audit trail anyway.
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
   * Four routes. The first three are named for their resource rather than for the module — as
   * products owns `api/products` and `api/units`. Movements and stock are siblings rather than
   * one nested under the other: they answer different questions (what happened, and what there
   * is) and are read by different people.
   *
   * The fourth is the exception that proves it. `api/inventory/settings` is named for the
   * module because what it configures *is* the module — whether a movement that would go
   * negative is refused — rather than a resource anybody lists.
   */
  routes: [LOCATIONS_ROUTE, MOVEMENTS_ROUTE, STOCK_ROUTE, INVENTORY_SETTINGS_ROUTE],

  migrations: [
    '20260804023340_inventory',
    '20260804032520_inventory_stock_movements',
    '20260804040000_inventory_adjustments_and_transfers',
    '20260804050000_reversals_and_negative_stock_policy',
  ],

  models: ['Location', 'StockMovement', 'StockLevel', 'InventorySetting'],

  /**
   * Permissions for inventory: locations, movements, and stock read/write (settings).
   */
  permissions: [
    'inventory:locations:read',
    'inventory:locations:write',
    'inventory:movements:read',
    'inventory:movements:write',
    'inventory:stock:read',
    'inventory:stock:write',
  ],

  navigation: [
    { label: 'Locations', path: '/locations', order: 30, permission: 'inventory:locations:read' },
    { label: 'Stock', path: '/stock', order: 31, permission: 'inventory:stock:read' },
    { label: 'Valuation', path: '/valuation', order: 32, permission: 'inventory:stock:read' },
    { label: 'Movements', path: '/movements', order: 33, permission: 'inventory:movements:read' },
  ],

  /**
   * The accounting seam, declared.
   *
   * One event, and nothing consumes it — which is the point rather than a gap. Accounting is
   * the sink Sales, Purchase, Payroll and Manufacturing all eventually write to, and a sink
   * retrofitted means reopening every movement type and backfilling history. Every movement
   * already carries the value and classification a journal entry needs, and announces itself
   * by a name declared in the wire contract, so the module that eventually listens binds to a
   * promise rather than to this file.
   *
   * `consumes` stays empty and is not a placeholder: the assembler refuses a consumed event no
   * declared dependency emits, so naming one before something emits it would let a module bind
   * to something that never fires.
   */
  events: {
    emits: [INVENTORY_EVENTS.movementRecorded],
    consumes: [],
  },
};
