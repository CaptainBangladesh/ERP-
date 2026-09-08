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
  // Composer intelligence (ticket 14, phase 2) — metered generation
  aiAllowance: `/${MARKETING_ROUTE}/ai/allowance`,
  aiCompose: `/${MARKETING_ROUTE}/ai/compose`,
  brandAiKey: (brandId: string) => `/${MARKETING_ROUTE}/brands/${brandId}/ai-key`,
  // External content sources (ticket 15) — RSS ingest and competitor benchmarking
  contentFeeds: `/${MARKETING_ROUTE}/content-feeds`,
  contentFeed: (id: string) => `/${MARKETING_ROUTE}/content-feeds/${id}`,
  pollContentFeed: (id: string) => `/${MARKETING_ROUTE}/content-feeds/${id}/poll`,
  enableContentFeed: (id: string) => `/${MARKETING_ROUTE}/content-feeds/${id}/enable`,
  contentFeedEntries: `/${MARKETING_ROUTE}/content-feed-entries`,
  competitors: `/${MARKETING_ROUTE}/competitors`,
  competitor: (id: string) => `/${MARKETING_ROUTE}/competitors/${id}`,
  snapshotCompetitor: (id: string) => `/${MARKETING_ROUTE}/competitors/${id}/snapshot`,
  competitorSnapshots: `/${MARKETING_ROUTE}/competitor-snapshots`,
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
 * The publishing role: the one that may connect an account or spend a tenant's own money.
 *
 * Named here rather than spelled `'lead'` at each check, because 14v and 17d are the same
 * authorisation question asked in two places and they must not be able to drift apart.
 */
export const BRAND_PUBLISHING_ROLE: BrandMemberRole = 'lead';

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
  /** Brand voice, read by the prompt allowlist and by nothing else (14b). */
  voiceTone?: string;
  productDescription?: string;
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
  /** Brand voice, read by the prompt allowlist and by nothing else (14b). */
  voiceTone?: string;
  productDescription?: string;
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
  /** Brand voice, read by the prompt allowlist and by nothing else (14b). */
  voiceTone: string | null;
  productDescription: string | null;
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
  /** The tenant has spent this month's generation allowance. Names the reset date (14d). */
  aiAllowanceExhausted: 'ai_allowance_exhausted',
  /** The request carried a field the compose endpoint does not accept — a model, a token
   *  budget, a temperature, a key, a price. Refused rather than trimmed (14q). */
  aiUnknownField: 'ai_unknown_field',
  /** An array of drafts arrived at the interactive endpoint. Bulk is the batch path (14u). */
  aiBulkRefused: 'ai_bulk_refused',
  /** The provider answered with an error. Vendor message and status only, never the body (14r). */
  aiProviderFailed: 'ai_provider_failed',
  /** The tenant's own key was rejected. Never a silent fall back to the platform key (14v). */
  aiTenantKeyRejected: 'ai_tenant_key_rejected',
  /** Only a brand's publishing role may set, rotate or delete the tenant key (14v). */
  aiKeyForbidden: 'ai_key_forbidden',
  aiKeyNotFound: 'ai_key_not_found',
  // ─── External content sources (ticket 15) ───
  contentFeedNotFound: 'content_feed_not_found',
  contentFeedAlreadyExists: 'content_feed_already_exists',
  /** The brand is at its configured ceiling of feeds or competitor rows (14-17.0e). */
  externalSourceLimitReached: 'external_source_limit_reached',
  competitorNotFound: 'competitor_not_found',
  competitorAlreadyExists: 'competitor_already_exists',
  /** No connected account for that network on this brand — never an app-level token (15b). */
  competitorAccountMissing: 'competitor_account_missing',
  /** The window's publishing floor is reserved; a benchmark read may not draw on it (15e). */
  competitorQuotaReserved: 'competitor_quota_reserved',
} as const;

// ─── External content sources (ticket 15) ─────────────────────────────────────────

/**
 * Why an outbound fetch did not produce a body (14-17.0d).
 *
 * A closed enum, and the *only* thing an operator or a log line is ever told about a remote
 * response. No status line, no header, no body fragment, no resolved address: blind SSRF
 * becomes useful SSRF the moment the error panel echoes what came back.
 */
export const OUTBOUND_FETCH_REASONS = [
  'blocked_scheme',
  'blocked_address',
  'too_many_redirects',
  'too_large',
  'timeout',
  'http_error',
  'parse_error',
] as const;

export type OutboundFetchReason = (typeof OUTBOUND_FETCH_REASONS)[number];

/** What an operator reads beside a reason code — their own words, not the remote's. */
export const OUTBOUND_FETCH_REASON_LABELS: Record<OutboundFetchReason, string> = {
  blocked_scheme: 'Refused: the address is not an https:// URL on port 443.',
  blocked_address: 'Refused: that host resolves to an address this server will not call.',
  too_many_redirects: 'Refused: the address redirected too many times.',
  too_large: 'Refused: the response was larger than the 2 MB limit.',
  timeout: 'Refused: the host did not answer inside the time limit.',
  http_error: 'The host answered with an error.',
  parse_error: 'The document could not be read as a feed.',
};

export const CONTENT_FEED_STATUSES = ['ACTIVE', 'DISABLED'] as const;
export type ContentFeedStatus = (typeof CONTENT_FEED_STATUSES)[number];

/** A brand's ceiling on operator-supplied fetch targets and competitor rows (14-17.0e). */
export const MAX_FEEDS_PER_BRAND = 25;
export const MAX_COMPETITORS_PER_BRAND = 25;

/** Consecutive failures before a feed is disabled rather than polled again (16f). */
export const FEED_FAILURES_BEFORE_DISABLE = 5;

/** The stored excerpt of somebody else's copy — an excerpt, not a reproduction (16h). */
export const FEED_EXCERPT_MAX_CHARS = 400;

export interface ContentFeedSummary {
  readonly id: string;
  readonly brandId: string;
  readonly name: string;
  readonly url: string;
  readonly status: ContentFeedStatus;
  readonly lastPolledAt?: string;
  readonly lastSuccessAt?: string;
  /** The closed code and nothing else (14-17.0d). */
  readonly lastReason?: OutboundFetchReason;
  readonly consecutiveFailures: number;
  readonly entryCount: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type ContentFeedListResponse = ListResponse<ContentFeedSummary>;

export interface CreateContentFeedRequest {
  readonly brandId: string;
  readonly name: string;
  /** `https:` only at save time (16a); re-checked against DNS on every poll (14-17.0). */
  readonly url: string;
}

/**
 * One ingested entry — a draft, and the provenance that makes it obviously somebody else's
 * writing (16h). Title and excerpt are **text**; nothing here is ever rendered as HTML (16d).
 */
export interface ContentFeedEntrySummary {
  readonly id: string;
  readonly brandId: string;
  readonly feedId: string;
  readonly feedName: string;
  readonly title: string;
  readonly excerpt: string;
  readonly link: string;
  readonly enclosureUrl?: string;
  readonly publishedAt?: string;
  readonly fetchedAt: string;
  readonly status: 'DRAFT';
}

export type ContentFeedEntryListResponse = ListResponse<ContentFeedEntrySummary>;

export interface CompetitorSummary {
  readonly id: string;
  readonly brandId: string;
  readonly network: SocialPlatform;
  /** An identifier, never a URL (15d). */
  readonly handle: string;
  readonly label: string;
  /** False when the network's API exposes no public profile metrics (15a). */
  readonly metricsSupported: boolean;
  readonly latestSnapshot?: CompetitorSnapshotSummary;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type CompetitorListResponse = ListResponse<CompetitorSummary>;

export interface CreateCompetitorRequest {
  readonly brandId: string;
  readonly network: SocialPlatform;
  readonly handle: string;
  readonly label?: string;
}

/** Aggregates and a date. No post bodies, no commenter names, no mirrored photos (15c). */
export interface CompetitorSnapshotSummary {
  readonly id: string;
  readonly competitorId: string;
  readonly network: SocialPlatform;
  /** `YYYY-MM-DD`, UTC — one row per competitor per day (15f). */
  readonly captureDate: string;
  readonly followerCount?: number;
  readonly postCount?: number;
  readonly engagementRate?: number;
  readonly capturedAt: string;
}

export type CompetitorSnapshotListResponse = ListResponse<CompetitorSnapshotSummary>;

/**
 * A handle's shape, per 15d — letters, digits, `_`, `.`, `-`, and nothing else.
 *
 * Rejected rather than sanitized when it fails, because "sanitize a handle" is how a field
 * that quietly accepts `https://…` reopens the scraper path 15a closed.
 */
export const COMPETITOR_HANDLE_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

export function isCompetitorHandle(value: string): boolean {
  return COMPETITOR_HANDLE_PATTERN.test(value);
}

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

// ─── Composer intelligence (ticket 14, phase 2) — metered generation ───────────────

/**
 * The model, pinned.
 *
 * Haiku 4.5 is 14g's default and stays it until the blind A/B moves it, which can only
 * happen behind `resolveAiProvider` (14a-bis). Pinned to a dated snapshot rather than a
 * floating alias because a model that changes underneath a fixed `max_tokens` and a
 * dollar-denominated allowance changes the bill without changing the code.
 */
export const AI_MODEL = 'claude-haiku-4-5-20251001';

/** Haiku 4.5 list price, in cents per 1,000 tokens: $1/MTok in, $5/MTok out. */
export const AI_INPUT_CENTS_PER_1K = 0.1;
export const AI_OUTPUT_CENTS_PER_1K = 0.5;

/**
 * `max_tokens` from the real shape of the output, not a default (14e).
 *
 * A caption is 30-60 tokens. Three of them plus the JSON scaffolding is ~250, and output is
 * ~77% of this workload's bill — a 400+ default would be a 60% overcharge on every call
 * nobody would ever see.
 */
export const AI_MAX_OUTPUT_TOKENS = 250;

/** The ceiling the prompt builder is capped to, and what an estimate is priced against. */
export const AI_MAX_INPUT_TOKENS = 1_200;

/**
 * What one generation is charged to the ledger *before* the call (14p), in cents.
 *
 * The ceiling rather than the expectation: input cap plus output cap, so the reservation can
 * never be smaller than the invoice. The reconciliation row afterwards gives the difference
 * back from `response.usage`.
 */
export const AI_GENERATION_ESTIMATE_CENTS =
  (AI_MAX_INPUT_TOKENS / 1000) * AI_INPUT_CENTS_PER_1K +
  (AI_MAX_OUTPUT_TOKENS / 1000) * AI_OUTPUT_CENTS_PER_1K;

/** 14d's figure: a Later-sized allowance, per tenant per month, no rollover. */
export const AI_MONTHLY_GENERATIONS = 20;

/**
 * The allowance the platform key funds, in cents of model spend per tenant per month.
 *
 * Denominated in dollars rather than request counts so that a longer prompt or a chattier
 * model cannot quietly raise the ceiling (14d) — 20 generations is what that money buys at
 * today's prompt shape, not a second, separate limit.
 */
export const AI_PLATFORM_MONTHLY_CAP_CENTS =
  AI_MONTHLY_GENERATIONS * AI_GENERATION_ESTIMATE_CENTS;

/**
 * What a tenant's own key buys: 25× the platform allowance, ~500 generations a month (14h).
 *
 * It raises the ceiling; it does not remove the meter. A tenant paying their own bill still
 * gets a number they can see and a refusal they can understand.
 */
export const AI_TENANT_KEY_CAP_MULTIPLIER = 25;

/** One call returns N variants — never N calls (14e). */
export const AI_MAX_VARIANTS = 3;

/** The longest draft the composer will send. Everything past this is a bulk path. */
export const AI_MAX_DRAFT_CHARS = 2_000;

/** The period key: `YYYY-MM` in UTC, so a month means the same thing in every timezone. */
export function aiPeriodKey(at: Date = new Date()): string {
  return `${at.getUTCFullYear()}-${String(at.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** The first instant of the month after `period` — the date a refusal names (14q). */
export function aiPeriodResetsAt(period: string): string {
  const [year, month] = period.split('-').map((part) => Number(part));
  return new Date(Date.UTC(year ?? 1970, month ?? 1, 1)).toISOString();
}

/** Cost in cents of one completion, from `response.usage` and nothing else (14d). */
export function aiCostCents(inputTokens: number, outputTokens: number): number {
  return (
    (inputTokens / 1000) * AI_INPUT_CENTS_PER_1K +
    (outputTokens / 1000) * AI_OUTPUT_CENTS_PER_1K
  );
}

/**
 * What the composer knows before it spends anything (14q).
 *
 * Read by its own endpoint so the number is on screen *before* the user generates, rather
 * than being learned from a refusal.
 */
export interface AiAllowanceResponse {
  /** `YYYY-MM`, UTC. */
  readonly period: string;
  readonly capCents: number;
  readonly spentCents: number;
  readonly remainingCents: number;
  /** Whole generations left at the reservation price — the number worth showing a human. */
  readonly remainingGenerations: number;
  /** ISO instant the allowance resets. No rollover. */
  readonly resetsAt: string;
  /** Which key funds it: the platform's, or this tenant's own (14h). */
  readonly source: 'platform' | 'tenant';
  readonly model: string;
}

/**
 * Everything the client may say about a generation, and nothing else.
 *
 * No `model`, no `maxTokens`, no `temperature`, no `apiKey`, no cost figure: the server picks
 * all of them, and a body carrying one is refused rather than trimmed (14q). The brand voice
 * is looked up server-side from `brandId` — the client cannot widen the prompt (14b).
 */
export interface AiComposeRequest {
  readonly brandId: string;
  readonly draft: string;
  readonly platform: SocialPlatform;
  readonly variants?: number;
}

export interface AiComposeVariant {
  readonly text: string;
  readonly characters: number;
}

export interface AiComposeResponse {
  readonly variants: readonly AiComposeVariant[];
  /**
   * Always `true`, and it is a promise rather than a flag: nothing here is applied, scheduled,
   * published or sent. A variant reaches a post only when a human puts it there (14c).
   */
  readonly requiresAccept: true;
  readonly allowance: AiAllowanceResponse;
  readonly model: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
}

/** The tenant key, as the client is ever allowed to see it: masked, or absent (14v). */
export interface AiKeyStatusResponse {
  readonly configured: boolean;
  /** Masked from the *decrypted* value (11.4a). Absent when no key is stored. */
  readonly maskedKey?: string;
  readonly updatedAt?: string;
  /** The allowance this tenant is on right now, in cents. */
  readonly capCents: number;
}

export interface SetAiKeyRequest {
  readonly apiKey: string;
}

/**
 * Model output is text on a rendering path (14s).
 *
 * Control characters stripped — a completion arrives from outside the tenant exactly as an
 * inbox message does — and trimmed to the target network's own cap from the table above, so
 * a variant the composer offers is a variant the publisher would accept. The result is put in
 * a `textarea` value; it is never HTML, never markdown-with-HTML, and never written to a
 * bio page or any other server-rendered surface without the escaping a typed field gets.
 */
export function normaliseCompletion(text: string, platform: SocialPlatform): string {
  const stripped = text
    // Control characters, keeping the newline and tab a caption legitimately contains.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    // Bidirectional overrides, which render as text that is not the text stored.
    .replace(/[\u202A-\u202E\u2066-\u2069]/g, '')
    .replace(/\r\n?/g, '\n')
    .trim();

  const limit = NETWORK_LIMITS[platform].characterLimit;
  return stripped.length > limit ? stripped.slice(0, limit).trimEnd() : stripped;
}
