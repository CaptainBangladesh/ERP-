import { INVENTORY_MODULE } from '@erp/shared';
import type { FrontendModuleManifest } from '../../app/module-manifest';
import { LocationsPage } from './pages/LocationsPage';

/**
 * Which component renders which path — the one thing the server cannot decide.
 *
 * Found by the registry because this file exists at this path; no route table anywhere lists
 * it. The path matches the navigation entry the backend manifest declares, which is how a menu
 * entry finds a screen.
 *
 * One screen today. Movements get a second in ticket 09, beside this one rather than inside it,
 * because recording what arrived and maintaining the list of places are different jobs done by
 * different people on different days.
 */
export const manifest: FrontendModuleManifest = {
  name: INVENTORY_MODULE,
  routes: [{ path: '/locations', component: LocationsPage }],
};
