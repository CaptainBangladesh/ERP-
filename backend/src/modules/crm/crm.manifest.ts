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
    '20260901000000_lead_workspace_artifacts',
    '20260901001000_lead_email_open_activity',
    '20260901002000_lead_submission_mapped_fields',
  ],

  models: [
    'Lead',
    'LeadGroup',
    'LeadSource',
    'LeadFieldDefinition',
    'LeadStatusLabel',
    'LeadImport',
    'LeadAttachment',
    'LeadSubmission',
    'LeadEmailSend',
    'Stage',
    'Deal',
    'Activity',
    'WorkflowRule',
    'Notification',
    'Campaign',
    'CampaignRecipient',
    'CaptureSource',
    'EmailTemplate',
    'MailboxConnection',
    'MailboxAuthState',
    'Unsubscribe',
  ],

  permissions: [
    'crm:dashboard:read',
    'crm:leads:read',
    'crm:leads:write',
    /**
     * Seeing the Contacts board. CRM's own, because a module may only guard its navigation
     * with permissions it declares — and the board is CRM's screen even though the people on
     * it are parties' records.
     *
     * It governs the menu entry and nothing else: the contacts themselves are read with
     * `parties:parties:read` and edited with `parties:parties:write`, enforced by parties'
     * own endpoints. A role granted this and not those reaches a board that says so.
     */
    'crm:contacts:read',
    'crm:stages:read',
    'crm:stages:write',
    'crm:deals:read',
    'crm:deals:write',
    'crm:activities:read',
    'crm:activities:write',
    'crm:workflow-rules:read',
    'crm:workflow-rules:write',
    'crm:lead-fields:read',
    'crm:lead-fields:write',
    'crm:lead-groups:read',
    'crm:lead-groups:write',
    'crm:lead-sources:read',
    'crm:lead-sources:write',
    'crm:lead-status-labels:read',
    'crm:lead-status-labels:write',
    'crm:mailboxes:read',
    'crm:mailboxes:write',
    'crm:email-templates:read',
    'crm:email-templates:write',
    'crm:campaigns:read',
    'crm:campaigns:write',
    'crm:capture-sources:read',
    'crm:capture-sources:write',
    'crm:lead-imports:read',
    'crm:lead-imports:write',
  ],

  navigation: [
    { label: 'Deals', path: '/crm/deals', order: 48, permission: 'crm:deals:read' },
    { label: 'Leads', path: '/crm/leads', order: 49, permission: 'crm:leads:read' },
    { label: 'Contacts', path: '/crm/contacts', order: 50, permission: 'crm:contacts:read' },
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
