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
    '20260906000000_activity_assignee',
    '20260906010000_scripts_playbooks',
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
    'LeadAssignee',
    'Stage',
    'Deal',
    'Activity',
    'WorkflowRule',
    'Notification',
    'Campaign',
    'CampaignRecipient',
    'CaptureSource',
    'EmailTemplate',
    'Script',
    'Playbook',
    'PlaybookStep',
    'PlaybookEnrollment',
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
    /**
     * The manager-versus-rep split for Sales Enablement & Planning, expressed as RBAC strings
     * rather than a new role model — the platform already has Role/RolePermission/UserRole.
     *
     * `crm:team:read` gates the team-facing planning surfaces (the scheduling calendar, the
     * activity heatmap and the who-owns-what coordination view) and their aggregate endpoints:
     * a rep sees their own slice, a manager granted this sees the whole team. `crm:team:manage`
     * is the write half — assigning a task to a *colleague* (self-assignment is always allowed),
     * and reassigning leads and deals across reps to balance load.
     */
    'crm:team:read',
    'crm:team:manage',
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
    /**
     * Authoring the company's sales scripts and playbooks — the manager gate for the
     * content-and-guidance track. Only `:write` exists: *reading* scripts and running the
     * guided-selling surfaces is what any rep working a lead does, so those endpoints ride on
     * `crm:leads:read`/`crm:leads:write` (the same posture email-templates take, whose reads
     * ride on `crm:leads:read`). This one string gates creating/editing/deleting scripts and
     * playbooks, and the Playbooks authoring page in the nav.
     */
    'crm:playbooks:write',
    'crm:campaigns:read',
    'crm:campaigns:write',
    'crm:capture-sources:read',
    'crm:capture-sources:write',
    'crm:lead-imports:read',
    'crm:lead-imports:write',
  ],

  navigation: [
    /**
     * The lead-working surface, reached straight from the nav rather than only by clicking a
     * lead — the worklist, the activity feed and the next-step rail, opened on the first lead.
     * It is the *same* screen a lead click opens, not a second one: one workspace, two doors.
     * Guarded by `leads:read`, because working a lead is what it is for.
     */
    /**
     * The Sales Enablement & Planning home — the team scheduling calendar, the activity heatmap,
     * and the who-owns-what coordination view, under one section. Gated by `crm:team:read`, so a
     * rep without it never sees the nav entry; a manager granted it opens the whole team's slate.
     * It leads the CRM section because planning is where a manager starts the day.
     */
    { label: 'Planning', path: '/crm/planning', order: 46, permission: 'crm:team:read' },
    { label: 'Workspace', path: '/crm/workspace', order: 47, permission: 'crm:leads:read' },
    { label: 'Deals', path: '/crm/deals', order: 48, permission: 'crm:deals:read' },
    { label: 'Leads', path: '/crm/leads', order: 49, permission: 'crm:leads:read' },
    { label: 'Contacts', path: '/crm/contacts', order: 50, permission: 'crm:contacts:read' },
    { label: 'Accounts', path: '/parties', order: 51, permission: 'crm:leads:read' },
    /**
     * The whole team's feed, personal and colleague activity in one timeline. Its own screen at
     * its own path — it pointed at `/crm/leads` for a while, which is why Leads and Activities
     * opened the same board and neither could tell you it was the wrong one.
     */
    { label: 'Activities', path: '/crm/activities', order: 52, permission: 'crm:activities:read' },
    { label: 'Sales Dashboard', path: '/crm/dashboard', order: 53, permission: 'crm:dashboard:read' },
    { label: 'Workflow Rules', path: '/crm/workflow-rules', order: 54, permission: 'crm:workflow-rules:read' },
    /**
     * Where a company builds the forms its leads answer — its own web forms, and the webhook a
     * Google Form posts to. The page and its route existed with no way to reach either: a
     * screen nobody can navigate to is a screen that does not ship, and the Survey tab on a
     * lead had nowhere to send somebody asking where submissions come from.
     */
    { label: 'Forms', path: '/crm/capture-sources', order: 55, permission: 'crm:capture-sources:read' },
    { label: 'Campaigns', path: '/crm/campaigns', order: 56, permission: 'crm:campaigns:read' },
    /**
     * Where a manager authors the company's call/objection scripts and the playbooks that
     * sequence them — the content the lead workspace surfaces in context. Gated by
     * `crm:playbooks:write`: a rep without it never sees the entry, but still gets the scripts
     * and next-best-action on every lead they work.
     */
    { label: 'Playbooks', path: '/crm/playbooks', order: 57, permission: 'crm:playbooks:write' },
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
