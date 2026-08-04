import { INVENTORY_MODULE } from '@erp/shared';
import type { FrontendModuleManifest } from '../../app/module-manifest';
import { InventorySettingsPage } from './pages/InventorySettingsPage';
import { LocationsPage } from './pages/LocationsPage';
import { MovementsPage } from './pages/MovementsPage';
import { StockPage } from './pages/StockPage';
import { ValuationPage } from './pages/ValuationPage';

/**
 * Which component renders which path — the one thing the server cannot decide.
 *
 * Found by the registry because this file exists at this path; no route table anywhere lists
 * it. Each path matches a navigation entry the backend manifest declares, which is how a menu
 * entry finds a screen — and each of those entries is guarded by a permission, so a caller who
 * may read stock and not the ledger sees one of these and not the other.
 */
export const manifest: FrontendModuleManifest = {
  name: INVENTORY_MODULE,
  routes: [
    { path: '/locations', component: LocationsPage },
    { path: '/stock', component: StockPage },
    { path: '/valuation', component: ValuationPage },
    { path: '/movements', component: MovementsPage },
    { path: '/inventory/settings', component: InventorySettingsPage },
  ],
};
