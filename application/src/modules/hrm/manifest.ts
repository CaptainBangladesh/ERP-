import { HRM_MODULE } from '@erp/shared';
import type { FrontendModuleManifest } from '../../app/module-manifest';
import { EmployeesPage } from './pages/EmployeesPage';

/**
 * The stub's one screen, declared.
 *
 * Found by the registry because this file exists at this path — no route table anywhere
 * lists it, exactly as with identity. The path matches the navigation entry the backend
 * manifest declares, which is how a menu entry finds a screen: the server decides what
 * appears in the menu, and this decides what renders when it is clicked.
 */
export const manifest: FrontendModuleManifest = {
  name: HRM_MODULE,
  routes: [{ path: '/hrm/employees', component: EmployeesPage }],
};
