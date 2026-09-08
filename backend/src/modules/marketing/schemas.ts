import {
  AI_MAX_DRAFT_CHARS,
  AI_MAX_VARIANTS,
  AUTOLIST_REPEAT_MODES,
  AUTOLIST_STATUSES,
  AUTOLIST_TRAVERSAL_MODES,
  BRAND_MEMBER_ROLES,
  MARKETING_FIELDS,
  MARKETING_STATUSES,
  SCHEDULED_POST_STATUSES,
  SOCIAL_ACCOUNT_STATUSES,
  SOCIAL_PLATFORMS,
  SNIPPET_KINDS,
  MARKETING_CAMPAIGN_STATUSES,
  AD_PLATFORMS,
  SMART_LINK_CARD_STYLES,
  SMART_LINK_COLOR_PATTERN,
  SMART_LINK_FONT_FAMILIES,
  SMART_LINK_URL_SCHEMES,
  isCompetitorHandle,
  MARKETING_ERROR_CODES,
  type AutolistRepeatMode,
  type AutolistSlot,
  type AutolistStatus,
  type AutolistTraversalMode,
  type BrandMemberRole,
  type MarketingStatus,
  type ScheduledPostStatus,
  type SocialAccountStatus,
  type SocialPlatform,
  type SnippetKind,
  type MarketingCampaignStatus,
  type AdPlatform,
  type ShoppableGridItem,
  type SmartLinkButton,
  type SmartLinkCardStyle,
  type SmartLinkFontFamily,
  type SmartLinkSocialItem,
  type SmartLinkTheme,
} from '@erp/shared';
import { HttpStatus } from '@nestjs/common';
import { isIP } from 'node:net';
import { ApiException } from '../../http/api-exception';
import { isPublicAddress } from './outbound-fetch.service';
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
  Validator,
  type Parsed,
  type Schema,
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
  voiceTone: optional(
    text({
      missing: 'Describe the brand voice.',
      maxLength: 400,
      tooLong: 'Use 400 characters or fewer — this is a sentence, not a brand book.',
    }),
  ),
  productDescription: optional(
    text({
      missing: 'Describe what the brand sells.',
      maxLength: 600,
      tooLong: 'Use 600 characters or fewer.',
    }),
  ),
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
  voiceTone: optional(
    text({
      missing: 'Describe the brand voice.',
      maxLength: 400,
      tooLong: 'Use 400 characters or fewer — this is a sentence, not a brand book.',
    }),
  ),
  productDescription: optional(
    text({
      missing: 'Describe what the brand sells.',
      maxLength: 600,
      tooLong: 'Use 600 characters or fewer.',
    }),
  ),
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

// --- The public bio page's closed shapes -------------------------------------------------
//
// Everything a bio page renders is validated here, at the write boundary, and rejected rather
// than sanitised. The renderer may then assume it was given what it asked for -- and still
// escapes, because defence in depth is cheap and one of these fields already got past an
// escaping pass once (`smart-links.service.ts` interpolated the theme straight into `<style>`).
//
// Reject, never coerce: a stripped value leaves the caller believing their page says something
// it does not, and a fallback render is how a bad value becomes acceptable by habit.

type ReadResult<T> = { ok: true; value: T } | { ok: false; message: string };

function readTheme(value: unknown): ReadResult<SmartLinkTheme> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, message: 'Theme must be an object.' };
  }

  const given = value as Record<string, unknown>;
  const colourKeys = ['primaryColor', 'backgroundColor', 'textColor'] as const;
  const known = new Set<string>([...colourKeys, 'cardStyle', 'fontFamily']);

  const unknownKey = Object.keys(given).find((key) => !known.has(key));
  if (unknownKey !== undefined) {
    return {
      ok: false,
      message:
        `'${unknownKey}' is not a theme setting. A bio page renders a closed set — ` +
        `${[...known].join(', ')} — because every one of them lands in a stylesheet.`,
    };
  }

  const theme: Partial<SmartLinkTheme> = {};

  for (const key of colourKeys) {
    const colour = given[key];
    if (colour === undefined || colour === null) continue;
    if (typeof colour !== 'string' || !SMART_LINK_COLOR_PATTERN.test(colour.trim())) {
      return { ok: false, message: `'${key}' must be a hex colour such as '#6366f1'.` };
    }
    theme[key] = colour.trim();
  }

  if (given.cardStyle !== undefined && given.cardStyle !== null) {
    if (
      typeof given.cardStyle !== 'string' ||
      !(SMART_LINK_CARD_STYLES as readonly string[]).includes(given.cardStyle)
    ) {
      return {
        ok: false,
        message: `'cardStyle' must be one of: ${SMART_LINK_CARD_STYLES.join(', ')}.`,
      };
    }
    theme.cardStyle = given.cardStyle as SmartLinkCardStyle;
  }

  if (given.fontFamily !== undefined && given.fontFamily !== null) {
    if (
      typeof given.fontFamily !== 'string' ||
      !(SMART_LINK_FONT_FAMILIES as readonly string[]).includes(given.fontFamily)
    ) {
      return {
        ok: false,
        message:
          `'fontFamily' names one of the built-in font stacks: ` +
          `${SMART_LINK_FONT_FAMILIES.join(', ')}. A free-form font stack is CSS the page ` +
          `would have to trust.`,
      };
    }
    theme.fontFamily = given.fontFamily as SmartLinkFontFamily;
  }

  return { ok: true, value: theme as SmartLinkTheme };
}

function smartLinkTheme() {
  return rule<SmartLinkTheme>('Provide theme settings.', (value) => {
    const read = readTheme(value);
    return read.ok ? accepted(read.value) : refused(read.message);
  });
}

/**
 * A link a public page will actually render.
 *
 * Parsed with `new URL()` rather than pattern-matched, because the question is what a browser
 * will do with the value, and the browser's own parser is the only honest answer. Anything that
 * fails to parse — including a protocol-relative `//host` — is refused.
 */
export function readLinkUrl(value: unknown, field: string): ReadResult<string> {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return { ok: false, message: `'${field}' must be a URL.` };
  }

  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    return {
      ok: false,
      message: `'${field}' is not a URL a browser could follow. Include the scheme, e.g. 'https://…'.`,
    };
  }

  if (!(SMART_LINK_URL_SCHEMES as readonly string[]).includes(parsed.protocol)) {
    return {
      ok: false,
      message:
        `'${field}' uses the '${parsed.protocol}' scheme. A public page links only to ` +
        `${SMART_LINK_URL_SCHEMES.join(', ')} — an escaped 'javascript:' href still runs.`,
    };
  }

  return { ok: true, value: value.trim() };
}

function shortText(value: unknown, field: string, maxLength: number): ReadResult<string> {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return { ok: false, message: `'${field}' must be text.` };
  }
  if (value.trim().length > maxLength) {
    return { ok: false, message: `'${field}' must be ${maxLength} characters or fewer.` };
  }
  return { ok: true, value: value.trim() };
}

function objectEntriesOf(value: unknown): Record<string, unknown>[] | undefined {
  if (!Array.isArray(value)) return undefined;
  if (value.some((item) => typeof item !== 'object' || item === null || Array.isArray(item))) {
    return undefined;
  }
  return value as Record<string, unknown>[];
}

function smartLinkButtons() {
  return rule<SmartLinkButton[]>('Provide button links.', (value) => {
    const items = objectEntriesOf(value);
    if (!items) return refused('Button links must be an array of objects.');

    const buttons: SmartLinkButton[] = [];
    for (const [index, item] of items.entries()) {
      const id = shortText(item.id, `buttonLinks[${index}].id`, 100);
      if (!id.ok) return refused(id.message);
      const title = shortText(item.title, `buttonLinks[${index}].title`, 150);
      if (!title.ok) return refused(title.message);
      const url = readLinkUrl(item.url, `buttonLinks[${index}].url`);
      if (!url.ok) return refused(url.message);

      let icon: string | undefined;
      if (item.icon !== undefined && item.icon !== null) {
        const read = shortText(item.icon, `buttonLinks[${index}].icon`, 16);
        if (!read.ok) return refused(read.message);
        icon = read.value;
      }

      if (item.clicks !== undefined && item.clicks !== null && typeof item.clicks !== 'number') {
        return refused(`'buttonLinks[${index}].clicks' must be a number.`);
      }
      if (item.order !== undefined && item.order !== null && typeof item.order !== 'number') {
        return refused(`'buttonLinks[${index}].order' must be a number.`);
      }

      buttons.push({
        id: id.value,
        title: title.value,
        url: url.value,
        ...(icon !== undefined ? { icon } : {}),
        ...(typeof item.clicks === 'number' ? { clicks: item.clicks } : {}),
        ...(typeof item.order === 'number' ? { order: item.order } : {}),
      });
    }

    return accepted(buttons);
  });
}

function smartLinkGrid() {
  return rule<ShoppableGridItem[]>('Provide shoppable grid items.', (value) => {
    const items = objectEntriesOf(value);
    if (!items) return refused('Shoppable grid must be an array of objects.');

    const grid: ShoppableGridItem[] = [];
    for (const [index, item] of items.entries()) {
      const id = shortText(item.id, `shoppableGrid[${index}].id`, 100);
      if (!id.ok) return refused(id.message);
      const imageUrl = readLinkUrl(item.imageUrl, `shoppableGrid[${index}].imageUrl`);
      if (!imageUrl.ok) return refused(imageUrl.message);
      const productUrl = readLinkUrl(item.productUrl, `shoppableGrid[${index}].productUrl`);
      if (!productUrl.ok) return refused(productUrl.message);

      let title: string | undefined;
      if (item.title !== undefined && item.title !== null) {
        const read = shortText(item.title, `shoppableGrid[${index}].title`, 150);
        if (!read.ok) return refused(read.message);
        title = read.value;
      }

      let price: string | undefined;
      if (item.price !== undefined && item.price !== null) {
        const read = shortText(item.price, `shoppableGrid[${index}].price`, 24);
        if (!read.ok) return refused(read.message);
        price = read.value;
      }

      if (item.clicks !== undefined && item.clicks !== null && typeof item.clicks !== 'number') {
        return refused(`'shoppableGrid[${index}].clicks' must be a number.`);
      }

      grid.push({
        id: id.value,
        imageUrl: imageUrl.value,
        productUrl: productUrl.value,
        ...(title !== undefined ? { title } : {}),
        ...(price !== undefined ? { price } : {}),
        ...(typeof item.clicks === 'number' ? { clicks: item.clicks } : {}),
      });
    }

    return accepted(grid);
  });
}

function smartLinkSocials() {
  return rule<SmartLinkSocialItem[]>('Provide social links.', (value) => {
    const items = objectEntriesOf(value);
    if (!items) return refused('Social links must be an array of objects.');

    const socials: SmartLinkSocialItem[] = [];
    for (const [index, item] of items.entries()) {
      const platform = shortText(item.platform, `socialLinks[${index}].platform`, 40);
      if (!platform.ok) return refused(platform.message);
      const url = readLinkUrl(item.url, `socialLinks[${index}].url`);
      if (!url.ok) return refused(url.message);
      socials.push({ platform: platform.value, url: url.value });
    }

    return accepted(socials);
  });
}

export const CreateSmartLinkBody = validator({
  brandId: identifier({ missing: 'Select a brand.', invalid: 'Invalid brand ID.' }),
  campaignId: optional(identifier({ missing: 'Select campaign.', invalid: 'Invalid campaign ID.' })),
  slug: text(SMART_LINK_SLUG),
  title: text(SMART_LINK_TITLE),
  bio: optional(text({ missing: 'Enter bio text.', maxLength: 500, tooLong: 'Bio is too long.' })),
  avatarUrl: optional(text(URL_FIELD)),
  theme: optional(smartLinkTheme()),
  buttonLinks: optional(smartLinkButtons()),
  shoppableGrid: optional(smartLinkGrid()),
  socialLinks: optional(smartLinkSocials()),
});

export const UpdateSmartLinkBody = validator({
  campaignId: optional(identifier({ missing: 'Select campaign.', invalid: 'Invalid campaign ID.' })),
  slug: optional(text(SMART_LINK_SLUG)),
  title: optional(text(SMART_LINK_TITLE)),
  bio: optional(text({ missing: 'Enter bio text.', maxLength: 500, tooLong: 'Bio is too long.' })),
  avatarUrl: optional(text(URL_FIELD)),
  theme: optional(smartLinkTheme()),
  buttonLinks: optional(smartLinkButtons()),
  shoppableGrid: optional(smartLinkGrid()),
  socialLinks: optional(smartLinkSocials()),
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
  // The honeypot may also travel inside `fields` as '_hp'; either place is checked. Optional
  // and free-form on purpose — refusing a malformed honeypot would tell a bot it found one.
  honeypot: optional(
    rule<string>('Leave this field empty.', (value) =>
      typeof value === 'string' ? accepted(value) : accepted(String(value ?? '')),
    ),
  ),
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

// `AdWebhookBody` used to be declared here and never wired to a controller, which is why the
// endpoint took `Record<string, any>` while a schema for it sat unused two files away. The
// real one lives at the end of this file, beside the platform union it belongs to.

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
  humanAgentTag: optional(rule<boolean>('Invalid humanAgentTag.', (v) => typeof v === 'boolean' ? accepted(v) : refused('Must be boolean.'))),
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

// ─────────────────────────────────────────────────────────────────────────────
// Web Tracking & Visitor Analytics (Ticket 09)
// ─────────────────────────────────────────────────────────────────────────────

export const CreateTrackingSiteBody = validator({
  brandId: identifier({ missing: 'Select brand.', invalid: 'Invalid brand ID.' }),
  name: text({ missing: 'Enter site name.', maxLength: 120, tooLong: 'Name must be 120 characters or fewer.' }),
  domain: text({ missing: 'Enter domain.', maxLength: 255, tooLong: 'Domain must be 255 characters or fewer.' }),
  isActive: optional(rule<boolean>('Invalid active status.', (v) => typeof v === 'boolean' ? accepted(v) : refused('Must be boolean.'))),
});

export const CollectEventBody = passthroughValidator({
  pixelKey: text({ missing: 'Enter pixel key.', maxLength: 128, tooLong: 'Pixel key too long.' }),
  visitorId: text({ missing: 'Enter visitor ID.', maxLength: 128, tooLong: 'Visitor ID too long.' }),
  sessionId: optional(text({ missing: 'Enter session ID.', maxLength: 128, tooLong: 'Session ID too long.' })),
  path: text({ missing: 'Enter path.', maxLength: 2048, tooLong: 'Path too long.' }),
  referrer: optional(text({ missing: 'Enter referrer.', maxLength: 2048, tooLong: 'Referrer too long.' })),
  utmSource: optional(text({ missing: 'Enter UTM source.', maxLength: 120, tooLong: 'UTM source too long.' })),
  utmMedium: optional(text({ missing: 'Enter UTM medium.', maxLength: 120, tooLong: 'UTM medium too long.' })),
  utmCampaign: optional(text({ missing: 'Enter UTM campaign.', maxLength: 120, tooLong: 'UTM campaign too long.' })),
  utmTerm: optional(text({ missing: 'Enter UTM term.', maxLength: 120, tooLong: 'UTM term too long.' })),
  utmContent: optional(text({ missing: 'Enter UTM content.', maxLength: 120, tooLong: 'UTM content too long.' })),
  country: optional(text({ missing: 'Enter country.', maxLength: 10, tooLong: 'Country too long.' })),
  device: optional(text({ missing: 'Enter device.', maxLength: 50, tooLong: 'Device too long.' })),
  browser: optional(text({ missing: 'Enter browser.', maxLength: 50, tooLong: 'Browser too long.' })),
  screen: optional(text({ missing: 'Enter screen.', maxLength: 50, tooLong: 'Screen too long.' })),
});

export const TRACKING_SITE_LIST: ListSpec = {
  defaultSort: 'createdAt',
  fields: {
    name: { type: 'text', sortable: true, filterable: true, searchable: true },
    domain: { type: 'text', sortable: true, filterable: true, searchable: true },
    brandId: { type: 'text', sortable: false, filterable: true },
    isActive: { type: 'boolean', sortable: true, filterable: true },
    createdAt: { type: 'date', sortable: true, filterable: true },
  },
};


// ─── Ad lead webhooks ─────────────────────────────────────────────────────────────

/**
 * The platforms this module will accept a lead webhook from.
 *
 * A closed union, checked against the path parameter. Before ticket 12 the segment was taken
 * as free text and lower-cased, so `POST /api/marketing/webhooks/ads/<anything>` reached the
 * handler and the CRM handoff — on an unauthenticated endpoint.
 */
/**
 * Note what is absent: a tenant identifier. The webhook used to accept one in the body, which
 * let an unauthenticated caller nominate the company its lead landed in. It is read from the
 * query string only now — that is where these integrations are configured anyway — so a body
 * carrying one is a refused key rather than a routing instruction.
 */
export const AD_WEBHOOK_PLATFORMS = [
  'meta',
  'facebook',
  'google',
  'tiktok',
  'linkedin',
  'generic',
] as const;

export type AdWebhookPlatform = (typeof AD_WEBHOOK_PLATFORMS)[number];

export function isAdWebhookPlatform(value: string): value is AdWebhookPlatform {
  return (AD_WEBHOOK_PLATFORMS as readonly string[]).includes(value);
}

/** An array of objects, the shape a platform's own field list arrives in. */
const objectList = (missing: string) =>
  rule<Record<string, unknown>[]>(missing, (value) => {
    if (!Array.isArray(value)) return refused(missing);
    if (value.length > 200) return refused('Too many fields in this payload.');
    if (!value.every((entry) => typeof entry === 'object' && entry !== null && !Array.isArray(entry))) {
      return refused(missing);
    }
    return accepted(value as Record<string, unknown>[]);
  });

const adText = (label: string, maxLength = 500) =>
  optional(text({ missing: `Enter ${label}.`, maxLength, tooLong: `${label} is too long.` }));

/**
 * Every top-level key an ad lead webhook may carry, from any supported platform.
 *
 * Declared rather than passed through, because this is an unauthenticated third-party endpoint
 * and an unshaped body reaching a Prisma string column is how a caller gets to choose our
 * status code. `AD_WEBHOOK_KEYS` below is the same list as a set: the validator drops unknown
 * keys silently, and the handler refuses them, so a platform that starts sending something new
 * is a visible 400 rather than a field that quietly stopped arriving.
 */
/**
 * A validator that refuses what it does not recognise, instead of dropping it.
 *
 * The platform's default is right for our own API — an unknown key is ignored, so adding a
 * field is not a breaking change for a client that echoes bodies back. It is wrong for an
 * unauthenticated third-party webhook: there, a key we have never seen means the platform
 * changed its payload, and a silent drop turns that into data that quietly stopped arriving
 * instead of a refusal somebody investigates.
 *
 * A 400 rather than the platform's 422, and with no detail beyond the offending key names:
 * the caller is Meta's or Google's delivery service, not a form.
 */
class ClosedValidator<S extends Schema> extends Validator<S> {
  constructor(
    private readonly allowed: readonly string[],
    schema: S,
    private readonly code: string = MARKETING_ERROR_CODES.adWebhookUnknownFields,
    private readonly explain: (keys: string[]) => string = (keys) =>
      `This payload carries fields this endpoint does not accept: ${keys.join(', ')}.`,
  ) {
    super(schema);
  }

  override parse(input: unknown): Parsed<S> {
    if (typeof input === 'object' && input !== null && !Array.isArray(input)) {
      const unknown = Object.keys(input).filter((key) => !this.allowed.includes(key));
      if (unknown.length > 0) {
        throw new ApiException(
          this.code,
          this.explain(unknown.slice(0, 10)),
          HttpStatus.BAD_REQUEST,
        );
      }
    }

    return super.parse(input);
  }
}

const AD_WEBHOOK_SCHEMA = {
  brandId: adText('a brand id', 64),
  email: adText('an email address', 320),
  name: adText('a name', 200),
  full_name: adText('a name', 200),
  phone: adText('a phone number', 60),
  phone_number: adText('a phone number', 60),
  company: adText('a company name', 200),
  company_name: adText('a company name', 200),
  campaign_name: adText('a campaign name'),
  ad_name: adText('an ad name'),
  adset_name: adText('an ad set name'),
  ad_id: adText('an ad id', 128),
  utmSource: adText('a UTM source', 120),
  utmMedium: adText('a UTM medium', 120),
  utmCampaign: adText('a UTM campaign', 120),
  utmTerm: adText('a UTM term', 120),
  utmContent: adText('a UTM content value', 120),
  field_data: optional(objectList('Send field_data as a list of fields.')),
  user_column_data: optional(objectList('Send user_column_data as a list of columns.')),
} as const;

const AD_WEBHOOK_KEYS: readonly string[] = [
  'brandId',
  'email',
  'name',
  'full_name',
  'phone',
  'phone_number',
  'company',
  'company_name',
  'campaign_name',
  'ad_name',
  'adset_name',
  'ad_id',
  'utmSource',
  'utmMedium',
  'utmCampaign',
  'utmTerm',
  'utmContent',
  'field_data',
  'user_column_data',
];

export const AdWebhookBody = new ClosedValidator(AD_WEBHOOK_KEYS, AD_WEBHOOK_SCHEMA);

// ─── Composer intelligence (ticket 14, phase 1) ───────────────────────────────────

const SNIPPET_KIND_RULE = oneOf<SnippetKind>(SNIPPET_KINDS, {
  missing: 'Say whether this is a first comment or a call to action.',
  invalid: 'That is not a snippet kind.',
});

export const CreateSnippetBody = validator({
  brandId: identifier({
    missing: 'Choose a brand.',
    invalid: 'That is not a brand identifier.',
  }),
  kind: SNIPPET_KIND_RULE,
  label: text({
    missing: 'Give the snippet a name.',
    maxLength: 100,
    tooLong: 'Use 100 characters or fewer.',
  }),
  body: text({
    missing: 'Write the snippet.',
    maxLength: 2000,
    tooLong: 'Use 2000 characters or fewer.',
  }),
});

export const UpdateSnippetBody = validator({
  label: optional(
    text({
      missing: 'Give the snippet a name.',
      maxLength: 100,
      tooLong: 'Use 100 characters or fewer.',
    }),
  ),
  body: optional(
    text({
      missing: 'Write the snippet.',
      maxLength: 2000,
      tooLong: 'Use 2000 characters or fewer.',
    }),
  ),
}).and((values, report) => {
  const changed = Object.values(values).some((value) => value !== undefined);
  if (!changed) report('label', 'Change something — this request changes nothing.');
});

export const SNIPPET_LIST: ListSpec = {
  defaultSort: 'label',
  fields: {
    label: { type: 'text', sortable: true, filterable: true, searchable: true },
    body: { type: 'text', sortable: false, filterable: false, searchable: true },
    kind: { type: 'text', sortable: true, filterable: true },
    brandId: { type: 'text', sortable: false, filterable: true },
    createdAt: { type: 'date', sortable: true, filterable: true },
  },
};

/**
 * The network a best-time recompute is asked for.
 *
 * A closed union rather than a free string: the value keys a lookup table and a stored row,
 * and an unrecognised platform must be a refusal rather than an empty heatmap.
 */
export const RecomputeBestTimesBody = validator({
  brandId: identifier({
    missing: 'Choose a brand.',
    invalid: 'That is not a brand identifier.',
  }),
  platform: oneOf<SocialPlatform>(SOCIAL_PLATFORMS, {
    missing: 'Choose a network.',
    invalid: 'That is not a network this module publishes to.',
  }),
});


// ─── Composer intelligence (ticket 14, phase 2) — metered generation ──────────────

/**
 * How many variants one call returns.
 *
 * A count, not a knob with a price on it: it is bounded at `AI_MAX_VARIANTS` and every
 * variant comes out of the same single call (14e), so the most it can move is the length of
 * the answer, never the number of calls.
 */
const VARIANT_COUNT = rule<number>('Say how many variants you want.', (value) => {
  const count = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(count) || count < 1 || count > AI_MAX_VARIANTS) {
    return refused(`Ask for between 1 and ${AI_MAX_VARIANTS} variants.`);
  }
  return accepted(count);
});

const AI_COMPOSE_SCHEMA = {
  brandId: identifier({
    missing: 'Choose a brand.',
    invalid: 'That is not a brand identifier.',
  }),
  draft: text({
    missing: 'Write something for the assistant to work from.',
    maxLength: AI_MAX_DRAFT_CHARS,
    tooLong: `Use ${AI_MAX_DRAFT_CHARS} characters or fewer.`,
  }),
  platform: oneOf<SocialPlatform>(SOCIAL_PLATFORMS, {
    missing: 'Choose a network.',
    invalid: 'That is not a network this module publishes to.',
  }),
  variants: optional(VARIANT_COUNT),
};

const AI_COMPOSE_KEYS = ['brandId', 'draft', 'platform', 'variants'];

/**
 * The client chooses nothing that costs money (14q), and cannot ask for bulk (14u).
 *
 * Two refusals rather than one silent trim. A body carrying `model`, `maxTokens`,
 * `temperature`, `apiKey` or a cost figure is **rejected**, because the server picks all of
 * them and a request that was trimmed instead would look to its author like it had been
 * honoured. An *array* of drafts is rejected separately and by name: the interactive route is
 * the expensive one per unit of work, and 14e's batch rule only holds if the cheap path
 * cannot be reached in a loop from a browser.
 */
class AiComposeValidator<S extends Schema> extends ClosedValidator<S> {
  override parse(input: unknown): Parsed<S> {
    if (Array.isArray(input)) {
      throw new ApiException(
        MARKETING_ERROR_CODES.aiBulkRefused,
        'This endpoint composes one draft at a time. A whole autolist or media library goes ' +
          'through the bulk path, which runs as a marketing job on the provider batch ' +
          'endpoint and draws on the same allowance.',
        HttpStatus.BAD_REQUEST,
      );
    }

    return super.parse(input);
  }
}

export const ComposeWithAiBody = new AiComposeValidator(
  AI_COMPOSE_KEYS,
  AI_COMPOSE_SCHEMA,
  MARKETING_ERROR_CODES.aiUnknownField,
  (keys) =>
    `This endpoint does not accept ${keys.join(', ')}. The model, the token budget and the ` +
    `credential are the server's to choose, and the cost is the ledger's to compute.`,
);

/**
 * The tenant's own key, on the way in.
 *
 * Length-checked only: a key's real validity is decided by one probe call at save time (14v),
 * because a regex that thinks it knows a vendor's key format is a regex that rejects the next
 * one they issue.
 */
export const SetAiKeyBody = validator({
  apiKey: rule<string>('Paste the API key.', (value) => {
    const trimmed = typeof value === 'string' ? value.trim() : '';
    if (trimmed.length < 20 || trimmed.length > 300) {
      return refused('That does not look like an API key.');
    }
    return accepted(trimmed);
  }),
});

// ─── External content sources (ticket 15) ────────────────────────────────────────

/**
 * A feed URL, on the way in (16a).
 *
 * `readLinkUrl` first, for the shape and the scheme allowlist a rendered link gets — then
 * narrowed to `https:`, because fetching is a different trust decision from rendering and
 * `http:` is not one this server makes. This is the check that gives the operator an
 * immediate error; it is *not* the check that holds. `OutboundFetchService` re-resolves the
 * host on every single poll (14-17.0), because the DNS answer is what changes between them.
 */
const FEED_URL = rule<string>('Enter the feed address.', (value) => {
  const read = readLinkUrl(value, 'url');
  if (!read.ok) return refused(read.message);
  if (read.value.length > 500) return refused('URL must be 500 characters or fewer.');

  const parsed = new URL(read.value);
  if (parsed.protocol !== 'https:') {
    return refused(
      "A feed address must start with 'https://'. This server fetches it on a schedule, and " +
        'an unencrypted fetch is a different decision from an unencrypted link on a page.',
    );
  }
  if (parsed.port !== '' && parsed.port !== '443') {
    return refused('A feed address must use the standard https port.');
  }

  // A URL that *is* an address can be judged here and now, so it is: an operator who pastes
  // `https://169.254.169.254/…` gets an immediate error rather than a feed row that fails
  // silently on its first poll. A *hostname* still cannot be judged at save time — that is
  // `OutboundFetchService`'s job on every poll, because the DNS answer is what changes.
  const literal = parsed.hostname.replace(/^\[|\]$/g, '');
  if (isIP(literal) !== 0 && !isPublicAddress(literal)) {
    return refused(
      'That address is on a private or loopback range. This server fetches feeds on a ' +
        'schedule, and it only calls hosts on the public internet.',
    );
  }

  return accepted(read.value);
});

export const CreateContentFeedBody = validator({
  brandId: identifier({
    missing: 'Choose a brand.',
    invalid: 'That is not a brand identifier.',
  }),
  name: text({
    missing: 'Name the feed.',
    maxLength: 120,
    tooLong: 'Use 120 characters or fewer.',
  }),
  url: FEED_URL,
});

export const CONTENT_FEED_LIST: ListSpec = {
  defaultSort: 'name',
  fields: {
    name: { type: 'text', sortable: true, filterable: true, searchable: true },
    url: { type: 'text', sortable: false, filterable: false, searchable: true },
    status: { type: 'text', sortable: true, filterable: true },
    brandId: { type: 'text', sortable: false, filterable: true },
    createdAt: { type: 'date', sortable: true, filterable: true },
  },
};

export const CONTENT_FEED_ENTRY_LIST: ListSpec = {
  defaultSort: '-fetchedAt',
  fields: {
    title: { type: 'text', sortable: true, filterable: false, searchable: true },
    excerpt: { type: 'text', sortable: false, filterable: false, searchable: true },
    brandId: { type: 'text', sortable: false, filterable: true },
    feedId: { type: 'text', sortable: false, filterable: true },
    status: { type: 'text', sortable: false, filterable: true },
    fetchedAt: { type: 'date', sortable: true, filterable: true },
    publishedAt: { type: 'date', sortable: true, filterable: true },
  },
};

/**
 * A competitor handle (15d).
 *
 * An identifier, not a URL, and **rejected** rather than sanitized when it is not one: a
 * "handle" field that quietly accepts `https://…` is how the scraper path 15a closed reopens
 * as a convenience. A leading `@` is the one thing trimmed, because that is how every network
 * writes a handle on screen and nobody means it as part of the identifier.
 */
const COMPETITOR_HANDLE = rule<string>('Enter the competitor handle.', (value) => {
  const raw = typeof value === 'string' ? value.trim().replace(/^@/, '') : '';
  if (!isCompetitorHandle(raw)) {
    return refused(
      'A handle is the name on the profile — letters, digits, dots, dashes and underscores. ' +
        'Not a link: this reads the network’s own API, it does not visit pages.',
    );
  }
  return accepted(raw);
});

export const CreateCompetitorBody = validator({
  brandId: identifier({
    missing: 'Choose a brand.',
    invalid: 'That is not a brand identifier.',
  }),
  network: oneOf<SocialPlatform>(SOCIAL_PLATFORMS, {
    missing: 'Choose a network.',
    invalid: 'That is not a network this module reads.',
  }),
  handle: COMPETITOR_HANDLE,
  label: optional(
    text({
      missing: 'Name the competitor.',
      maxLength: 120,
      tooLong: 'Use 120 characters or fewer.',
    }),
  ),
});

export const COMPETITOR_LIST: ListSpec = {
  defaultSort: 'label',
  fields: {
    label: { type: 'text', sortable: true, filterable: true, searchable: true },
    handle: { type: 'text', sortable: true, filterable: true, searchable: true },
    network: { type: 'text', sortable: true, filterable: true },
    brandId: { type: 'text', sortable: false, filterable: true },
    createdAt: { type: 'date', sortable: true, filterable: true },
  },
};

export const COMPETITOR_SNAPSHOT_LIST: ListSpec = {
  defaultSort: '-captureDate',
  fields: {
    captureDate: { type: 'date', sortable: true, filterable: true },
    network: { type: 'text', sortable: false, filterable: true },
    brandId: { type: 'text', sortable: false, filterable: true },
    competitorId: { type: 'text', sortable: false, filterable: true },
  },
};
