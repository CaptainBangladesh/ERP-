import {
  AUTOLIST_REPEAT_MODES,
  AUTOLIST_STATUSES,
  AUTOLIST_TRAVERSAL_MODES,
  BRAND_MEMBER_ROLES,
  MARKETING_FIELDS,
  MARKETING_STATUSES,
  SCHEDULED_POST_STATUSES,
  SOCIAL_ACCOUNT_STATUSES,
  SOCIAL_PLATFORMS,
  MARKETING_CAMPAIGN_STATUSES,
  AD_PLATFORMS,
  type AutolistRepeatMode,
  type AutolistSlot,
  type AutolistStatus,
  type AutolistTraversalMode,
  type BrandMemberRole,
  type MarketingStatus,
  type ScheduledPostStatus,
  type SocialAccountStatus,
  type SocialPlatform,
  type MarketingCampaignStatus,
  type AdPlatform,
} from '@erp/shared';
import type { ListSpec } from '../../platform/list';
import {
  accepted,
  identifier,
  oneOf,
  optional,
  passthroughValidator,
  refused,
  rule,
  text,
  validator,
} from '../../platform/validation';

/**
 * Validation rules and list specifications for Marketing, Brands, and Social Accounts.
 */

// ─── Legacy Marketing ─────────────────────────────────────────────────────────────

const MARKETING_NAME = {
  missing: 'Enter a name.',
  maxLength: 200,
  tooLong: 'Use 200 characters or fewer.',
} as const;

const STATUS = oneOf<MarketingStatus>(MARKETING_STATUSES, {
  missing: 'Say whether this marketing is active.',
  invalid: 'That is not a status you can set.',
});

export const CreateMarketingBody = validator({
  name: text(MARKETING_NAME),
});

export const UpdateMarketingBody = validator({
  name: optional(text(MARKETING_NAME)),
  status: optional(STATUS),
}).and((values, report) => {
  const changed = Object.values(values).some((value) => value !== undefined);
  if (!changed) report('name', 'Change something — this request changes nothing.');
});

export const MARKETING_LIST: ListSpec = {
  defaultSort: MARKETING_FIELDS.name,
  fields: {
    [MARKETING_FIELDS.name]: { type: 'text', sortable: true, filterable: true, searchable: true },
    [MARKETING_FIELDS.status]: { type: 'text', sortable: true, filterable: true },
    [MARKETING_FIELDS.createdAt]: { type: 'date', sortable: true, filterable: true },
  },
};

// ─── Brands ────────────────────────────────────────────────────────────────────────

const BRAND_NAME = {
  missing: 'Enter a brand name.',
  maxLength: 100,
  tooLong: 'Use 100 characters or fewer for brand name.',
} as const;

const BRAND_SLUG = {
  missing: 'Enter a brand slug.',
  maxLength: 100,
  tooLong: 'Use 100 characters or fewer for slug.',
} as const;

const BRAND_TIMEZONE = {
  missing: 'Enter a timezone.',
  maxLength: 50,
  tooLong: 'Use 50 characters or fewer.',
} as const;

const URL_FIELD = {
  missing: 'Enter a URL.',
  maxLength: 500,
  tooLong: 'URL must be 500 characters or fewer.',
} as const;

function jsonObject(fieldDesc: string) {
  return rule<Record<string, unknown>>(`Provide valid ${fieldDesc}.`, (value) => {
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      return accepted(value as Record<string, unknown>);
    }
    return refused(`Must be an object.`);
  });
}

function positiveInteger(missing: string) {
  return rule<number>(missing, (value) => {
    if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
      return accepted(value);
    }
    return refused('Must be a positive integer.');
  });
}

export const CreateBrandBody = validator({
  name: text(BRAND_NAME),
  slug: optional(text(BRAND_SLUG)),
  logoUrl: optional(text(URL_FIELD)),
  brandColors: optional(jsonObject('brand colors')),
  timezone: optional(text(BRAND_TIMEZONE)),
  customDomain: optional(text({ missing: 'Enter custom domain.', maxLength: 100, tooLong: 'Domain is too long.' })),
  storageQuotaMb: optional(positiveInteger('Enter storage quota in megabytes.')),
  settings: optional(jsonObject('settings')),
});

export const UpdateBrandBody = validator({
  name: optional(text(BRAND_NAME)),
  slug: optional(text(BRAND_SLUG)),
  logoUrl: optional(text(URL_FIELD)),
  brandColors: optional(jsonObject('brand colors')),
  timezone: optional(text(BRAND_TIMEZONE)),
  customDomain: optional(text({ missing: 'Enter custom domain.', maxLength: 100, tooLong: 'Domain is too long.' })),
  storageQuotaMb: optional(positiveInteger('Enter storage quota in megabytes.')),
  settings: optional(jsonObject('settings')),
}).and((values, report) => {
  const changed = Object.values(values).some((value) => value !== undefined);
  if (!changed) report('name', 'Change something — this request changes nothing.');
});

export const AddBrandMemberBody = validator({
  userId: identifier({
    missing: 'Select a user to add to the brand.',
    invalid: 'That is not a valid user identifier.',
  }),
  role: optional(
    oneOf<BrandMemberRole>(BRAND_MEMBER_ROLES, {
      missing: 'Select a brand role.',
      invalid: 'Invalid brand member role.',
    }),
  ),
});

export const BRAND_LIST: ListSpec = {
  defaultSort: 'name',
  fields: {
    name: { type: 'text', sortable: true, filterable: true, searchable: true },
    slug: { type: 'text', sortable: true, filterable: true, searchable: true },
    timezone: { type: 'text', sortable: true, filterable: true },
    createdAt: { type: 'date', sortable: true, filterable: true },
  },
};

// ─── Social Accounts & OAuth ────────────────────────────────────────────────────────

const PLATFORM_RULE = oneOf<SocialPlatform>(SOCIAL_PLATFORMS, {
  missing: 'Select a social platform.',
  invalid: 'Unsupported social platform.',
});

const ACCOUNT_NAME = {
  missing: 'Enter an account name or handle.',
  maxLength: 150,
  tooLong: 'Account name must be 150 characters or fewer.',
} as const;

const PLATFORM_ACCOUNT_ID = {
  missing: 'Enter a platform account ID.',
  maxLength: 255,
  tooLong: 'Platform account ID must be 255 characters or fewer.',
} as const;

const SECRET_STRING = {
  missing: 'Enter an access token.',
  maxLength: 4000,
  tooLong: 'Access token must be 4000 characters or fewer.',
} as const;

export const ConnectSocialAccountBody = validator({
  platform: PLATFORM_RULE,
  accountName: text(ACCOUNT_NAME),
  platformAccountId: text(PLATFORM_ACCOUNT_ID),
  accessToken: text(SECRET_STRING),
  refreshToken: optional(text({ missing: 'Enter refresh token.', maxLength: 4000, tooLong: 'Too long.' })),
  expiresIn: optional(positiveInteger('Enter token expiration duration in seconds.')),
  metadata: optional(jsonObject('account metadata')),
});

export const OAuthAuthorizeBody = validator({
  platform: PLATFORM_RULE,
  redirectUri: text(URL_FIELD),
});

export const OAuthCallbackBody = validator({
  code: text({ missing: 'Enter authorization code.', maxLength: 2000, tooLong: 'Code is too long.' }),
  state: text({ missing: 'Enter OAuth state.', maxLength: 2000, tooLong: 'State is too long.' }),
  redirectUri: text(URL_FIELD),
});

export const SOCIAL_ACCOUNT_LIST: ListSpec = {
  defaultSort: 'accountName',
  fields: {
    accountName: { type: 'text', sortable: true, filterable: true, searchable: true },
    platform: { type: 'text', sortable: true, filterable: true },
    status: { type: 'text', sortable: true, filterable: true },
    createdAt: { type: 'date', sortable: true, filterable: true },
  },
};

// ─── Background Jobs ──────────────────────────────────────────────────────────────

export const ScheduleJobBody = validator({
  type: text({ missing: 'Enter job type.', maxLength: 100, tooLong: 'Job type is too long.' }),
  payload: optional(jsonObject('job payload')),
  scheduledAt: optional(text({ missing: 'Enter scheduled timestamp.', maxLength: 50, tooLong: 'Timestamp is too long.' })),
  maxAttempts: optional(positiveInteger('Enter max attempts.')),
});

export const JOB_LIST: ListSpec = {
  defaultSort: 'scheduledAt',
  fields: {
    type: { type: 'text', sortable: true, filterable: true, searchable: true },
    status: { type: 'text', sortable: true, filterable: true },
    scheduledAt: { type: 'date', sortable: true, filterable: true },
    createdAt: { type: 'date', sortable: true, filterable: true },
  },
};

// ─── Helper Validators ────────────────────────────────────────────────────────────

function stringArray(fieldDesc: string) {
  return rule<string[]>(`Provide valid ${fieldDesc}.`, (value) => {
    if (Array.isArray(value) && value.every((v) => typeof v === 'string')) {
      return accepted(value as string[]);
    }
    return refused(`Must be an array of strings.`);
  });
}

function activeSlotsRule() {
  return rule<AutolistSlot[]>('Provide valid active slots.', (value) => {
    if (!Array.isArray(value)) {
      return refused('Must be an array of slot objects.');
    }
    for (const slot of value) {
      if (
        typeof slot !== 'object' ||
        slot === null ||
        typeof (slot as any).dayOfWeek !== 'number' ||
        typeof (slot as any).time !== 'string'
      ) {
        return refused('Each slot must contain dayOfWeek (0-6) and time (HH:mm).');
      }
    }
    return accepted(value as AutolistSlot[]);
  });
}

function idField(entity: string) {
  return identifier({
    missing: `Select a ${entity}.`,
    invalid: `That is not a valid ${entity} identifier.`,
  });
}

// ─── Scheduled Posts ──────────────────────────────────────────────────────────────

const POST_CONTENT = {
  missing: 'Enter post content.',
  maxLength: 10000,
  tooLong: 'Post content must be 10,000 characters or fewer.',
} as const;

const POST_STATUS_RULE = oneOf<ScheduledPostStatus>(SCHEDULED_POST_STATUSES, {
  missing: 'Specify post status.',
  invalid: 'Invalid post status.',
});

export const CreateScheduledPostBody = validator({
  brandId: idField('brand'),
  socialAccountId: idField('social account'),
  content: text(POST_CONTENT),
  mediaUrls: optional(stringArray('media URLs')),
  platformConfig: optional(jsonObject('platform config')),
  scheduledAt: text({ missing: 'Enter scheduled timestamp.', maxLength: 50, tooLong: 'Timestamp is too long.' }),
  campaignId: optional(idField('campaign')),
  autolistItemId: optional(idField('autolist item')),
  status: optional(POST_STATUS_RULE),
});

export const UpdateScheduledPostBody = validator({
  content: optional(text(POST_CONTENT)),
  mediaUrls: optional(stringArray('media URLs')),
  platformConfig: optional(jsonObject('platform config')),
  scheduledAt: optional(text({ missing: 'Enter scheduled timestamp.', maxLength: 50, tooLong: 'Timestamp is too long.' })),
  status: optional(POST_STATUS_RULE),
  socialAccountId: optional(idField('social account')),
});

export const POST_LIST: ListSpec = {
  defaultSort: 'scheduledAt',
  fields: {
    content: { type: 'text', sortable: true, filterable: true, searchable: true },
    scheduledAt: { type: 'date', sortable: true, filterable: true },
    status: { type: 'text', sortable: true, filterable: true },
    brandId: { type: 'text', sortable: false, filterable: true },
    socialAccountId: { type: 'text', sortable: false, filterable: true },
    createdAt: { type: 'date', sortable: true, filterable: true },
  },
};

// ─── Evergreen Autolists ──────────────────────────────────────────────────────────

const AUTOLIST_NAME = {
  missing: 'Enter an autolist name.',
  maxLength: 100,
  tooLong: 'Autolist name must be 100 characters or fewer.',
} as const;

const AUTOLIST_REPEAT_RULE = oneOf<AutolistRepeatMode>(AUTOLIST_REPEAT_MODES, {
  missing: 'Specify repeat mode.',
  invalid: 'Invalid repeat mode.',
});

const AUTOLIST_TRAVERSAL_RULE = oneOf<AutolistTraversalMode>(AUTOLIST_TRAVERSAL_MODES, {
  missing: 'Specify traversal mode.',
  invalid: 'Invalid traversal mode.',
});

const AUTOLIST_STATUS_RULE = oneOf<AutolistStatus>(AUTOLIST_STATUSES, {
  missing: 'Specify autolist status.',
  invalid: 'Invalid autolist status.',
});

export const CreateAutolistBody = validator({
  brandId: idField('brand'),
  name: text(AUTOLIST_NAME),
  description: optional(text({ missing: 'Enter description.', maxLength: 500, tooLong: 'Description is too long.' })),
  repeatMode: optional(AUTOLIST_REPEAT_RULE),
  traversalMode: optional(AUTOLIST_TRAVERSAL_RULE),
  activeSlots: activeSlotsRule(),
  collisionWindowMinutes: optional(positiveInteger('Enter collision window minutes.')),
});

export const UpdateAutolistBody = validator({
  name: optional(text(AUTOLIST_NAME)),
  description: optional(text({ missing: 'Enter description.', maxLength: 500, tooLong: 'Description is too long.' })),
  repeatMode: optional(AUTOLIST_REPEAT_RULE),
  traversalMode: optional(AUTOLIST_TRAVERSAL_RULE),
  activeSlots: optional(activeSlotsRule()),
  status: optional(AUTOLIST_STATUS_RULE),
  collisionWindowMinutes: optional(positiveInteger('Enter collision window minutes.')),
});

export const AUTOLIST_LIST: ListSpec = {
  defaultSort: 'name',
  fields: {
    name: { type: 'text', sortable: true, filterable: true, searchable: true },
    status: { type: 'text', sortable: true, filterable: true },
    brandId: { type: 'text', sortable: false, filterable: true },
    createdAt: { type: 'date', sortable: true, filterable: true },
  },
};

// ─── Autolist Items ───────────────────────────────────────────────────────────────

export const CreateAutolistItemBody = validator({
  content: text(POST_CONTENT),
  mediaUrls: optional(stringArray('media URLs')),
  platformConfig: optional(jsonObject('platform config')),
  orderIndex: optional(rule<number>('Enter order index.', (value) => {
    if (typeof value === 'number' && Number.isInteger(value) && value >= 0) return accepted(value);
    return refused('Order index must be a non-negative integer.');
  })),
});

export const UpdateAutolistItemBody = validator({
  content: optional(text(POST_CONTENT)),
  mediaUrls: optional(stringArray('media URLs')),
  platformConfig: optional(jsonObject('platform config')),
  orderIndex: optional(rule<number>('Enter order index.', (value) => {
    if (typeof value === 'number' && Number.isInteger(value) && value >= 0) return accepted(value);
    return refused('Order index must be a non-negative integer.');
  })),
  status: optional(text({ missing: 'Enter status.', maxLength: 20, tooLong: 'Status is too long.' })),
});

// ─── Campaigns & UTM Links ────────────────────────────────────────────────────────

const CAMPAIGN_NAME = {
  missing: 'Enter a campaign name.',
  maxLength: 150,
  tooLong: 'Campaign name must be 150 characters or fewer.',
} as const;

const CAMPAIGN_STATUS_RULE = oneOf<MarketingCampaignStatus>(MARKETING_CAMPAIGN_STATUSES, {
  missing: 'Select a campaign status.',
  invalid: 'Invalid campaign status.',
});

function nonNegativeNumber(missing: string) {
  return rule<number>(missing, (value) => {
    if (typeof value === 'number' && !Number.isNaN(value) && value >= 0) {
      return accepted(value);
    }
    return refused('Must be a non-negative number.');
  });
}

export const CreateCampaignBody = validator({
  brandId: identifier({ missing: 'Select a brand for the campaign.', invalid: 'Invalid brand ID.' }),
  name: text(CAMPAIGN_NAME),
  description: optional(text({ missing: 'Enter description.', maxLength: 1000, tooLong: 'Description is too long.' })),
  budget: optional(nonNegativeNumber('Enter valid budget amount.')),
  startDate: optional(text({ missing: 'Enter start date.', maxLength: 50, tooLong: 'Date is too long.' })),
  endDate: optional(text({ missing: 'Enter end date.', maxLength: 50, tooLong: 'Date is too long.' })),
  status: optional(CAMPAIGN_STATUS_RULE),
  utmSource: optional(text({ missing: 'Enter UTM source.', maxLength: 100, tooLong: 'UTM source too long.' })),
  utmMedium: optional(text({ missing: 'Enter UTM medium.', maxLength: 100, tooLong: 'UTM medium too long.' })),
  utmCampaign: optional(text({ missing: 'Enter UTM campaign.', maxLength: 100, tooLong: 'UTM campaign too long.' })),
  utmTerm: optional(text({ missing: 'Enter UTM term.', maxLength: 100, tooLong: 'UTM term too long.' })),
  utmContent: optional(text({ missing: 'Enter UTM content.', maxLength: 100, tooLong: 'UTM content too long.' })),
  metadata: optional(jsonObject('campaign metadata')),
});

export const UpdateCampaignBody = validator({
  name: optional(text(CAMPAIGN_NAME)),
  description: optional(text({ missing: 'Enter description.', maxLength: 1000, tooLong: 'Description is too long.' })),
  budget: optional(nonNegativeNumber('Enter valid budget amount.')),
  spent: optional(nonNegativeNumber('Enter valid spent amount.')),
  startDate: optional(text({ missing: 'Enter start date.', maxLength: 50, tooLong: 'Date is too long.' })),
  endDate: optional(text({ missing: 'Enter end date.', maxLength: 50, tooLong: 'Date is too long.' })),
  status: optional(CAMPAIGN_STATUS_RULE),
  utmSource: optional(text({ missing: 'Enter UTM source.', maxLength: 100, tooLong: 'UTM source too long.' })),
  utmMedium: optional(text({ missing: 'Enter UTM medium.', maxLength: 100, tooLong: 'UTM medium too long.' })),
  utmCampaign: optional(text({ missing: 'Enter UTM campaign.', maxLength: 100, tooLong: 'UTM campaign too long.' })),
  utmTerm: optional(text({ missing: 'Enter UTM term.', maxLength: 100, tooLong: 'UTM term too long.' })),
  utmContent: optional(text({ missing: 'Enter UTM content.', maxLength: 100, tooLong: 'UTM content too long.' })),
  metadata: optional(jsonObject('campaign metadata')),
}).and((values, report) => {
  const changed = Object.values(values).some((v) => v !== undefined);
  if (!changed) report('name', 'Change something — this request changes nothing.');
});

export const BuildUtmBody = validator({
  url: text(URL_FIELD),
  source: text({ missing: 'Enter UTM source.', maxLength: 100, tooLong: 'UTM source is too long.' }),
  medium: text({ missing: 'Enter UTM medium.', maxLength: 100, tooLong: 'UTM medium is too long.' }),
  campaign: text({ missing: 'Enter UTM campaign.', maxLength: 100, tooLong: 'UTM campaign is too long.' }),
  term: optional(text({ missing: 'Enter UTM term.', maxLength: 100, tooLong: 'UTM term is too long.' })),
  content: optional(text({ missing: 'Enter UTM content.', maxLength: 100, tooLong: 'UTM content is too long.' })),
  campaignId: optional(identifier({ missing: 'Select campaign.', invalid: 'Invalid campaign ID.' })),
});

export const CAMPAIGN_LIST: ListSpec = {
  defaultSort: 'name',
  fields: {
    name: { type: 'text', sortable: true, filterable: true, searchable: true },
    status: { type: 'text', sortable: true, filterable: true },
    brandId: { type: 'text', sortable: false, filterable: true },
    createdAt: { type: 'date', sortable: true, filterable: true },
  },
};

// ─── SmartLinks (Link-in-Bio) ────────────────────────────────────────────────────────

const SMART_LINK_TITLE = {
  missing: 'Enter a SmartLink page title.',
  maxLength: 150,
  tooLong: 'Title must be 150 characters or fewer.',
} as const;

const SMART_LINK_SLUG = {
  missing: 'Enter a unique URL slug for the bio link.',
  maxLength: 100,
  tooLong: 'Slug must be 100 characters or fewer.',
} as const;

function jsonArray(fieldDesc: string) {
  return rule<any[]>(`Provide valid ${fieldDesc}.`, (value) => {
    if (Array.isArray(value)) {
      return accepted(value);
    }
    return refused(`Must be an array.`);
  });
}

export const CreateSmartLinkBody = validator({
  brandId: identifier({ missing: 'Select a brand.', invalid: 'Invalid brand ID.' }),
  campaignId: optional(identifier({ missing: 'Select campaign.', invalid: 'Invalid campaign ID.' })),
  slug: text(SMART_LINK_SLUG),
  title: text(SMART_LINK_TITLE),
  bio: optional(text({ missing: 'Enter bio text.', maxLength: 500, tooLong: 'Bio is too long.' })),
  avatarUrl: optional(text(URL_FIELD)),
  theme: optional(jsonObject('theme settings')),
  buttonLinks: optional(jsonArray('button links')),
  shoppableGrid: optional(jsonArray('shoppable grid items')),
  socialLinks: optional(jsonArray('social links')),
});

export const UpdateSmartLinkBody = validator({
  campaignId: optional(identifier({ missing: 'Select campaign.', invalid: 'Invalid campaign ID.' })),
  slug: optional(text(SMART_LINK_SLUG)),
  title: optional(text(SMART_LINK_TITLE)),
  bio: optional(text({ missing: 'Enter bio text.', maxLength: 500, tooLong: 'Bio is too long.' })),
  avatarUrl: optional(text(URL_FIELD)),
  theme: optional(jsonObject('theme settings')),
  buttonLinks: optional(jsonArray('button links')),
  shoppableGrid: optional(jsonArray('shoppable grid items')),
  socialLinks: optional(jsonArray('social links')),
  isActive: optional(rule<boolean>('Invalid active status.', (v) => typeof v === 'boolean' ? accepted(v) : refused('Must be boolean.'))),
});

export const RecordSmartLinkClickBody = validator({
  buttonId: optional(text({ missing: 'Enter button ID.', maxLength: 100, tooLong: 'Button ID too long.' })),
  targetUrl: optional(text(URL_FIELD)),
  itemId: optional(text({ missing: 'Enter item ID.', maxLength: 100, tooLong: 'Item ID too long.' })),
});

export const SMART_LINK_LIST: ListSpec = {
  defaultSort: 'title',
  fields: {
    title: { type: 'text', sortable: true, filterable: true, searchable: true },
    slug: { type: 'text', sortable: true, filterable: true, searchable: true },
    brandId: { type: 'text', sortable: false, filterable: true },
    createdAt: { type: 'date', sortable: true, filterable: true },
  },
};

// ─── Ad Account Performance Sync ──────────────────────────────────────────────────

const AD_PLATFORM_RULE = oneOf<AdPlatform>(AD_PLATFORMS, {
  missing: 'Select an ad platform.',
  invalid: 'Invalid ad platform.',
});

export const CreateAdSyncBody = validator({
  brandId: identifier({ missing: 'Select a brand.', invalid: 'Invalid brand ID.' }),
  campaignId: optional(identifier({ missing: 'Select campaign.', invalid: 'Invalid campaign ID.' })),
  platform: AD_PLATFORM_RULE,
  adAccountId: optional(text({ missing: 'Enter ad account ID.', maxLength: 100, tooLong: 'Account ID too long.' })),
  adAccountName: optional(text({ missing: 'Enter ad account name.', maxLength: 150, tooLong: 'Account name too long.' })),
  spend: optional(nonNegativeNumber('Enter spend amount.')),
  impressions: optional(rule<number>('Enter impressions count.', (v) => typeof v === 'number' && v >= 0 ? accepted(v) : refused('Must be non-negative.'))),
  clicks: optional(rule<number>('Enter clicks count.', (v) => typeof v === 'number' && v >= 0 ? accepted(v) : refused('Must be non-negative.'))),
  cpc: optional(nonNegativeNumber('Enter CPC.')),
  roas: optional(nonNegativeNumber('Enter ROAS.')),
  currency: optional(text({ missing: 'Enter currency code.', maxLength: 10, tooLong: 'Currency too long.' })),
});

export const UpdateAdSyncBody = validator({
  campaignId: optional(identifier({ missing: 'Select campaign.', invalid: 'Invalid campaign ID.' })),
  adAccountId: optional(text({ missing: 'Enter ad account ID.', maxLength: 100, tooLong: 'Account ID too long.' })),
  adAccountName: optional(text({ missing: 'Enter ad account name.', maxLength: 150, tooLong: 'Account name too long.' })),
  spend: optional(nonNegativeNumber('Enter spend amount.')),
  impressions: optional(rule<number>('Enter impressions count.', (v) => typeof v === 'number' && v >= 0 ? accepted(v) : refused('Must be non-negative.'))),
  clicks: optional(rule<number>('Enter clicks count.', (v) => typeof v === 'number' && v >= 0 ? accepted(v) : refused('Must be non-negative.'))),
  cpc: optional(nonNegativeNumber('Enter CPC.')),
  roas: optional(nonNegativeNumber('Enter ROAS.')),
  currency: optional(text({ missing: 'Enter currency code.', maxLength: 10, tooLong: 'Currency too long.' })),
});

export const AD_SYNC_LIST: ListSpec = {
  defaultSort: 'syncedAt',
  fields: {
    platform: { type: 'text', sortable: true, filterable: true },
    brandId: { type: 'text', sortable: false, filterable: true },
    syncedAt: { type: 'date', sortable: true, filterable: true },
    createdAt: { type: 'date', sortable: true, filterable: true },
  },
};

// ─── Inbound Lead Gen & CRM Handoff (Ticket 07) ──────────────────────────────────

export const CreateLeadCaptureFormBody = validator({
  brandId: identifier({ missing: 'Select a brand.', invalid: 'Invalid brand ID.' }),
  name: text({ missing: 'Enter form name.', maxLength: 150, tooLong: 'Form name too long.' }),
  description: optional(text({ missing: 'Enter description.', maxLength: 500, tooLong: 'Description too long.' })),
  schemaFields: optional(jsonArray('schema fields')),
});

export const UpdateLeadCaptureFormBody = validator({
  name: optional(text({ missing: 'Enter form name.', maxLength: 150, tooLong: 'Form name too long.' })),
  description: optional(text({ missing: 'Enter description.', maxLength: 500, tooLong: 'Description too long.' })),
  schemaFields: optional(jsonArray('schema fields')),
  isActive: optional(rule<boolean>('Invalid active status.', (v) => typeof v === 'boolean' ? accepted(v) : refused('Must be boolean.'))),
});

export const SubmitPublicFormBody = validator({
  fields: jsonObject('form fields'),
  utm: optional(jsonObject('UTM parameters')),
});

export const CreateNurtureSequenceBody = validator({
  brandId: identifier({ missing: 'Select a brand.', invalid: 'Invalid brand ID.' }),
  name: text({ missing: 'Enter sequence name.', maxLength: 150, tooLong: 'Sequence name too long.' }),
  description: optional(text({ missing: 'Enter description.', maxLength: 500, tooLong: 'Description too long.' })),
  triggerEvent: text({ missing: 'Enter trigger event.', maxLength: 100, tooLong: 'Trigger event too long.' }),
  steps: optional(jsonArray('steps')),
});

export const UpdateNurtureSequenceBody = validator({
  name: optional(text({ missing: 'Enter sequence name.', maxLength: 150, tooLong: 'Sequence name too long.' })),
  description: optional(text({ missing: 'Enter description.', maxLength: 500, tooLong: 'Description too long.' })),
  triggerEvent: optional(text({ missing: 'Enter trigger event.', maxLength: 100, tooLong: 'Trigger event too long.' })),
  steps: optional(jsonArray('steps')),
  status: optional(text({ missing: 'Enter status.', maxLength: 30, tooLong: 'Status too long.' })),
});

export const AdWebhookBody = validator({
  platform: optional(text({ missing: 'Enter platform.', maxLength: 50, tooLong: 'Platform too long.' })),
  brandId: optional(identifier({ missing: 'Select brand.', invalid: 'Invalid brand ID.' })),
  leadData: optional(jsonObject('lead data')),
  field_data: optional(jsonArray('field data')),
  formId: optional(text({ missing: 'Enter form ID.', maxLength: 100, tooLong: 'Form ID too long.' })),
  adAccountId: optional(text({ missing: 'Enter ad account ID.', maxLength: 100, tooLong: 'Ad account ID too long.' })),
  email: optional(text({ missing: 'Enter email.', maxLength: 200, tooLong: 'Email too long.' })),
  name: optional(text({ missing: 'Enter name.', maxLength: 200, tooLong: 'Name too long.' })),
  phone: optional(text({ missing: 'Enter phone.', maxLength: 50, tooLong: 'Phone too long.' })),
  utmSource: optional(text({ missing: 'Enter UTM source.', maxLength: 100, tooLong: 'UTM source too long.' })),
  utmMedium: optional(text({ missing: 'Enter UTM medium.', maxLength: 100, tooLong: 'UTM medium too long.' })),
  utmCampaign: optional(text({ missing: 'Enter UTM campaign.', maxLength: 100, tooLong: 'UTM campaign too long.' })),
});

export const LEAD_FORM_LIST: ListSpec = {
  defaultSort: 'name',
  fields: {
    name: { type: 'text', sortable: true, filterable: true, searchable: true },
    brandId: { type: 'text', sortable: false, filterable: true },
    createdAt: { type: 'date', sortable: true, filterable: true },
  },
};

export const LEAD_SUBMISSION_LIST: ListSpec = {
  defaultSort: 'submittedAt',
  fields: {
    formId: { type: 'text', sortable: false, filterable: true },
    submittedAt: { type: 'date', sortable: true, filterable: true },
  },
};

export const NURTURE_SEQUENCE_LIST: ListSpec = {
  defaultSort: 'name',
  fields: {
    name: { type: 'text', sortable: true, filterable: true, searchable: true },
    brandId: { type: 'text', sortable: false, filterable: true },
    status: { type: 'text', sortable: true, filterable: true },
    createdAt: { type: 'date', sortable: true, filterable: true },
  },
};

// ─── Unified Social Inbox & DM Flows (Ticket 08) ──────────────────────────────────

export const CreateSocialMessageBody = validator({
  brandId: identifier({ missing: 'Select a brand.', invalid: 'Invalid brand ID.' }),
  conversationId: text({ missing: 'Enter conversation ID.', maxLength: 100, tooLong: 'Conversation ID too long.' }),
  senderId: text({ missing: 'Enter sender ID.', maxLength: 100, tooLong: 'Sender ID too long.' }),
  senderName: optional(text({ missing: 'Enter sender name.', maxLength: 150, tooLong: 'Sender name too long.' })),
  senderAvatar: optional(text({ missing: 'Enter avatar URL.', maxLength: 500, tooLong: 'Avatar URL too long.' })),
  socialAccountId: optional(identifier({ missing: 'Select social account.', invalid: 'Invalid social account ID.' })),
  content: text({ missing: 'Enter message content.', maxLength: 2000, tooLong: 'Content too long.' }),
  direction: optional(text({ missing: 'Enter direction.', maxLength: 20, tooLong: 'Direction too long.' })),
  status: optional(text({ missing: 'Enter status.', maxLength: 20, tooLong: 'Status too long.' })),
  metadata: optional(jsonObject('metadata')),
});

export const SendReplyMessageBody = validator({
  brandId: identifier({ missing: 'Select a brand.', invalid: 'Invalid brand ID.' }),
  conversationId: text({ missing: 'Enter conversation ID.', maxLength: 100, tooLong: 'Conversation ID too long.' }),
  content: text({ missing: 'Enter reply content.', maxLength: 2000, tooLong: 'Content too long.' }),
  socialAccountId: optional(identifier({ missing: 'Select social account.', invalid: 'Invalid social account ID.' })),
  recipientId: optional(text({ missing: 'Enter recipient ID.', maxLength: 100, tooLong: 'Recipient ID too long.' })),
  senderName: optional(text({ missing: 'Enter sender name.', maxLength: 150, tooLong: 'Sender name too long.' })),
});

export const UpdateSocialMessageStatusBody = validator({
  status: text({ missing: 'Enter status.', maxLength: 20, tooLong: 'Status too long.' }),
});

export const ConvertConversationToLeadBody = validator({
  brandId: identifier({ missing: 'Select a brand.', invalid: 'Invalid brand ID.' }),
  conversationId: text({ missing: 'Enter conversation ID.', maxLength: 100, tooLong: 'Conversation ID too long.' }),
  name: optional(text({ missing: 'Enter name.', maxLength: 150, tooLong: 'Name too long.' })),
  email: optional(text({ missing: 'Enter email.', maxLength: 200, tooLong: 'Email too long.' })),
  phone: optional(text({ missing: 'Enter phone.', maxLength: 50, tooLong: 'Phone too long.' })),
  organisationName: optional(text({ missing: 'Enter organisation name.', maxLength: 150, tooLong: 'Organisation too long.' })),
});

export const CreateDmAutomationFlowBody = validator({
  brandId: identifier({ missing: 'Select a brand.', invalid: 'Invalid brand ID.' }),
  name: text({ missing: 'Enter flow name.', maxLength: 150, tooLong: 'Flow name too long.' }),
  triggerKeyword: text({ missing: 'Enter trigger keyword.', maxLength: 100, tooLong: 'Trigger keyword too long.' }),
  matchType: optional(text({ missing: 'Enter match type.', maxLength: 20, tooLong: 'Match type too long.' })),
  responseTemplate: text({ missing: 'Enter response template.', maxLength: 2000, tooLong: 'Template too long.' }),
  leadMagnetUrl: optional(text({ missing: 'Enter lead magnet URL.', maxLength: 500, tooLong: 'URL too long.' })),
  socialAccountId: optional(identifier({ missing: 'Select social account.', invalid: 'Invalid social account ID.' })),
  isActive: optional(rule<boolean>('Invalid active status.', (v) => typeof v === 'boolean' ? accepted(v) : refused('Must be boolean.'))),
});

export const UpdateDmAutomationFlowBody = validator({
  name: optional(text({ missing: 'Enter flow name.', maxLength: 150, tooLong: 'Flow name too long.' })),
  triggerKeyword: optional(text({ missing: 'Enter trigger keyword.', maxLength: 100, tooLong: 'Trigger keyword too long.' })),
  matchType: optional(text({ missing: 'Enter match type.', maxLength: 20, tooLong: 'Match type too long.' })),
  responseTemplate: optional(text({ missing: 'Enter response template.', maxLength: 2000, tooLong: 'Template too long.' })),
  leadMagnetUrl: optional(text({ missing: 'Enter lead magnet URL.', maxLength: 500, tooLong: 'URL too long.' })),
  socialAccountId: optional(identifier({ missing: 'Select social account.', invalid: 'Invalid social account ID.' })),
  isActive: optional(rule<boolean>('Invalid active status.', (v) => typeof v === 'boolean' ? accepted(v) : refused('Must be boolean.'))),
});

export const SOCIAL_MESSAGE_LIST: ListSpec = {
  defaultSort: 'createdAt',
  fields: {
    conversationId: { type: 'text', sortable: false, filterable: true },
    brandId: { type: 'text', sortable: false, filterable: true },
    socialAccountId: { type: 'text', sortable: false, filterable: true },
    direction: { type: 'text', sortable: false, filterable: true },
    status: { type: 'text', sortable: true, filterable: true },
    createdAt: { type: 'date', sortable: true, filterable: true },
  },
};

export const DM_FLOW_LIST: ListSpec = {
  defaultSort: 'name',
  fields: {
    name: { type: 'text', sortable: true, filterable: true, searchable: true },
    brandId: { type: 'text', sortable: false, filterable: true },
    triggerKeyword: { type: 'text', sortable: true, filterable: true, searchable: true },
    isActive: { type: 'boolean', sortable: true, filterable: true },
    createdAt: { type: 'date', sortable: true, filterable: true },
  },
};

export const SocialInboxWebhookBody = passthroughValidator({
  senderId: optional(text({ missing: 'Enter sender ID.', maxLength: 200, tooLong: 'Sender ID too long.' })),
  senderName: optional(text({ missing: 'Enter sender name.', maxLength: 200, tooLong: 'Sender name too long.' })),
  senderAvatar: optional(text({ missing: 'Enter sender avatar.', maxLength: 500, tooLong: 'Sender avatar too long.' })),
  recipientId: optional(text({ missing: 'Enter recipient ID.', maxLength: 200, tooLong: 'Recipient ID too long.' })),
  content: optional(text({ missing: 'Enter content.', maxLength: 5000, tooLong: 'Content too long.' })),
  text: optional(text({ missing: 'Enter text.', maxLength: 5000, tooLong: 'Text too long.' })),
  message: optional(text({ missing: 'Enter message.', maxLength: 5000, tooLong: 'Message too long.' })),
  conversationId: optional(text({ missing: 'Enter conversation ID.', maxLength: 200, tooLong: 'Conversation ID too long.' })),
  brandId: optional(identifier({ missing: 'Select brand.', invalid: 'Invalid brand ID.' })),
});
