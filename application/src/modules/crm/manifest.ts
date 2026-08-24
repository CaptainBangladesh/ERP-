import { CRM_MODULE } from '@erp/shared';
import type { FrontendModuleManifest } from '../../app/module-manifest';
import { DashboardPage } from './pages/DashboardPage';
import { DealsPage } from './pages/DealsPage';
import { LeadsPage } from './pages/LeadsPage';
import { WorkflowRulesPage } from './pages/WorkflowRulesPage';

export const manifest: FrontendModuleManifest = {
  name: CRM_MODULE,
  routes: [
    { path: '/crm/dashboard', component: DashboardPage },
    { path: '/crm/leads', component: LeadsPage },
    { path: '/crm/deals', component: DealsPage },
    { path: '/crm/workflow-rules', component: WorkflowRulesPage },
  ],
};


