import { PARTIES_MODULE } from '@erp/shared';
import type { FrontendModuleManifest } from '../../app/module-manifest';
import { PartiesPage } from './pages/PartiesPage';

/**
 * The address book's one screen, declared.
 *
 * Found by the registry because this file exists at this path — no route table anywhere
 * lists it. The path matches the navigation entry the backend manifest declares, which is
 * how a menu entry finds a screen: the server decides what appears in the menu, and this
 * decides what renders when it is clicked.
 */
export const manifest: FrontendModuleManifest = {
  name: PARTIES_MODULE,
  routes: [{ path: '/parties', component: PartiesPage }],
};
