# 04 — Social Publishing Engine

Type: task
Status: closed
Blocked by: 02, 03

## Resolution

Implemented a complete, robust multi-network Social Publishing Engine with Evergreen Autolist recycling queues:
1. **Prisma Models & Migration**:
   - `ScheduledPost`: company-scoped, brand-scoped, social account-linked, status tracking (`DRAFT`, `SCHEDULED`, `PUBLISHING`, `PUBLISHED`, `FAILED`), failure reason, media URLs, campaign link, and external post IDs.
   - `Autolist` & `AutolistItem`: evergreen recycling buckets with configurable slots (`dayOfWeek`, `timeSlot`), repeat modes (`INFINITE`, `CYCLES_COUNT`), permutation shuffle toggle, collision buffers, and item cycle tracking.
   - Generated migration `20260906150000_social_publishing_engine` and registered models under `company-owned.ts` and manifest.
2. **Multi-Network Provider Adapters & Resolver**:
   - `ISocialNetworkAdapter` interface defining `publishPost(account, post)` and `getMetrics(account, externalPostId)`.
   - `MetaNetworkAdapter`: Instagram container flow (`/media` -> poll container status -> `/media_publish`) and Facebook feed publishing.
   - `LinkedInNetworkAdapter`: LinkedIn REST `/rest/posts` API with URN authors (`urn:li:organization:...` / `urn:li:person:...`) and media/document URN attachments.
   - `XNetworkAdapter`: X API v2 `/2/tweets` endpoint with media IDs and character limit validation.
   - `TikTokNetworkAdapter`: TikTok Content Posting API v2 with direct video/photo post endpoints and metrics retrieval.
   - `StubSocialNetworkAdapter`: deterministic in-memory adapter supporting configurable publish failure injection and metrics mock for test isolation.
   - `SocialAdapterResolver`: resolves adapter by provider enum, returning the stub in test/development environments without live third-party credentials.
3. **Services & Queue Handlers**:
   - `SocialPublisherService`: handles post scheduling (`schedulePost`), automated OAuth token decryption from AES-256 vault via `CryptoService`, enqueueing into `IJobQueue` (`publish_social_post`), immediate publishing (`publishNow`), metrics synchronization (`syncMetrics`), and status updates.
   - `AutolistsService`: manages autolists and items, handles active recurring slots, executes queue cycling (`cycle_autolist`), enforces 90-minute collision window avoidance against one-off campaign posts, and implements both FIFO and permutation shuffle traversal (Story 21: guaranteeing 100% of items run before repeats).
4. **Controllers & API Endpoints**:
   - `PostsController`: `POST /marketing/posts`, `GET /marketing/posts`, `GET /marketing/posts/:id`, `PATCH /marketing/posts/:id`, `DELETE /marketing/posts/:id`, `POST /marketing/posts/:id/publish-now`, `POST /marketing/posts/:id/sync-metrics`.
   - `AutolistsController`: CRUD for autolists, item management, and `POST /marketing/autolists/:id/cycle`.
5. **Frontend UI**:
   - `PublishingManager.tsx`: interactive UI with Scheduled Posts list, Post Composer modal, Evergreen Autolist buckets management, and direct "Cycle Now" trigger. Integrated into `MarketingPage.tsx` under a dedicated "Publishing & Autolists" tab.
6. **Testing & Conformance**:
   - Unit tests in `backend/test/social-publishing.spec.ts` (9/9 passed).
   - Frontend tests in `application/src/modules/marketing/pages/MarketingPage.test.tsx` (8/8 passed).
   - Passed `check:modules`, `check:tenancy`, `check:conformance`, and workspace `typecheck`.

## Question

How should scheduled posts be dispatched across multiple external social networks with platform-specific formatting and autolist recycling?

### Requirements
1. Define `ScheduledPost` model (brandId, socialAccountId, content, mediaUrls, scheduledAt, status, failureReason, campaignId).
2. Define `Autolist` and `AutolistItem` models for evergreen recycling queues (re-queue frequency, active slots).
3. Create `SocialPublisherService` and network provider adapter interfaces:
   - `ISocialNetworkAdapter` (`publishPost()`, `getMetrics()`).
   - Adapters for Meta Graph API (Instagram/Facebook), LinkedIn REST API, and X API v2.
4. Integrate with `IJobQueue` to schedule publishing tasks and handle status updates.
