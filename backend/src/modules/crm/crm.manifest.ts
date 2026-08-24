import { CRM_MODULE, CRM_ROUTE } from '@erp/shared';
import type { ModuleManifest } from '../../platform/modules';
import { CrmModule } from './crm.module';

/**
 * Crm manifest.
 */
export const manifest: ModuleManifest = {
  name: CRM_MODULE,

  tier: 'core',

  dependsOn: ['parties'],

  nestModule: CrmModule,

  routes: [CRM_ROUTE],

  migrations: [
    '20260823234633_crm',
    '20260823235822_lead_management',
    '20260824004534_deal_pipeline',
    '20260824010000_crm_activities',
    '20260824020000_crm_workflow_rules',
  ],

  models: ['Lead', 'Stage', 'Deal', 'Activity', 'WorkflowRule', 'Notification'],

  permissions: [
    'crm:dashboard:read',
    'crm:leads:read',
    'crm:leads:write',
    'crm:stages:read',
    'crm:stages:write',
    'crm:deals:read',
    'crm:deals:write',
    'crm:activities:read',
    'crm:activities:write',
    'crm:workflow-rules:read',
    'crm:workflow-rules:write',
  ],

  navigation: [
    { label: 'Deals', path: '/crm/deals', order: 48, permission: 'crm:deals:read' },
    { label: 'Leads', path: '/crm/leads', order: 49, permission: 'crm:leads:read' },
    { label: 'Contacts', path: '/parties', order: 50, permission: 'crm:leads:read' },
    { label: 'Accounts', path: '/parties', order: 51, permission: 'crm:leads:read' },
    { label: 'Activities', path: '/crm/leads', order: 52, permission: 'crm:activities:read' },
    { label: 'Sales Dashboard', path: '/crm/dashboard', order: 53, permission: 'crm:dashboard:read' },
    { label: 'Workflow Rules', path: '/crm/workflow-rules', order: 54, permission: 'crm:workflow-rules:read' },
  ],

  events: {
    emits: [
      'crm.lead.qualified',
      'crm.lead.disqualified',
      'crm.deal.created',
      'crm.deal.stage_changed',
      'crm.deal.won',
      'crm.deal.lost',
    ],
    consumes: [],
  },
};
