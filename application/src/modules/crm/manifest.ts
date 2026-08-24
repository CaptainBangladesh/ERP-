import { CRM_MODULE } from '@erp/shared';
import type { FrontendModuleManifest } from '../../app/module-manifest';
import { LeadsPage } from './pages/LeadsPage';

/**
 * Which component renders which path — the one thing the server cannot decide.
 *
 * Found by the registry because this file exists at this path; no route table anywhere lists
 * it. The path matches the navigation entry the backend manifest declares, which is how a
 * menu entry finds a screen.
 */
export const manifest: FrontendModuleManifest = {
  name: CRM_MODULE,
  routes: [{ path: '/crm/leads', component: LeadsPage }],
};
