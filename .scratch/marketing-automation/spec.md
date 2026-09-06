# Spec — Marketing Automation: Social Media Suite, Campaigns, SmartLinks, Lead Gen & Attribution

Status: ready-for-agent

Consolidates the resolved architectural and functional decisions on the Marketing Automation map (`.scratch/marketing-automation/map.md`), research findings across four specialized research subagents, and the settled domain model for the Marketing Automation & Social Media command center in the ERP.

## Problem Statement

Businesses and marketing agencies using this ERP currently have no unified way to manage marketing campaigns, social media publishing, community conversations, or inbound lead generation. 

Today, social publishing requires juggling 6+ separate native apps (Instagram, Facebook, LinkedIn, TikTok, X, YouTube, Google Business Profile), leading to disconnected schedules, lost context, and inconsistent branding. External client approvals for marketing agencies involve messy email threads or unmanaged screenshots, with no cryptographic audit trail or review portal. Furthermore, inbound marketing engagement (DM conversations, ad clicks, bio-link visits, and web form submissions) is completely disconnected from the Sales CRM: leads must be manually exported and re-entered into CRM tables, causing delayed follow-ups and zero closed-loop attribution on marketing ROI.

## Solution

Build the `marketing` module (`core` tier, `dependsOn: ['crm', 'parties']`) delivering an all-in-one Marketing & Social Media Command Center directly integrated with the existing Sales CRM:

1. **Brand Multi-Tenancy & Encrypted Credential Vault**: Allows companies and marketing agencies to isolate multiple client "Brands" under one organization. Each Brand holds its own connected social profiles with OAuth 2.0 access/refresh tokens encrypted at rest via AES-256-GCM.
2. **Multi-Network Content Planner & Calendar**: A visual drag-and-drop calendar supporting multi-network scheduling across Instagram, Facebook, LinkedIn, TikTok, X, YouTube, and Google Business Profile. Includes a single composer with network-specific customization tabs, best-times-to-post engagement heatmaps, Instagram grid preview simulation, and platform-specific format adapters (Instagram Reels/Stories/Carousels, LinkedIn multi-page PDF documents, YouTube video privacy/tags).
3. **External Client Approvals**: Shareable, tokenless, HMAC-SHA256 signed review links (`/r/:batchId?exp=...&sig=...`) with nonce-based invalidation. External stakeholders can inspect exact post mocks, leave inline notes, reject, or approve content without requiring an internal ERP login. Approved posts lock with a cryptographic SHA-256 fingerprint.
4. **Evergreen Autolists**: Continuous recycling queues for evergreen content with time slot matrices, FIFO and permutation shuffle traversal, and a 90-minute collision window preventing evergreen posts from clumping against high-priority campaign announcements.
5. **Campaign Management & SmartLinks (Bio Links)**: Campaign budgeting and UTM generation paired with a drag-and-drop SmartLink page builder (`/b/:slug`) featuring custom buttons and a mirrored Shoppable Instagram Grid that permanently stores and routes media to product landing pages.
6. **Unified Social Inbox & DM Automation**: A centralized stream for comments, reviews, and DMs with saved canned responses. Automated keyword flows (ManyChat-style) send instant lead magnets and SmartLinks within the Meta 24-hour window, with 1-click conversion from DM conversation into a Sales CRM Lead.
7. **Inbound Lead Gen & Closed-Loop CRM Bridge**: Ingestion for custom web forms and Meta/Google Lead Ads webhooks. Emits `marketing.lead.captured` domain events that the `crm` module consumes to idempotently match/create `Lead` records, apply the non-destructive `fillEmptyFields` pattern, and append full UTM attribution to the Activity Timeline.
8. **First-Party Tracking Pixel & Ad Analytics**: An ultra-lightweight client script (`pixel.js` < 2.2 KB) and high-throughput ingestion endpoint (`/api/marketing/collect`) with bot filtering, cookieless GDPR fallback, and normalized cross-channel paid ad performance sync (Meta Ads, Google Ads, TikTok Ads).

## User Stories

### Brand Setup, Connections & Multi-Tenancy
1. As an agency account director, I want to create separate Brand profiles for each of my clients under my company, so that client assets, calendars, and social accounts never mix.
2. As a brand manager, I want to connect our company's Instagram, Facebook, LinkedIn, TikTok, X, YouTube, and Google Business Profile accounts via OAuth 2.0, so that our team can manage all channels from one place.
3. As a platform administrator, I want social OAuth tokens to be encrypted at rest using AES-256-GCM, so that client credentials remain secure against database compromise.
4. As an agency manager, I want a background monitor to alert me 7 days before a client's OAuth token expires, so that scheduled posts never silently fail due to revoked credentials.
5. As an agency staff member, I want to switch between client brands in the UI with a single click, so that managing multiple accounts has zero context-switching friction.

### Content Creation, Scheduling & Calendar
6. As a content creator, I want a unified visual drag-and-drop calendar (month, week, and day views), so that I can see and organize our entire social media schedule at a glance.
7. As a social media manager, I want a best-times-to-post heatmap rendered across the calendar, so that I can schedule posts during peak follower engagement hours.
8. As a copywriter, I want a single composer where I can write a core post and customize tabs for character limits, mentions, and hashtags per platform simultaneously.
9. As an Instagram marketer, I want direct publishing support for Single Images, Carousels (up to 10 slides), Reels, and Stories with first-comment hashtag scheduling and cover frame selection.
10. As a B2B marketer, I want to upload and schedule multi-page PDF documents to LinkedIn, so that they render as native swipeable slide decks in the feed.
11. As a video creator, I want to schedule YouTube videos with custom titles, descriptions, playlists, tags, and automated privacy transitions from private to public upon publish.
12. As a local business owner, I want to schedule Google Business Profile updates, events, and coupon offers with custom CTA buttons.
13. As an Instagram manager, I want a visual feed preview tool, so that I can verify how upcoming scheduled posts will align with our existing 9-grid aesthetic before publishing.
14. As a creator, I want to use an AI writing assistant directly inside the composer, so that I can generate platform-tailored hooks, captions, tone variations, and WCAG-compliant image alt-text.

### Client Approvals & Governance
15. As an agency copywriter, I want to draft a batch of posts and submit them for review, so that content is checked before going live.
16. As an agency lead, I want to generate an HMAC-signed shareable review link, so that external client stakeholders can inspect draft posts without needing an ERP login.
17. As an external client, I want to open the review link on my phone, preview exact post mocks across platforms, leave feedback notes on specific posts, and click "Approve" with one tap.
18. As an agency director, I want the system to record an immutable cryptographic SHA-256 fingerprint upon client approval, so that approved content cannot be modified without re-approval.
19. As a project manager, I want any post edit to automatically rotate the batch's security nonce and invalidate outdated review links, preventing stale approvals.

### Evergreen Autolists & Content Recycling
20. As a content marketer, I want to create Autolists (content buckets) assigned to specific recurring weekly time slots, so that evergreen tips and product highlights recycle automatically.
21. As a content marketer, I want to choose between FIFO queue traversal and permutation shuffle, so that every post in a bucket is published once before any post repeats.
22. As a social media manager, I want the system to enforce a 90-minute collision buffer between evergreen slots and one-off campaign posts, so that our social profiles never spam audiences.
23. As a creator, I want to bulk import scheduled posts into an autolist via a formatted CSV spreadsheet.
24. As a podcaster or blogger, I want to connect an RSS feed to an autolist, so that new podcast episodes and blog posts automatically enter our drafting and scheduling queue.

### Unified Social Inbox & DM Automation
25. As a community manager, I want a centralized inbox aggregating direct messages, post comments, and Google reviews across all connected networks in real-time.
26. As a customer support rep, I want to reply to Instagram DMs, Facebook messages, and LinkedIn comments directly from the ERP inbox without opening native apps.
27. As a support rep, I want a library of saved canned responses, so that I can insert pre-written answers to common FAQs with one click.
28. As an inbox manager, I want to track conversation status (`UNREAD`, `PENDING`, `RESOLVED`) and assign threads to specific team members.
29. As a marketer, I want to configure keyword-triggered DM automation flows (e.g., when a user comments "GUIDE", auto-DM them a link), so that lead magnets are delivered instantly.
30. As a business owner, I want the system to enforce Meta's 24-hour messaging window and rate limits, so that our account is never penalized or banned for spam.
31. As a salesperson viewing an active social DM thread, I want a 1-click "Convert to CRM Lead" button that creates a `Lead` in `crm` with the conversation history attached to its Activity Timeline.

### Campaigns, SmartLinks & Ad Performance
32. As a marketing manager, I want to create Campaigns with budgets, start/end dates, target audience segments, and UTM tracking links, so that all social and ad initiatives are grouped.
33. As an Instagram creator, I want to build branded SmartLinks (Link-in-Bio pages at `/b/:slug` or custom CNAME domains) with drag-and-drop button links, social trays, and profile cards.
34. As an e-commerce brand, I want a Shoppable Instagram Grid widget on our Bio page that mirrors our Instagram posts and links each photo directly to a product checkout page.
35. As a marketing analyst, I want to connect Meta Ads, Google Ads, and TikTok Ads accounts to view unified ad spend, impressions, clicks, CPC, CPM, and ROAS alongside organic metrics.
36. As a growth marketer, I want to track link clicks, unique visitors, and conversion locations across all SmartLinks in real-time.

### Inbound Lead Gen & CRM Bridge
37. As a marketer, I want to build custom web lead capture forms and embed them on our website, so that visitors can submit inquiries.
38. As a digital advertiser, I want Meta Lead Ads and Google Lead Ads submissions to ingest via webhooks automatically in real-time.
39. As a sales rep, I want incoming marketing leads to automatically appear as `Lead` records in the CRM with full UTM source, medium, and campaign attribution in their Activity Timeline.
40. As a CRM administrator, I want public lead submissions to use the non-destructive `fillEmptyFields` pattern, so that existing verified customer data is never overwritten by unauthenticated forms.
41. As an email marketer, I want to configure automated drip email nurture sequences triggered when a lead is captured, guiding prospects toward sales qualification.

### First-Party Web Tracking & Automated Reports
42. As a growth engineer, I want a lightweight first-party tracking pixel script (`pixel.js` < 2.2 KB) to embed on our website for tracking pageviews, referral sources, and conversion funnels.
43. As a data privacy officer, I want the tracking pixel to support Google Consent Mode v2 and cookieless daily rotating hashes when consent is denied, ensuring strict GDPR compliance.
44. As an agency lead, I want to generate pixel-perfect white-labeled PDF reports with our agency/client logos and brand colors for monthly client reviews.
45. As an enterprise consultant, I want to export monthly performance presentations as editable Microsoft PowerPoint (.pptx) files with native Office charts.
46. As an agency manager, I want to schedule automated monthly report emails to clients on the 1st of every month.

## Implementation Decisions

### 1. Module Structure & Boundaries
- **Module Name**: `marketing`
- **Tier**: `core`
- **Dependencies**: `dependsOn: ['crm', 'parties']`
- **Location**: `backend/src/modules/marketing`
- **Tenancy**: All entities scoped under `companyId` (and secondarily `brandId`) adhering to `npm run check:tenancy` and `npm run check:modules`.
- **Decoupled Event Bus**: Emits domain events (`marketing.lead.captured`, `marketing.lead.qualified`, `marketing.campaign.created`) via `DomainEvents` without creating circular dependencies.

### 2. Relational Database Schema (Prisma)
- `MarketingBrand`: Client workspace container (`id`, `companyId`, `name`, `slug`, `timezone`, `customDomain`, `logoUrl`, `brandColors`, `storageQuotaMb`).
- `BrandMember`: Agency staff role assignment (`brandId`, `userId`, `role: 'lead' | 'editor' | 'viewer'`).
- `SocialAccount`: Connected channel (`brandId`, `platform`, `platformAccountId`, `accountName`, `encryptedTokens`, `iv`, `authTag`, `tokenExpiresAt`, `healthStatus`).
- `MarketingJob`: Postgres queue record (`companyId`, `type`, `payload`, `scheduledAt`, `status`, `attempts`, `lastError`).
- `ScheduledPost`: Drafted/scheduled content (`brandId`, `socialAccountId`, `content`, `mediaUrls`, `scheduledAt`, `status`, `approvalStatus`, `payloadHash`, `platformConfig`).
- `ApprovalBatch`: Group of posts for external client sign-off (`brandId`, `name`, `securityNonce`, `expiresAt`, `status`).
- `ApprovalReceipt`: Immutable legal record of client sign-off (`postId`, `payloadHash`, `approverName`, `clientIp`, `approvedAt`).
- `Autolist` & `AutolistSlot`: Evergreen recycling queue buckets and recurring day/time schedules.
- `SocialConversation` & `SocialMessage`: Multi-network inbox threads with 24-hour window tracking (`lastInboundAt`, `windowExpiresAt`, `status: UNREAD | PENDING | RESOLVED`).
- `DmAutomationFlow`: Keyword matching rules (`EXACT | REGEX | FUZZY`), response templates, and rate limits.
- `LeadCaptureForm` & `LeadSubmission`: Inbound form schemas, honeypots, and submission payloads.
- `SmartLink`: Bio landing page layout with JSON widget array (`profile`, `buttons`, `shoppable_grid`, `social_tray`).
- `NormalizedAdCampaign` & `NormalizedAdMetricDaily`: Cross-platform ad spend, impressions, clicks, and ROAS.
- `TrackingSite` & `PageViewEvent`: First-party analytics domains, visitors, and pageview beacons.

### 3. Queue & Asynchronous Worker Architecture
- **Adapter Interface**: `IJobQueue` port with `PostgresJobQueueService` implementation using Prisma and `SELECT ... FOR UPDATE SKIP LOCKED` with partial index on `"MarketingJob"("scheduledAt") WHERE status = 'PENDING'`.
- **Media Ingest**: Direct browser-to-cloud object storage uploads via pre-signed URLs. Instagram media mirrored to permanent S3/R2 storage upon account sync to prevent CDN expiration.
- **Transcoding Normalization**: FFmpeg pipeline enforcing Constant Frame Rate (CFR), YUV420p chroma, and `movflags +faststart` for Meta crawlers.

### 4. Client Approvals Architecture
- **HMAC Signed URLs**: Link format `/r/:batchId?exp=...&sig=...` generated using `HMAC-SHA256(batchId + exp + scope + securityNonce, SECRET)`.
- **Stateless External Review**: Client reviews post layout, leaves inline comments, and grants approval without an ERP account.
- **Locking & Non-Repudiation**: On approval, `payloadHash` is stored, post status changes to `SCHEDULED`, and editing locks unless re-submitted.

### 5. CRM Handoff & Attribution Bridge
- Ingests Meta/Google Lead Ads and web forms at `@Public()` webhook endpoints.
- Emits `marketing.lead.captured`.
- CRM listener executes:
  1. Case-insensitive email/phone query against `Lead`.
  2. Creates new `Lead` or applies non-destructive `fillEmptyFields`.
  3. Inserts `LeadSubmission` record.
  4. Logs `Activity` timeline entry with full UTM source/medium/campaign attribution.

## Testing Decisions

### Seam: HTTP Integration Tests
- **Highest Seam**: Full HTTP integration test suite in `backend/test/marketing.spec.ts` using `createTestApp` and `resetDatabase` against a real PostgreSQL test database.
- **External Behavior Only**: Test end-to-end request/response contracts, multi-tenant data isolation across companies and brands, and database state.

### Key Test Scenarios:
1. **Brand Multi-Tenancy**: Creating Brand profiles, role assignments, and verifying that Company A / Brand 1 can never access Brand 2's social accounts or scheduled posts.
2. **Encrypted Vault**: Storing OAuth tokens, ensuring database fields contain cipher text, and decrypting tokens in memory.
3. **Queue & Scheduling**: Enqueuing scheduled posts, processing jobs via `FOR UPDATE SKIP LOCKED`, and handling failed retry backoffs.
4. **Approval Workflow**: Generating HMAC links, validating signature verification, rejecting expired/tampered URLs, rotating nonces upon post edits, and recording immutable approval receipts.
5. **Autolist Recycling**: Cycling posts through FIFO and permutation shuffle, verifying loop counters, and enforcing the 90-minute collision avoidance window.
6. **Unified Inbox**: Webhook signature verification (`X-Hub-Signature-256`), deduplication of network retries, and updating conversation status (`UNREAD` $\rightarrow$ `PENDING` $\rightarrow$ `RESOLVED`).
7. **CRM Lead Handoff**: Submitting a public form, verifying emission of `marketing.lead.captured`, verifying `Lead` creation in CRM, and asserting non-destructive field updating and Activity Timeline logging.
8. **Tracking Collector**: Submitting beacon payloads to `/api/marketing/collect`, filtering bot user agents, and verifying pageview aggregation.

## Out of Scope

- **Direct In-App Ad Campaign Creation / Bid Adjustment**: Modifying active ad bids and launching new ad sets via Meta/Google Marketing APIs directly inside the ERP is deferred. The module provides unified ad performance reporting, spend tracking, and ad lead webhook ingestion.
- **Live Video Streaming Studio**: In-browser multi-host live streaming (e.g. StreamYard style) is out of scope.
- **Custom Native Mobile Push Server**: Native mobile push notifications are deferred in favor of in-app notification records and email dispatches.
- **Direct Video Transcoding on the Application Process**: Running heavy 4K CPU video transcoding directly inside the NestJS process is ruled out; transcoding is handled via background worker containers and cloud storage pipelines.

## Further Notes

- The complete research fact sheets, API scope matrices, and architecture analyses are archived in `.scratch/marketing-automation/research/` and recorded on `.scratch/marketing-automation/map.md`.
- Conformance checks (`npm run check:modules`, `npm run check:tenancy`, and `npm run check:conformance`) must pass at every step of implementation.
