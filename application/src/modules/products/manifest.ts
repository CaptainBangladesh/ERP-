import { PRODUCTS_MODULE } from '@erp/shared';
import type { FrontendModuleManifest } from '../../app/module-manifest';
import { ProductsPage } from './pages/ProductsPage';
import { UnitsPage } from './pages/UnitsPage';

/**
 * Which component renders which path — the one thing the server cannot decide.
 *
 * Found by the registry because this file exists at this path; no route table anywhere lists
 * it. The paths match the navigation entries the backend manifest declares, which is how a
 * menu entry finds a screen.
 *
 * Two screens for one module, mirroring the two routes the backend owns. Units are not a
 * detail of a product — a unit exists before any product uses one — so they get a page of
 * their own rather than a tab inside the catalogue.
 */
export const manifest: FrontendModuleManifest = {
  name: PRODUCTS_MODULE,
  routes: [
    { path: '/products', component: ProductsPage },
    { path: '/units', component: UnitsPage },
  ],
};
