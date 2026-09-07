import { MARKETING_MODULE, MARKETING_ROUTE } from '@erp/shared';
import type { ModuleManifest } from '../../platform/modules';
import { MarketingModule } from './marketing.module';

/**
 * Marketing, declared.
 *
 * Everything the application knows about this module before it starts it. Read without
 * running anything, which is what lets the build refuse a bad module graph rather than a
 * deployment discovering one.
 */
export const manifest: ModuleManifest = {
  name: MARKETING_MODULE,

  tier: 'core',

  /**
   * The modules this one may reach, and the only ones it may import. Note what does *not*
   * belong here: the company comes from the platform's tenant scoping and the caller from
   * its session seam, so neither makes this module depend on identity.
   */
  dependsOn: ['crm', 'parties'],

  nestModule: MarketingModule,

  routes: [MARKETING_ROUTE],

  migrations: [
    '20260906121344_marketing',
    '20260906130000_marketing_brands_social_accounts',
    '20260906140000_marketing_jobs_queue',
    '20260906150000_social_publishing_engine',
    '20260906160000_campaigns_and_attribution_engine',
    '20260906170000_inbound_lead_gen_and_crm_handoff',
    '20260906180000_unified_social_inbox_and_dm_flows',
    '20260906190000_tracking_pixel_and_visitor_analytics',
    '20260907120000_publishing_quota_network_attempt',
    '20260907130000_marketing_reliability_and_vault',
    '20260907140000_composer_intelligence',
  ],

  models: [
    'Marketing',
    'MarketingBrand',
    'BrandMember',
    'SocialAccount',
    'MarketingJob',
    'ScheduledPost',
    'Autolist',
    'AutolistItem',
    'MarketingCampaign',
    'SmartLink',
    'SmartLinkClick',
    'AdAccountSync',
    'LeadCaptureForm',
    'LeadCaptureSubmission',
    'NurtureSequence',
    'SocialMessage',
    'DmAutomationFlow',
    'TrackingSite',
    'PageViewEvent',
    'PostingTimeInsight',
    'ComposerSnippet',
  ],

  permissions: [
    'marketing:marketing:read',
    'marketing:marketing:write',
    'marketing:brands:read',
    'marketing:brands:write',
    'marketing:social-accounts:read',
    'marketing:social-accounts:write',
    'marketing:jobs:read',
    'marketing:jobs:write',
    'marketing:posts:read',
    'marketing:posts:write',
    'marketing:autolists:read',
    'marketing:autolists:write',
    'marketing:campaigns:read',
    'marketing:campaigns:write',
    'marketing:smart-links:read',
    'marketing:smart-links:write',
    'marketing:ad-sync:read',
    'marketing:ad-sync:write',
    'marketing:forms:read',
    'marketing:forms:write',
    'marketing:nurture:read',
    'marketing:nurture:write',
    'marketing:inbox:read',
    'marketing:inbox:write',
    'marketing:dm-flows:read',
    'marketing:dm-flows:write',
    'marketing:tracking:read',
    'marketing:tracking:write',
    'marketing:insights:read',
    'marketing:insights:write',
    'marketing:snippets:read',
    'marketing:snippets:write',
  ],

  navigation: [
    {
      label: 'Marketing',
      path: '/marketing',
      order: 50,
      permission: 'marketing:marketing:read',
    },
  ],

  /**
   * Domain events emitted by the marketing engine.
   */
  events: {
    emits: ['marketing.lead.captured'],
    consumes: [],
  },
};
