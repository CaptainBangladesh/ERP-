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

export const MARKETING_PATHS = {
  marketings: `/${MARKETING_ROUTE}`,
  marketing: (id: string) => `/${MARKETING_ROUTE}/${id}`,
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

export interface SmartLinkTheme {
  primaryColor: string;
  backgroundColor: string;
  textColor: string;
  cardStyle?: 'flat' | 'rounded' | 'glassmorphism' | 'shadow';
  fontFamily?: string;
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



