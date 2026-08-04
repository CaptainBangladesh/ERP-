import { INVENTORY_MODULE } from '@erp/shared';
import type { FrontendModuleManifest } from '../../app/module-manifest';
import { LocationsPage } from './pages/LocationsPage';
import { MovementsPage } from './pages/MovementsPage';
import { StockPage } from './pages/StockPage';

/**
 * Which component renders which path — the one thing the server cannot decide.
 *
 * Found by the registry because this file exists at this path; no route table anywhere lists
 * it. Each path matches a navigation entry the backend manifest declares, which is how a menu
 * entry finds a screen — and each of those entries is guarded by a permission, so a caller who
 * may read stock and not the ledger sees one of these and not the other.
 *
 * Three screens, because they are three jobs. Maintaining the list of places, recording what
 * arrived and left, and reading the history of everything that ever did are done by different
 * people on different days — and the middle one is the only one that writes anything.
 */
export const manifest: FrontendModuleManifest = {
  name: INVENTORY_MODULE,
  routes: [
    { path: '/locations', component: LocationsPage },
    { path: '/stock', component: StockPage },
    { path: '/movements', component: MovementsPage },
  ],
};
