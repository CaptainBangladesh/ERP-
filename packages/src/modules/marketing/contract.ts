import type { ListResponse } from '../../http/list.js';

/**
 * Marketing' wire contract — its paths, bodies, responses and refusals.
 *
 * Wire shapes only, as with every contract here. What a marketing *is* lives in
 * 'backend/src/modules/marketing', and what other modules may ask of it is that module's
 * public surface. Nothing outside the module reads its tables.
 *
 * Both workspaces bind to this file, so an API change breaks the build rather than the user's
 * screen.
 */

export const MARKETING_MODULE = 'marketing';

/** No leading slash — Nest composes controller prefixes. */
export const MARKETING_ROUTE = 'api/marketing';

/**
 * The scaffold CRUD's own segment.
 *
 * It used to sit directly on `MARKETING_ROUTE` with a bare `:id`, which — because Nest matches
 * in registration order — swallowed every single-segment sibling the module added afterwards
 * (`/brands`, `/posts`, `/campaigns`, ...). A dynamic segment at a module root is a trap armed
 * for the next route somebody adds, so it lives under a literal noun instead. The conformance
 * rule `no-bare-id-at-module-root` keeps it that way.
 */
export const MARKETING_RECORDS_ROUTE = `${MARKETING_ROUTE}/records`;

export const MARKETING_PATHS = {
  marketings: `/${MARKETING_RECORDS_ROUTE}`,
  marketing: (id: string) => `/${MARKETING_RECORDS_ROUTE}/${id}`,
  // Brands
  brands: `/${MARKETING_ROUTE}/brands`,
  brand: (id: string) => `/${MARKETING_ROUTE}/brands/${id}`,
  brandMembers: (id: string) => `/${MARKETING_ROUTE}/brands/${id}/members`,
  brandMember: (brandId: string, userId: string) => `/${MARKETING_ROUTE}/brands/${brandId}/members/${userId}`,
  // Social Accounts
  brandSocialAccounts: (brandId: string) => `/${MARKETING_ROUTE}/brands/${brandId}/accounts`,
  connectAccount: (brandId: string) => `/${MARKETING_ROUTE}/brands/${brandId}/accounts/connect`,
  authorizeOAuth: (brandId: string) => `/${MARKETING_ROUTE}/brands/${brandId}/accounts/oauth/authorize`,
  oauthCallback: `/${MARKETING_ROUTE}/social-accounts/oauth/callback`,
  socialAccount: (id: string) => `/${MARKETING_ROUTE}/social-accounts/${id}`,
  refreshAccount: (id: string) => `/${MARKETING_ROUTE}/social-accounts/${id}/refresh`,
  expiringAccounts: (brandId: string) => `/${MARKETING_ROUTE}/brands/${brandId}/expiring-tokens`,
  // Jobs & Background Queue
  jobs: `/${MARKETING_ROUTE}/jobs`,
  job: (id: string) => `/${MARKETING_ROUTE}/jobs/${id}`,
  cancelJob: (id: string) => `/${MARKETING_ROUTE}/jobs/${id}/cancel`,
  retryJob: (id: string) => `/${MARKETING_ROUTE}/jobs/${id}/retry`,
  // Scheduled Posts & Publishing
  posts: `/${MARKETING_ROUTE}/posts`,
  post: (id: string) => `/${MARKETING_ROUTE}/posts/${id}`,
  publishPostNow: (id: string) => `/${MARKETING_ROUTE}/posts/${id}/publish-now`,
  syncPostMetrics: (id: string) => `/${MARKETING_ROUTE}/posts/${id}/metrics`,
  // Evergreen Autolists
  autolists: `/${MARKETING_ROUTE}/autolists`,
  autolist: (id: string) => `/${MARKETING_ROUTE}/autolists/${id}`,
  cycleAutolist: (id: string) => `/${MARKETING_ROUTE}/autolists/${id}/cycle`,
  autolistItems: (autolistId: string) => `/${MARKETING_ROUTE}/autolists/${autolistId}/items`,
  autolistItem: (autolistId: string, itemId: string) => `/${MARKETING_ROUTE}/autolists/${autolistId}/items/${itemId}`,
  // Campaigns
  campaigns: `/${MARKETING_ROUTE}/campaigns`,
  campaign: (id: string) => `/${MARKETING_ROUTE}/campaigns/${id}`,
  buildUtm: `/${MARKETING_ROUTE}/campaigns/utm/build`,
  // SmartLinks (Link-in-Bio)
  smartLinks: `/${MARKETING_ROUTE}/smart-links`,
  smartLink: (id: string) => `/${MARKETING_ROUTE}/smart-links/${id}`,
  publicSmartLink: (slug: string) => `/b/${slug}`,
  publicSmartLinkClick: (slug: string) => `/b/${slug}/clicks`,
  // Ad Account Sync
  adSyncs: `/${MARKETING_ROUTE}/ad-syncs`,
  adSync: (id: string) => `/${MARKETING_ROUTE}/ad-syncs/${id}`,
  triggerAdSync: (id: string) => `/${MARKETING_ROUTE}/ad-syncs/${id}/sync`,
  // Inbound Lead Gen & CRM Handoff (Forms, Submissions, Nurture)
  forms: `/${MARKETING_ROUTE}/forms`,
  form: (id: string) => `/${MARKETING_ROUTE}/forms/${id}`,
  formSubmissions: (formId: string) => `/${MARKETING_ROUTE}/forms/${formId}/submissions`,
  publicFormSubmit: (formId: string) => `/${MARKETING_ROUTE}/forms/${formId}/submit`,
  nurtureSequences: `/${MARKETING_ROUTE}/nurture-sequences`,
  nurtureSequence: (id: string) => `/${MARKETING_ROUTE}/nurture-sequences/${id}`,
  adWebhooks: (platform: string) => `/${MARKETING_ROUTE}/webhooks/ads/${platform}`,
  // Unified Social Inbox & DM Automation
  inboxMessages: `/${MARKETING_ROUTE}/inbox/messages`,
  inboxConversations: `/${MARKETING_ROUTE}/inbox/conversations`,
  inboxReply: `/${MARKETING_ROUTE}/inbox/reply`,
  inboxMessageStatus: (id: string) => `/${MARKETING_ROUTE}/inbox/messages/${id}/status`,
  inboxConversationStatus: (conversationId: string) => `/${MARKETING_ROUTE}/inbox/conversations/${conversationId}/status`,
  inboxConvertToLead: `/${MARKETING_ROUTE}/inbox/convert-to-lead`,
  dmFlows: `/${MARKETING_ROUTE}/dm-flows`,
  dmFlow: (id: string) => `/${MARKETING_ROUTE}/dm-flows/${id}`,
  socialInboxWebhooks: (platform: string) => `/${MARKETING_ROUTE}/webhooks/social-inbox/${platform}`,
  // Web Tracking & Visitor Analytics
  trackingSites: `/${MARKETING_ROUTE}/tracking-sites`,
  trackingSite: (id: string) => `/${MARKETING_ROUTE}/tracking-sites/${id}`,
  trackingSiteAnalytics: (id: string) => `/${MARKETING_ROUTE}/tracking-sites/${id}/analytics`,
  analyticsOverview: `/${MARKETING_ROUTE}/analytics/overview`,
  pixelJs: `/${MARKETING_ROUTE}/pixel.js`,
  collect: `/${MARKETING_ROUTE}/collect`,
  // Composer intelligence (ticket 14, phase 1)
  bestTimes: `/${MARKETING_ROUTE}/insights/best-times`,
  recomputeBestTimes: `/${MARKETING_ROUTE}/insights/best-times/recompute`,
  snippets: `/${MARKETING_ROUTE}/snippets`,
  snippet: (id: string) => `/${MARKETING_ROUTE}/snippets/${id}`,
} as const;

/**
 * Active, or kept for the sake of history.
 *
 * 'inactive' is what deactivation produces — something nobody uses any more, whose past still
 * has to make sense. Nothing here is ever deleted.
 */
export const MARKETING_STATUSES = ['active', 'inactive'] as const;

export type MarketingStatus = (typeof MARKETING_STATUSES)[number];

/**
 * Third-party social platforms supported for brand channels and OAuth credential vaults.
 */
export const SOCIAL_PLATFORMS = [
  'instagram',
  'facebook',
  'tiktok',
  'linkedin',
  'x',
  'youtube',
  'pinterest',
  'threads',
  'bluesky',
  'google_business',
] as const;

export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];

export const SOCIAL_ACCOUNT_STATUSES = [
  'active',
  'expiring',
  'expired',
  'disconnected',
  'error',
] as const;

export type SocialAccountStatus = (typeof SOCIAL_ACCOUNT_STATUSES)[number];

export const BRAND_MEMBER_ROLES = ['lead', 'editor', 'viewer'] as const;

export type BrandMemberRole = (typeof BRAND_MEMBER_ROLES)[number];

/**
 * The fields a caller may sort, filter or search the list by.
 */
export const MARKETING_FIELDS = {
  name: 'name',
  status: 'status',
  createdAt: 'createdAt',
  // Brand fields
  brandName: 'name',
  brandSlug: 'slug',
  brandTimezone: 'timezone',
} as const;

export interface CreateMarketingRequest {
  name: string;
}

export interface UpdateMarketingRequest {
  name?: string;
  status?: MarketingStatus;
}

export interface MarketingSummary {
  id: string;
  name: string;
  status: MarketingStatus;
}

export type MarketingResponse = MarketingSummary;

export type MarketingListResponse = ListResponse<MarketingSummary>;

// ─── Brands ────────────────────────────────────────────────────────────────────────

export interface BrandColors {
  primary: string;
  secondary?: string;
  accent?: string;
}

export interface CreateBrandRequest {
  name: string;
  slug?: string;
  logoUrl?: string;
  brandColors?: BrandColors;
  timezone?: string;
  customDomain?: string;
  storageQuotaMb?: number;
  settings?: Record<string, unknown>;
}

export interface UpdateBrandRequest {
  name?: string;
  slug?: string;
  logoUrl?: string;
  brandColors?: BrandColors;
  timezone?: string;
  customDomain?: string;
  storageQuotaMb?: number;
  settings?: Record<string, unknown>;
}

export interface BrandSummary {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  brandColors: BrandColors | null;
  timezone: string;
  customDomain: string | null;
  storageQuotaMb: number;
  socialAccountsCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface BrandMemberSummary {
  id: string;
  brandId: string;
  userId: string;
  role: BrandMemberRole;
  createdAt: string;
}

export interface BrandDetailResponse extends BrandSummary {
  settings: Record<string, unknown> | null;
  members: BrandMemberSummary[];
  socialAccounts: SocialAccountSummary[];
}

export type BrandListResponse = ListResponse<BrandSummary>;

export interface AddBrandMemberRequest {
  userId: string;
  role?: BrandMemberRole;
}

// ─── Social Accounts & OAuth Vault ──────────────────────────────────────────────────

export interface ConnectSocialAccountRequest {
  platform: SocialPlatform;
  accountName: string;
  platformAccountId: string;
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
  metadata?: Record<string, unknown>;
}

export interface OAuthAuthorizeRequest {
  platform: SocialPlatform;
  redirectUri: string;
}

export interface OAuthAuthorizeResponse {
  authorizationUrl: string;
  state: string;
}

export interface OAuthCallbackRequest {
  code: string;
  state: string;
  redirectUri: string;
}

export interface SocialAccountSummary {
  id: string;
  brandId: string;
  platform: SocialPlatform;
  accountName: string;
  platformAccountId: string;
  maskedAccessToken: string;
  hasRefreshToken: boolean;
  tokenExpiresAt: string | null;
  isTokenExpired: boolean;
  daysUntilExpiration: number | null;
  status: SocialAccountStatus;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export type SocialAccountResponse = SocialAccountSummary;

export type SocialAccountListResponse = ListResponse<SocialAccountSummary>;

export interface RefreshTokenResponse {
  refreshed: boolean;
  account: SocialAccountSummary;
}

export interface ExpiringAccountsResponse {
  thresholdDays: number;
  accounts: SocialAccountSummary[];
}

// ─── Background Job Queue ────────────────────────────────────────────────────────

export const MARKETING_JOB_TYPES = [
  'publish_social_post',
  'cycle_autolist',
  'sync_ad_metrics',
  'sync_social_inbox',
  'send_drip_email',
  'sync_social_account_tokens',
] as const;

export type MarketingJobType = (typeof MARKETING_JOB_TYPES)[number];

export const MARKETING_JOB_STATUSES = [
  'PENDING',
  'PROCESSING',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
] as const;

export type MarketingJobStatus = (typeof MARKETING_JOB_STATUSES)[number];

export interface ScheduleJobRequest {
  type: MarketingJobType | string;
  payload: Record<string, unknown>;
  scheduledAt?: string;
  maxAttempts?: number;
}

export interface MarketingJobSummary {
  id: string;
  companyId: string;
  type: string;
  payload: Record<string, unknown>;
  scheduledAt: string;
  status: MarketingJobStatus;
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  lockedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type MarketingJobResponse = MarketingJobSummary;

export type MarketingJobListResponse = ListResponse<MarketingJobSummary>;

export interface CancelJobResponse {
  cancelled: boolean;
  job: MarketingJobSummary;
}

export interface RetryJobResponse {
  retried: boolean;
  job: MarketingJobSummary;
}

// ─── Scheduled Posts & Social Publishing ──────────────────────────────────────────

export const SCHEDULED_POST_STATUSES = [
  'DRAFT',
  'SCHEDULED',
  'PUBLISHING',
  'PUBLISHED',
  'FAILED',
  'CANCELLED',
] as const;

export type ScheduledPostStatus = (typeof SCHEDULED_POST_STATUSES)[number];

export const POST_FIELDS = {
  content: 'content',
  scheduledAt: 'scheduledAt',
  status: 'status',
  createdAt: 'createdAt',
  brandId: 'brandId',
  socialAccountId: 'socialAccountId',
} as const;

export interface CreateScheduledPostRequest {
  brandId: string;
  socialAccountId: string;
  content: string;
  mediaUrls?: string[];
  platformConfig?: Record<string, unknown>;
  scheduledAt: string;
  campaignId?: string;
  autolistItemId?: string;
  status?: ScheduledPostStatus;
}

export interface UpdateScheduledPostRequest {
  content?: string;
  mediaUrls?: string[];
  platformConfig?: Record<string, unknown>;
  scheduledAt?: string;
  status?: ScheduledPostStatus;
  socialAccountId?: string;
}

export interface ScheduledPostSummary {
  id: string;
  brandId: string;
  socialAccountId: string;
  socialAccount?: {
    id: string;
    platform: SocialPlatform;
    accountName: string;
  };
  campaignId: string | null;
  autolistItemId: string | null;
  content: string;
  mediaUrls: string[];
  platformConfig: Record<string, unknown> | null;
  scheduledAt: string;
  publishedAt: string | null;
  status: ScheduledPostStatus;
  failureReason: string | null;
  externalPostId: string | null;
  metrics: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export type ScheduledPostResponse = ScheduledPostSummary;

export type ScheduledPostListResponse = ListResponse<ScheduledPostSummary>;

export interface PublishPostResponse {
  published: boolean;
  post: ScheduledPostSummary;
  externalPostId?: string;
}

export interface SyncMetricsResponse {
  synced: boolean;
  post: ScheduledPostSummary;
  metrics: Record<string, unknown>;
}

// ─── Evergreen Autolists ──────────────────────────────────────────────────────────

export const AUTOLIST_REPEAT_MODES = ['RECYCLE', 'ONCE'] as const;
export type AutolistRepeatMode = (typeof AUTOLIST_REPEAT_MODES)[number];

export const AUTOLIST_TRAVERSAL_MODES = ['FIFO', 'SHUFFLE'] as const;
export type AutolistTraversalMode = (typeof AUTOLIST_TRAVERSAL_MODES)[number];

export const AUTOLIST_STATUSES = ['ACTIVE', 'PAUSED'] as const;
export type AutolistStatus = (typeof AUTOLIST_STATUSES)[number];

export const AUTOLIST_FIELDS = {
  name: 'name',
  status: 'status',
  createdAt: 'createdAt',
  brandId: 'brandId',
} as const;

export interface AutolistSlot {
  dayOfWeek: number; // 0 (Sun) - 6 (Sat)
  time: string; // "HH:mm" (24-hour)
  socialAccountIds?: string[];
}

export interface CreateAutolistRequest {
  brandId: string;
  name: string;
  description?: string;
  repeatMode?: AutolistRepeatMode;
  traversalMode?: AutolistTraversalMode;
  activeSlots: AutolistSlot[];
  collisionWindowMinutes?: number;
}

export interface UpdateAutolistRequest {
  name?: string;
  description?: string;
  repeatMode?: AutolistRepeatMode;
  traversalMode?: AutolistTraversalMode;
  activeSlots?: AutolistSlot[];
  status?: AutolistStatus;
  collisionWindowMinutes?: number;
}

export interface AutolistSummary {
  id: string;
  brandId: string;
  name: string;
  description: string | null;
  repeatMode: AutolistRepeatMode;
  traversalMode: AutolistTraversalMode;
  activeSlots: AutolistSlot[];
  status: AutolistStatus;
  collisionWindowMinutes: number;
  itemCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface AutolistItemSummary {
  id: string;
  autolistId: string;
  content: string;
  mediaUrls: string[];
  platformConfig: Record<string, unknown> | null;
  orderIndex: number;
  publishCount: number;
  lastPublishedAt: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface AutolistDetailResponse extends AutolistSummary {
  items: AutolistItemSummary[];
}

export type AutolistResponse = AutolistSummary;

export type AutolistListResponse = ListResponse<AutolistSummary>;

export interface CreateAutolistItemRequest {
  content: string;
  mediaUrls?: string[];
  platformConfig?: Record<string, unknown>;
  orderIndex?: number;
}

export interface UpdateAutolistItemRequest {
  content?: string;
  mediaUrls?: string[];
  platformConfig?: Record<string, unknown>;
  orderIndex?: number;
  status?: string;
}

export type AutolistItemResponse = AutolistItemSummary;

export interface CycleAutolistResponse {
  cycled: boolean;
  scheduledPostId?: string;
  autolistItemId?: string;
  scheduledAt?: string;
  message?: string;
}

export const MARKETING_ERROR_CODES = {
  marketingNotFound: 'marketing_not_found',
  brandNotFound: 'brand_not_found',
  brandSlugTaken: 'brand_slug_taken',
  socialAccountNotFound: 'social_account_not_found',
  socialAccountAlreadyConnected: 'social_account_already_connected',
  oauthFailed: 'oauth_failed',
  oauthInvalidState: 'oauth_invalid_state',
  oauthProviderUnavailable: 'oauth_provider_unavailable',
  tokenRefreshFailed: 'token_refresh_failed',
  vaultDecryptionFailed: 'vault_decryption_failed',
  /**
   * Distinct from `vaultDecryptionFailed` on purpose. "We no longer hold the key this row was
   * written under" is a configuration mistake somebody fixes by restoring a retired key;
   * "the authentication tag does not verify" is a modified row. Conflating them makes an
   * ordinary rotation incident look like an attack.
   */
  vaultKeyUnknown: 'vault_key_unknown',
  adWebhookPlatformUnknown: 'ad_webhook_platform_unknown',
  adWebhookUnknownFields: 'ad_webhook_unknown_fields',
  memberNotFound: 'member_not_found',
  memberAlreadyExists: 'member_already_exists',
  jobNotFound: 'job_not_found',
  jobNotCancellable: 'job_not_cancellable',
  jobNotRetriable: 'job_not_retriable',
  postNotFound: 'post_not_found',
  postNotPublishable: 'post_not_publishable',
  postPublishFailed: 'post_publish_failed',
  autolistNotFound: 'autolist_not_found',
  autolistItemNotFound: 'autolist_item_not_found',
  autolistEmpty: 'autolist_empty',
  postCollisionDetected: 'post_collision_detected',
  campaignNotFound: 'campaign_not_found',
  smartLinkNotFound: 'smart_link_not_found',
  smartLinkSlugTaken: 'smart_link_slug_taken',
  adSyncNotFound: 'ad_sync_not_found',
  invalidUtmUrl: 'invalid_utm_url',
  trackingSiteNotFound: 'tracking_site_not_found',
  rateLimitExceeded: 'rate_limit_exceeded',
  tooManyRequests: 'too_many_requests',
  formSubmissionInvalid: 'invalid_form_submission',
  formDailyCapReached: 'form_daily_cap_reached',
  messagingWindowExpired: 'messaging_window_expired',
  snippetNotFound: 'snippet_not_found',
} as const;

// ─── Campaigns & UTM Tracking ──────────────────────────────────────────────────────

export const MARKETING_CAMPAIGN_STATUSES = ['ACTIVE', 'PAUSED', 'COMPLETED', 'DRAFT'] as const;
export type MarketingCampaignStatus = (typeof MARKETING_CAMPAIGN_STATUSES)[number];

export interface UtmParameters {
  url: string;
  source: string;
  medium: string;
  campaign: string;
  term?: string;
  content?: string;
}

export interface BuildUtmRequest {
  url: string;
  source: string;
  medium: string;
  campaign: string;
  term?: string;
  content?: string;
  campaignId?: string;
}

export interface BuildUtmResponse {
  utmUrl: string;
  parameters: UtmParameters;
  channelPresets?: Array<{
    channel: string;
    url: string;
  }>;
}

export interface CreateMarketingCampaignRequest {
  brandId: string;
  name: string;
  description?: string;
  budget?: number;
  startDate?: string;
  endDate?: string;
  status?: MarketingCampaignStatus;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmTerm?: string;
  utmContent?: string;
  metadata?: Record<string, unknown>;
}

export interface UpdateMarketingCampaignRequest {
  name?: string;
  description?: string;
  budget?: number;
  spent?: number;
  startDate?: string;
  endDate?: string;
  status?: MarketingCampaignStatus;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmTerm?: string;
  utmContent?: string;
  metadata?: Record<string, unknown>;
}

export interface MarketingCampaignSummary {
  id: string;
  brandId: string;
  name: string;
  description: string | null;
  budget: number;
  spent: number;
  startDate: string | null;
  endDate: string | null;
  status: MarketingCampaignStatus;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmTerm: string | null;
  utmContent: string | null;
  postsCount: number;
  smartLinksCount: number;
  adSpend: number;
  adImpressions: number;
  adClicks: number;
  roas: number;
  createdAt: string;
  updatedAt: string;
}

export interface MarketingCampaignDetailResponse extends MarketingCampaignSummary {
  metadata: Record<string, unknown> | null;
  smartLinks: SmartLinkSummary[];
  adSyncs: AdAccountSyncSummary[];
}

export type MarketingCampaignResponse = MarketingCampaignSummary;
export type MarketingCampaignListResponse = ListResponse<MarketingCampaignSummary>;

// ─── SmartLinks (Link-in-Bio) ────────────────────────────────────────────────────────

/**
 * A bio page is public HTML the server assembles, so everything on it is closed rather than
 * free-form.
 *
 * The theme used to be an untyped JSON object interpolated straight into a `<style>` block,
 * which made a `primaryColor` of `red}</style><script>…` stored XSS on the same origin as the
 * ERP app. Colours are hex and nothing else; the font is an *identifier* the renderer maps to
 * a hard-coded stack, never a font-stack string the caller writes; the card style is its own
 * union. A value that cannot contain a delimiter cannot escape the context it lands in, which
 * is a stronger guarantee than escaping inside CSS — and escaping was already forgotten once.
 */
export const SMART_LINK_CARD_STYLES = ['flat', 'rounded', 'glassmorphism', 'shadow'] as const;

export type SmartLinkCardStyle = (typeof SMART_LINK_CARD_STYLES)[number];

/** Font *identifiers*. The stack each one means lives in the renderer, not in the database. */
export const SMART_LINK_FONT_FAMILIES = [
  'system',
  'serif',
  'mono',
  'rounded',
  'condensed',
] as const;

export type SmartLinkFontFamily = (typeof SMART_LINK_FONT_FAMILIES)[number];

/** A colour a bio page will accept: `#rgb`, `#rrggbb`, `#rrggbbaa`. */
export const SMART_LINK_COLOR_PATTERN = /^#[0-9a-f]{3,8}$/i;

/**
 * The URL schemes a public page may link to.
 *
 * `javascript:` is the one that matters: escaping an href makes it *look* inert and leaves it
 * fully executable, which is the case OWASP calls out by name. `data:` and protocol-relative
 * `//host` are refused for the same reason — the scheme is decided at write time, not guessed
 * at render time.
 */
export const SMART_LINK_URL_SCHEMES = ['https:', 'http:', 'mailto:', 'tel:'] as const;

export interface SmartLinkTheme {
  primaryColor: string;
  backgroundColor: string;
  textColor: string;
  cardStyle?: SmartLinkCardStyle;
  fontFamily?: SmartLinkFontFamily;
}

export interface SmartLinkButton {
  id: string;
  title: string;
  url: string;
  icon?: string;
  clicks?: number;
  order?: number;
}

export interface ShoppableGridItem {
  id: string;
  imageUrl: string;
  productUrl: string;
  title?: string;
  price?: string;
  clicks?: number;
}

export interface SmartLinkSocialItem {
  platform: string;
  url: string;
}

export interface CreateSmartLinkRequest {
  brandId: string;
  campaignId?: string;
  slug: string;
  title: string;
  bio?: string;
  avatarUrl?: string;
  theme?: SmartLinkTheme;
  buttonLinks?: SmartLinkButton[];
  shoppableGrid?: ShoppableGridItem[];
  socialLinks?: SmartLinkSocialItem[];
}

export interface UpdateSmartLinkRequest {
  campaignId?: string;
  slug?: string;
  title?: string;
  bio?: string;
  avatarUrl?: string;
  theme?: SmartLinkTheme;
  buttonLinks?: SmartLinkButton[];
  shoppableGrid?: ShoppableGridItem[];
  socialLinks?: SmartLinkSocialItem[];
  isActive?: boolean;
}

export interface SmartLinkSummary {
  id: string;
  brandId: string;
  campaignId: string | null;
  slug: string;
  title: string;
  bio: string | null;
  avatarUrl: string | null;
  viewCount: number;
  clickCount: number;
  ctr: number;
  isActive: boolean;
  buttonLinksCount: number;
  shoppableGridCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface SmartLinkDetailResponse extends SmartLinkSummary {
  theme: SmartLinkTheme | null;
  buttonLinks: SmartLinkButton[];
  shoppableGrid: ShoppableGridItem[];
  socialLinks: SmartLinkSocialItem[];
  analytics: {
    totalViews: number;
    totalClicks: number;
    ctr: number;
    clicksByButton: Record<string, number>;
    recentClicks: Array<{
      timestamp: string;
      buttonId?: string;
      targetUrl?: string;
      referer?: string;
    }>;
  };
}

export type SmartLinkResponse = SmartLinkSummary;
export type SmartLinkListResponse = ListResponse<SmartLinkSummary>;

export interface RecordSmartLinkClickRequest {
  buttonId?: string;
  targetUrl?: string;
  itemId?: string;
}

export interface PublicSmartLinkResponse {
  slug: string;
  title: string;
  bio: string | null;
  avatarUrl: string | null;
  theme: SmartLinkTheme | null;
  buttonLinks: SmartLinkButton[];
  shoppableGrid: ShoppableGridItem[];
  socialLinks: SmartLinkSocialItem[];
}

// ─── Cross-Network Paid Ad Performance Sync ──────────────────────────────────────────

export const AD_PLATFORMS = ['meta', 'google', 'tiktok'] as const;
export type AdPlatform = (typeof AD_PLATFORMS)[number];

export interface CreateAdAccountSyncRequest {
  brandId: string;
  campaignId?: string;
  platform: AdPlatform;
  adAccountId?: string;
  adAccountName?: string;
  spend?: number;
  impressions?: number;
  clicks?: number;
  cpc?: number;
  roas?: number;
  currency?: string;
}

export interface UpdateAdAccountSyncRequest {
  campaignId?: string;
  adAccountId?: string;
  adAccountName?: string;
  spend?: number;
  impressions?: number;
  clicks?: number;
  cpc?: number;
  roas?: number;
  currency?: string;
}

export interface AdAccountSyncSummary {
  id: string;
  brandId: string;
  campaignId: string | null;
  platform: AdPlatform;
  adAccountId: string | null;
  adAccountName: string | null;
  spend: number;
  impressions: number;
  clicks: number;
  cpc: number;
  roas: number;
  currency: string;
  syncedAt: string;
  createdAt: string;
  updatedAt: string;
}

export type AdAccountSyncResponse = AdAccountSyncSummary;
export type AdAccountSyncListResponse = ListResponse<AdAccountSyncSummary>;

export interface SyncAdAccountResponse {
  synced: boolean;
  adSync: AdAccountSyncSummary;
}

// ─── Inbound Lead Gen & CRM Handoff (Ticket 07) ──────────────────────────────────

export interface LeadCaptureFormField {
  name: string;
  label: string;
  type: 'text' | 'email' | 'phone' | 'textarea' | 'select' | 'number';
  required?: boolean;
  placeholder?: string;
  options?: string[];
}

export interface CreateLeadCaptureFormRequest {
  brandId: string;
  name: string;
  description?: string;
  schemaFields?: LeadCaptureFormField[];
}

export interface UpdateLeadCaptureFormRequest {
  name?: string;
  description?: string;
  schemaFields?: LeadCaptureFormField[];
  isActive?: boolean;
}

export interface LeadCaptureFormSummary {
  id: string;
  brandId: string;
  name: string;
  description: string | null;
  schemaFields: LeadCaptureFormField[];
  embedCode: string | null;
  submitCount: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export type LeadCaptureFormResponse = LeadCaptureFormSummary;
export type LeadCaptureFormListResponse = ListResponse<LeadCaptureFormSummary>;

export interface LeadCaptureSubmissionSummary {
  id: string;
  formId: string;
  rawPayload: Record<string, unknown>;
  mappedFields: Record<string, unknown> | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmTerm: string | null;
  utmContent: string | null;
  crmLeadId: string | null;
  submittedAt: string;
}

export type LeadCaptureSubmissionResponse = LeadCaptureSubmissionSummary;
export type LeadCaptureSubmissionListResponse = ListResponse<LeadCaptureSubmissionSummary>;

export interface PublicFormSubmitRequest {
  fields: Record<string, unknown>;
  /**
   * The honeypot. Rendered, hidden, and empty for every human being; anything in it means the
   * submission came from something filling in every input it found. May also travel inside
   * `fields` as `_hp`.
   */
  honeypot?: string;
  utm?: {
    source?: string;
    medium?: string;
    campaign?: string;
    term?: string;
    content?: string;
  };
}

export interface PublicFormSubmitResponse {
  success: boolean;
  submissionId: string;
  leadId: string;
  isNewLead: boolean;
  message?: string;
}

export interface NurtureSequenceStep {
  orderIndex: number;
  delayMinutes: number;
  emailSubject: string;
  emailBody: string;
}

export interface CreateNurtureSequenceRequest {
  brandId: string;
  name: string;
  description?: string;
  triggerEvent: string;
  steps?: NurtureSequenceStep[];
}

export interface UpdateNurtureSequenceRequest {
  name?: string;
  description?: string;
  triggerEvent?: string;
  steps?: NurtureSequenceStep[];
  status?: 'ACTIVE' | 'PAUSED';
}

export interface NurtureSequenceSummary {
  id: string;
  brandId: string;
  name: string;
  description: string | null;
  triggerEvent: string;
  steps: NurtureSequenceStep[];
  status: string;
  createdAt: string;
  updatedAt: string;
}

export type NurtureSequenceResponse = NurtureSequenceSummary;
export type NurtureSequenceListResponse = ListResponse<NurtureSequenceSummary>;

export interface AdWebhookResponse {
  received: boolean;
  platform: string;
  leadId: string;
  isNewLead: boolean;
}

// ─── Unified Social Inbox & DM Flows (Ticket 08) ──────────────────────────────────

export const SOCIAL_MESSAGE_STATUSES = ['unread', 'pending', 'resolved'] as const;
export type SocialMessageStatus = (typeof SOCIAL_MESSAGE_STATUSES)[number];

export const SOCIAL_MESSAGE_DIRECTIONS = ['inbound', 'outbound'] as const;
export type SocialMessageDirection = (typeof SOCIAL_MESSAGE_DIRECTIONS)[number];

export const DM_MATCH_TYPES = ['EXACT', 'CONTAINS'] as const;
export type DmMatchType = (typeof DM_MATCH_TYPES)[number];

export interface SocialMessageSummary {
  id: string;
  brandId: string;
  socialAccountId: string | null;
  conversationId: string;
  senderId: string;
  senderName: string | null;
  senderAvatar: string | null;
  recipientId: string | null;
  content: string;
  direction: SocialMessageDirection;
  status: SocialMessageStatus;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export type SocialMessageResponse = SocialMessageSummary;
export type SocialMessageListResponse = ListResponse<SocialMessageSummary>;

export interface SocialConversationSummary {
  conversationId: string;
  brandId: string;
  socialAccountId: string | null;
  senderId: string;
  senderName: string | null;
  senderAvatar: string | null;
  platform: string;
  latestMessageContent: string;
  latestMessageAt: string;
  unreadCount: number;
  totalMessages: number;
  status: SocialMessageStatus;
  leadId?: string | null;
}

export type SocialConversationListResponse = ListResponse<SocialConversationSummary>;

export interface SendSocialMessageRequest {
  brandId: string;
  conversationId: string;
  content: string;
  socialAccountId?: string;
  recipientId?: string;
  senderName?: string;
  humanAgentTag?: boolean;
}

export interface SocialRateLimitStatus {
  platform: string;
  publishing: {
    limit: number;
    windowSeconds: number;
    used: number;
    remaining: number;
    resetAt: string;
  };
  messaging: {
    maxInboundWindowHours: number;
    extendedHumanAgentWindowDays: number;
  };
}

export type SocialRateLimitStatusResponse = SocialRateLimitStatus;

export interface UpdateSocialMessageStatusRequest {
  status: SocialMessageStatus;
}

export interface ConvertConversationToLeadRequest {
  brandId: string;
  conversationId: string;
  name?: string;
  email?: string;
  phone?: string;
  organisationName?: string;
}

export interface ConvertConversationToLeadResponse {
  success: boolean;
  leadId: string;
  isNewLead: boolean;
  conversationId: string;
  messageCount: number;
  leadName: string;
}

export interface DmAutomationFlowSummary {
  id: string;
  brandId: string;
  socialAccountId: string | null;
  name: string;
  triggerKeyword: string;
  matchType: DmMatchType;
  responseTemplate: string;
  leadMagnetUrl: string | null;
  isActive: boolean;
  triggerCount: number;
  createdAt: string;
  updatedAt: string;
}

export type DmAutomationFlowResponse = DmAutomationFlowSummary;
export type DmAutomationFlowListResponse = ListResponse<DmAutomationFlowSummary>;

export interface CreateDmAutomationFlowRequest {
  brandId: string;
  name: string;
  triggerKeyword: string;
  matchType?: DmMatchType;
  responseTemplate: string;
  leadMagnetUrl?: string;
  socialAccountId?: string;
  isActive?: boolean;
}

export interface UpdateDmAutomationFlowRequest {
  name?: string;
  triggerKeyword?: string;
  matchType?: DmMatchType;
  responseTemplate?: string;
  leadMagnetUrl?: string;
  socialAccountId?: string;
  isActive?: boolean;
}

export interface SocialInboxWebhookResponse {
  received: boolean;
  platform: string;
  messageId?: string;
  autoReplied?: boolean;
  flowId?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Web Tracking & Visitor Analytics (Ticket 09)
// ─────────────────────────────────────────────────────────────────────────────

export interface TrackingSiteSummary {
  id: string;
  brandId: string;
  name: string;
  domain: string;
  pixelKey: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  _count?: {
    pageViews?: number;
  };
}

export type TrackingSiteResponse = TrackingSiteSummary;
export type TrackingSiteListResponse = ListResponse<TrackingSiteSummary>;

export interface CreateTrackingSiteRequest {
  brandId: string;
  name: string;
  domain: string;
  isActive?: boolean;
}

export interface CollectEventRequest {
  pixelKey: string;
  visitorId: string;
  sessionId?: string;
  path: string;
  referrer?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmTerm?: string;
  utmContent?: string;
  country?: string;
  device?: string;
  browser?: string;
  screen?: string;
}

export interface DailyAnalyticsItem {
  date: string;
  pageviews: number;
  visitors: number;
  sessions: number;
}

export interface PageAnalyticsItem {
  path: string;
  pageviews: number;
}

export interface ReferrerAnalyticsItem {
  referrer: string;
  pageviews: number;
}

export interface UtmCampaignAnalyticsItem {
  utmCampaign: string;
  pageviews: number;
  visitors: number;
}

export interface DeviceAnalyticsItem {
  device: string;
  count: number;
}

export interface TrackingAnalyticsResponse {
  siteId?: string;
  brandId?: string;
  totalPageviews: number;
  totalVisitors: number;
  totalSessions: number;
  daily: DailyAnalyticsItem[];
  topPages: PageAnalyticsItem[];
  topReferrers: ReferrerAnalyticsItem[];
  campaigns: UtmCampaignAnalyticsItem[];
  devices: DeviceAnalyticsItem[];
}


// ─── Composer intelligence (ticket 14, phase 1) ────────────────────────────────────

/**
 * Where a posting-time recommendation actually came from.
 *
 * Not a label the UI decides. The API cannot express a recommendation without saying whose
 * data produced it (14j), because "your audience is most active at 7pm" and "people in
 * general are most active at 7pm" are different claims and only one of them is worth acting
 * on.
 */
export const POSTING_TIME_SOURCES = ['tenant', 'cohort', 'global'] as const;
export type PostingTimeSource = (typeof POSTING_TIME_SOURCES)[number];

/** Posts with metrics needed for that (brand, network) before `tenant` is honest. */
export const TENANT_POSTING_TIME_MINIMUM = 30;

/** The trailing window the tenant figure is computed over, in days. */
export const POSTING_TIME_WINDOW_DAYS = 90;

/** One hour of one weekday, in the brand's timezone. */
export interface PostingTimeBucket {
  /** 0 = Sunday, in the brand's timezone. */
  dayOfWeek: number;
  /** 0-23, in the brand's timezone. */
  hour: number;
  /** Mean engagement for posts published in this bucket, normalised to 0-100. */
  score: number;
  /** Posts behind this bucket. Never fewer than 5 — thin buckets merge (14l). */
  sampleSize: number;
}

export interface BestTimeResponse {
  brandId: string;
  platform: SocialPlatform;
  /** Required, not optional. See `POSTING_TIME_SOURCES`. */
  source: PostingTimeSource;
  /** Required. Posts behind the whole recommendation. */
  sampleSize: number;
  /** The brand's timezone — the buckets are hours in it, never in the viewer's. */
  timezone: string;
  /** When the queued recompute last produced this, or null if it has not yet run. */
  computedAt: string | null;
  buckets: PostingTimeBucket[];
  /** The strongest few buckets, already sorted. */
  recommendations: PostingTimeBucket[];
}

export const SNIPPET_KINDS = ['first_comment', 'cta'] as const;
export type SnippetKind = (typeof SNIPPET_KINDS)[number];

export interface SnippetSummary {
  id: string;
  brandId: string;
  kind: SnippetKind;
  label: string;
  /** Plain text. Rendered into a textarea value, never as HTML (14o). */
  body: string;
  createdAt: string;
  updatedAt: string;
}

export type SnippetListResponse = ListResponse<SnippetSummary>;

export interface CreateSnippetRequest {
  brandId: string;
  kind: SnippetKind;
  label: string;
  body: string;
}

export interface UpdateSnippetRequest {
  label?: string;
  body?: string;
}

// ─── Per-network limits (ticket 14, decision 14m) ──────────────────────────────────
/**
 * What each social network will accept, and the one validator that reads it.
 *
 * There is exactly one of these tables. The composer imports it to draw its meters and the
 * publisher imports it to refuse a post, so the number the user was shown and the number the
 * server enforces cannot drift apart — decision 14m. A network that changes its limits is a
 * table edit here and nothing else: no model call, no call to the network to ask.
 *
 * Wire-adjacent data with no behaviour, which is why it sits beside `contract.ts` rather than
 * in either workspace.
 */

/**
 * What the network does with a URL in the body text.
 *
 * Not a cosmetic distinction: on three of these networks a link in the caption is either
 * removed or costs the post its reach, and the user needs to hear that while writing rather
 * than after publishing.
 */
export type LinkHandling =
  /** Rendered as a working link. */
  | 'clickable'
  /** Kept as text, but not tappable — the user needs a bio link or a first comment. */
  | 'not-clickable'
  /** Works, but the network shows the post to fewer people for carrying it. */
  | 'deprioritised'
  /** Removed by the network, or rejected outright. */
  | 'unsupported';

/** One accepted media shape, as a name and the width ÷ height it stands for. */
export interface AspectRatio {
  readonly label: string;
  readonly ratio: number;
}

export interface NetworkLimits {
  readonly platform: SocialPlatform;
  readonly label: string;
  /** Characters of body text the network accepts. */
  readonly characterLimit: number;
  /** Images or videos attachable to one post. */
  readonly maxMedia: number;
  readonly aspectRatios: readonly AspectRatio[];
  readonly maxMentions: number;
  readonly maxHashtags: number;
  readonly linkHandling: LinkHandling;
  /** Said in the composer, and repeated verbatim by the publisher's refusal. */
  readonly linkNote: string;
  /** Longest single video, in seconds. */
  readonly maxVideoSeconds: number;
}

const RATIO_SQUARE: AspectRatio = { label: '1:1', ratio: 1 };
const RATIO_PORTRAIT: AspectRatio = { label: '4:5', ratio: 0.8 };
const RATIO_VERTICAL: AspectRatio = { label: '9:16', ratio: 0.5625 };
const RATIO_LANDSCAPE: AspectRatio = { label: '1.91:1', ratio: 1.91 };
const RATIO_WIDE: AspectRatio = { label: '16:9', ratio: 1.7778 };

/**
 * The table. Frozen, because a lookup table that a caller can edit at runtime is a lookup
 * table that says something different on the server than it said in the browser.
 */
export const NETWORK_LIMITS: Readonly<Record<SocialPlatform, NetworkLimits>> = Object.freeze({
  instagram: Object.freeze({
    platform: 'instagram',
    label: 'Instagram',
    characterLimit: 2200,
    maxMedia: 10,
    aspectRatios: Object.freeze([RATIO_SQUARE, RATIO_PORTRAIT, RATIO_VERTICAL, RATIO_LANDSCAPE]),
    maxMentions: 20,
    maxHashtags: 30,
    linkHandling: 'not-clickable',
    linkNote: 'Instagram captions do not make links tappable — use the bio link or a first comment.',
    maxVideoSeconds: 900,
  }),
  facebook: Object.freeze({
    platform: 'facebook',
    label: 'Facebook',
    characterLimit: 63206,
    maxMedia: 10,
    aspectRatios: Object.freeze([RATIO_LANDSCAPE, RATIO_SQUARE, RATIO_PORTRAIT, RATIO_VERTICAL]),
    maxMentions: 50,
    maxHashtags: 30,
    linkHandling: 'clickable',
    linkNote: 'Links are clickable and get a preview card.',
    maxVideoSeconds: 14_400,
  }),
  linkedin: Object.freeze({
    platform: 'linkedin',
    label: 'LinkedIn',
    characterLimit: 3000,
    maxMedia: 20,
    aspectRatios: Object.freeze([RATIO_LANDSCAPE, RATIO_SQUARE, RATIO_PORTRAIT, RATIO_VERTICAL]),
    maxMentions: 30,
    maxHashtags: 30,
    linkHandling: 'deprioritised',
    linkNote: 'LinkedIn shows posts carrying an outbound link to fewer people — consider the first comment.',
    maxVideoSeconds: 900,
  }),
  x: Object.freeze({
    platform: 'x',
    label: 'X',
    characterLimit: 280,
    maxMedia: 4,
    aspectRatios: Object.freeze([RATIO_WIDE, RATIO_SQUARE]),
    maxMentions: 10,
    maxHashtags: 10,
    linkHandling: 'clickable',
    linkNote: 'Links are shortened to 23 characters and count against the limit.',
    maxVideoSeconds: 140,
  }),
  tiktok: Object.freeze({
    platform: 'tiktok',
    label: 'TikTok',
    characterLimit: 2200,
    maxMedia: 35,
    aspectRatios: Object.freeze([RATIO_VERTICAL]),
    maxMentions: 10,
    maxHashtags: 30,
    linkHandling: 'not-clickable',
    linkNote: 'A link in a TikTok caption is plain text — it is not tappable.',
    maxVideoSeconds: 600,
  }),
  youtube: Object.freeze({
    platform: 'youtube',
    label: 'YouTube',
    characterLimit: 5000,
    maxMedia: 1,
    aspectRatios: Object.freeze([RATIO_WIDE, RATIO_VERTICAL]),
    maxMentions: 20,
    maxHashtags: 15,
    linkHandling: 'clickable',
    linkNote: 'Description links are clickable once the channel is verified.',
    maxVideoSeconds: 43_200,
  }),
  pinterest: Object.freeze({
    platform: 'pinterest',
    label: 'Pinterest',
    characterLimit: 500,
    maxMedia: 1,
    aspectRatios: Object.freeze([{ label: '2:3', ratio: 0.6667 }, RATIO_SQUARE, RATIO_VERTICAL]),
    maxMentions: 10,
    maxHashtags: 20,
    linkHandling: 'clickable',
    linkNote: 'The destination link belongs on the Pin, not in the description.',
    maxVideoSeconds: 900,
  }),
  threads: Object.freeze({
    platform: 'threads',
    label: 'Threads',
    characterLimit: 500,
    maxMedia: 20,
    aspectRatios: Object.freeze([RATIO_SQUARE, RATIO_PORTRAIT, RATIO_VERTICAL]),
    maxMentions: 20,
    maxHashtags: 1,
    linkHandling: 'clickable',
    linkNote: 'Threads accepts one topic tag per post.',
    maxVideoSeconds: 300,
  }),
  bluesky: Object.freeze({
    platform: 'bluesky',
    label: 'Bluesky',
    characterLimit: 300,
    maxMedia: 4,
    aspectRatios: Object.freeze([RATIO_WIDE, RATIO_SQUARE]),
    maxMentions: 10,
    maxHashtags: 10,
    linkHandling: 'clickable',
    linkNote: 'Links are clickable and count in full against the 300 characters.',
    maxVideoSeconds: 60,
  }),
  google_business: Object.freeze({
    platform: 'google_business',
    label: 'Google Business Profile',
    characterLimit: 1500,
    maxMedia: 1,
    aspectRatios: Object.freeze([{ label: '4:3', ratio: 1.3333 }, RATIO_SQUARE]),
    maxMentions: 0,
    maxHashtags: 0,
    linkHandling: 'unsupported',
    linkNote: 'Google Business Profile strips hashtags and body links — use the post action button.',
    maxVideoSeconds: 30,
  }),
});

/** Everything the validator needs to know about a draft. */
export interface DraftForNetwork {
  readonly content: string;
  readonly mediaCount?: number;
  /** Width ÷ height for each attached image or video, where the client knows them. */
  readonly mediaAspectRatios?: readonly number[];
  readonly videoSeconds?: number;
}

export type NetworkLimitCode =
  | 'character_limit'
  | 'media_count'
  | 'aspect_ratio'
  | 'mention_limit'
  | 'hashtag_limit'
  | 'link_unsupported'
  | 'video_length';

export interface NetworkLimitViolation {
  readonly platform: SocialPlatform;
  readonly code: NetworkLimitCode;
  /** Shown by the composer and repeated by the publisher's refusal — one string, one source. */
  readonly message: string;
}

/**
 * Hashtags and mentions, counted the way the networks count them.
 *
 * Anchored to a word boundary so `#` inside a URL fragment or an email address is not a tag.
 */
const HASHTAG = /(^|[^\w#/])#(\w{1,138})/gu;
const MENTION = /(^|[^\w@/])@([\w.]{1,60})/gu;
const URL_IN_TEXT = /\bhttps?:\/\/[^\s<>"']+/giu;

/** How close a real image has to be to a listed ratio before it is that ratio. */
const RATIO_TOLERANCE = 0.05;

function countMatches(text: string, pattern: RegExp): number {
  // A fresh lastIndex each call: these are module-level /g regexes and are shared.
  pattern.lastIndex = 0;
  let count = 0;
  while (pattern.exec(text) !== null) count += 1;
  return count;
}

export function countHashtags(text: string): number {
  return countMatches(text, HASHTAG);
}

export function countMentions(text: string): number {
  return countMatches(text, MENTION);
}

export function containsLink(text: string): boolean {
  URL_IN_TEXT.lastIndex = 0;
  return URL_IN_TEXT.test(text);
}

/**
 * Every way one draft breaks one network's rules.
 *
 * Returns all of them rather than the first, because a composer that reveals one problem per
 * attempt is a composer people publish around. Pure: no network call, no clock, no state.
 */
export function validateForNetwork(
  platform: SocialPlatform,
  draft: DraftForNetwork,
): NetworkLimitViolation[] {
  const limits = NETWORK_LIMITS[platform];
  if (!limits) return [];

  const violations: NetworkLimitViolation[] = [];
  const fail = (code: NetworkLimitCode, message: string): void => {
    violations.push({ platform, code, message });
  };

  const content = draft.content ?? '';

  if (content.length > limits.characterLimit) {
    fail(
      'character_limit',
      `${limits.label} allows ${limits.characterLimit} characters; this post is ${content.length}.`,
    );
  }

  const mediaCount = draft.mediaCount ?? 0;
  if (mediaCount > limits.maxMedia) {
    fail(
      'media_count',
      `${limits.label} allows ${limits.maxMedia} attachment(s); this post has ${mediaCount}.`,
    );
  }

  for (const ratio of draft.mediaAspectRatios ?? []) {
    if (!Number.isFinite(ratio) || ratio <= 0) continue;
    const matched = limits.aspectRatios.some(
      (accepted) => Math.abs(accepted.ratio - ratio) <= RATIO_TOLERANCE,
    );
    if (!matched) {
      fail(
        'aspect_ratio',
        `${limits.label} accepts ${limits.aspectRatios
          .map((accepted) => accepted.label)
          .join(', ')}; one attachment is ${ratio.toFixed(2)}:1.`,
      );
      break;
    }
  }

  const mentions = countMentions(content);
  if (mentions > limits.maxMentions) {
    fail(
      'mention_limit',
      limits.maxMentions === 0
        ? `${limits.label} does not support @ mentions.`
        : `${limits.label} allows ${limits.maxMentions} mention(s); this post has ${mentions}.`,
    );
  }

  const hashtags = countHashtags(content);
  if (hashtags > limits.maxHashtags) {
    fail(
      'hashtag_limit',
      limits.maxHashtags === 0
        ? `${limits.label} does not support hashtags.`
        : `${limits.label} allows ${limits.maxHashtags} hashtag(s); this post has ${hashtags}.`,
    );
  }

  if (limits.linkHandling === 'unsupported' && containsLink(content)) {
    fail('link_unsupported', limits.linkNote);
  }

  if (draft.videoSeconds !== undefined && draft.videoSeconds > limits.maxVideoSeconds) {
    fail(
      'video_length',
      `${limits.label} allows video up to ${limits.maxVideoSeconds}s; this one is ${Math.round(
        draft.videoSeconds,
      )}s.`,
    );
  }

  return violations;
}

/** The same check across every selected channel, so the composer can list them together. */
export function validateForNetworks(
  platforms: readonly SocialPlatform[],
  draft: DraftForNetwork,
): NetworkLimitViolation[] {
  return platforms.flatMap((platform) => validateForNetwork(platform, draft));
}
