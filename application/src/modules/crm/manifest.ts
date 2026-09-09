import { lazy } from 'react';
import { CRM_MODULE } from '@erp/shared';
import type { FrontendModuleManifest } from '../../app/module-manifest';
import { CRM_LEAD_WORKSPACE_ROUTE } from './lead-routes';

const DashboardPage = lazy(() => import('./pages/DashboardPage').then((m) => ({ default: m.DashboardPage })));
const TeamPlanningPage = lazy(() => import('./pages/TeamPlanningPage').then((m) => ({ default: m.TeamPlanningPage })));
const MyPlannerPage = lazy(() => import('./pages/MyPlannerPage').then((m) => ({ default: m.MyPlannerPage })));
const TeamPlanPage = lazy(() => import('./pages/TeamPlanPage').then((m) => ({ default: m.TeamPlanPage })));
const WorkspaceEntry = lazy(() => import('./pages/WorkspaceEntry').then((m) => ({ default: m.WorkspaceEntry })));
const ActivitiesPage = lazy(() => import('./pages/ActivitiesPage').then((m) => ({ default: m.ActivitiesPage })));
const LeadsPage = lazy(() => import('./pages/LeadsPage').then((m) => ({ default: m.LeadsPage })));
const LeadWorkspace = lazy(() => import('./pages/LeadWorkspace').then((m) => ({ default: m.LeadWorkspace })));
const ContactsPage = lazy(() => import('./pages/ContactsPage').then((m) => ({ default: m.ContactsPage })));
const CaptureSourcesPage = lazy(() => import('./pages/CaptureSourcesPage').then((m) => ({ default: m.CaptureSourcesPage })));
const CampaignsPage = lazy(() => import('./pages/CampaignsPage').then((m) => ({ default: m.CampaignsPage })));
const DealsPage = lazy(() => import('./pages/DealsPage').then((m) => ({ default: m.DealsPage })));
const WorkflowRulesPage = lazy(() => import('./pages/WorkflowRulesPage').then((m) => ({ default: m.WorkflowRulesPage })));
const PlaybooksPage = lazy(() => import('./pages/PlaybooksPage').then((m) => ({ default: m.PlaybooksPage })));
const PublicFormRoute = lazy(() => import('../../pages/PublicFormPage').then((m) => ({ default: m.PublicFormRoute })));

export const manifest: FrontendModuleManifest = {
  name: CRM_MODULE,
  routes: [
    { path: '/crm/dashboard', component: DashboardPage },
    { path: '/crm/planning', component: TeamPlanningPage },
    { path: '/crm/planner', component: MyPlannerPage },
    { path: '/crm/team-plan', component: TeamPlanPage },
    { path: '/crm/workspace', component: WorkspaceEntry },
    { path: '/crm/activities', component: ActivitiesPage },
    { path: '/crm/leads', component: LeadsPage },
    { path: CRM_LEAD_WORKSPACE_ROUTE, component: LeadWorkspace },
    { path: '/crm/contacts', component: ContactsPage },
    { path: '/crm/capture-sources', component: CaptureSourcesPage },
    { path: '/crm/campaigns', component: CampaignsPage },
    { path: '/crm/deals', component: DealsPage },
    { path: '/crm/workflow-rules', component: WorkflowRulesPage },
    { path: '/crm/playbooks', component: PlaybooksPage },
    { path: '/public/crm/form', component: PublicFormRoute, public: true },
  ],
};
