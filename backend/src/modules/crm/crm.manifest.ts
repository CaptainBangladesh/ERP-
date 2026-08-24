import { CRM_MODULE, CRM_ROUTE } from '@erp/shared';
import type { ModuleManifest } from '../../platform/modules';
import { CrmModule } from './crm.module';

/**
 * Crm, declared.
 *
 * Ticket 02's cut was `Lead` alone; ticket 03 adds `Stage` and `Deal`. Everything the
 * application knows about this module before it starts it. Read without running anything,
 * which is what lets the build refuse a bad module graph rather than a deployment discovering
 * one.
 */
export const manifest: ModuleManifest = {
  name: CRM_MODULE,

  /**
   * Core — customers and pipeline are as fundamental as the address book they extend. A
   * Core module can only depend on Core, which is why `hrm` (Enterprise) and `identity`
   * (its public surface is deliberately empty) are both absent from `dependsOn` below.
   */
  tier: 'core',

  /**
   * `parties`, and nothing else. `PartyDirectory` is what lets `qualify` resolve the Party a
   * request names. The company comes from the platform's tenant scoping and the caller from
   * its session seam, so neither makes this module depend on identity.
   */
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

  /**
   * Read and write, in each of crm's namespaces — `leads`, `stages`, `deals`, `activities`, and `workflow-rules`.
   */
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
    { label: 'Dashboard', path: '/crm/dashboard', order: 49, permission: 'crm:dashboard:read' },
    { label: 'Leads', path: '/crm/leads', order: 50, permission: 'crm:leads:read' },
    { label: 'Deals', path: '/crm/deals', order: 51, permission: 'crm:deals:read' },
    { label: 'Workflow Rules', path: '/crm/workflow-rules', order: 52, permission: 'crm:workflow-rules:read' },
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

