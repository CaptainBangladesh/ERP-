import { CRM_MODULE } from '@erp/shared';
import type { FrontendModuleManifest } from '../../app/module-manifest';
import { DashboardPage } from './pages/DashboardPage';
import { ContactsPage } from './pages/ContactsPage';
import { DealsPage } from './pages/DealsPage';
import { LeadsPage } from './pages/LeadsPage';
import { LeadWorkspace, CRM_LEAD_WORKSPACE_ROUTE } from './pages/LeadWorkspace';
import { WorkflowRulesPage } from './pages/WorkflowRulesPage';
import { CaptureSourcesPage } from './pages/CaptureSourcesPage';
import { CampaignsPage } from './pages/CampaignsPage';
import { PublicFormRoute } from '../../pages/PublicFormPage';

export const manifest: FrontendModuleManifest = {
  name: CRM_MODULE,
  routes: [
    { path: '/crm/dashboard', component: DashboardPage },
    { path: '/crm/leads', component: LeadsPage },
    { path: CRM_LEAD_WORKSPACE_ROUTE, component: LeadWorkspace },
    { path: '/crm/contacts', component: ContactsPage },
    { path: '/crm/capture-sources', component: CaptureSourcesPage },
    { path: '/crm/campaigns', component: CampaignsPage },
    { path: '/crm/deals', component: DealsPage },
    { path: '/crm/workflow-rules', component: WorkflowRulesPage },
    { path: '/public/crm/form', component: PublicFormRoute, public: true },
  ],
};

