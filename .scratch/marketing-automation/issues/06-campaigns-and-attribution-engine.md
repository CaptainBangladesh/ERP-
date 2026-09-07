# 06 — Campaigns and Attribution Engine

Type: task
Status: closed
Blocked by: 01

## Answer

Resolved via implementation of the Campaigns, UTM attribution, SmartLinks (Link-in-Bio), and paid ad performance sync suite:
1. **Prisma Schema & Relational Models**:
   - Added `MarketingCampaign` (companyId, brandId, name, budget, spent, startDate, endDate, status, utmSource, utmMedium, utmCampaign, utmTerm, utmContent).
   - Added `SmartLink` (companyId, brandId, campaignId, slug, title, bio, theme, buttonLinks, shoppableGrid, socialLinks, viewCount, clickCount, clicks, isActive).
   - Added `AdAccountSync` (companyId, brandId, campaignId, platform: 'meta'|'google'|'tiktok', spend, impressions, clicks, cpc, roas, currency, syncedAt, metrics).
   - Generated migration `20260906160000_campaigns_and_attribution_engine`.
   - Classified all 3 models under `company-owned.ts` conforming to ADR 0003 and ADR 0009.
2. **Public Bio Route (`GET /b/:slug`) & Click Analytics**:
   - `PublicSmartLinksController` exposes `GET /b/:slug` with `@Public()` decorator serving a responsive HTML landing page styled with custom theme, buttons, and shoppable Instagram photo grid.
   - Atomic view tracking via `tenancy.withoutCompanyScope` incrementing `viewCount`.
   - Real-time click beaconing via `POST /b/:slug/clicks` logging button/item-specific clicks, timestamp, referer, and updating per-button CTR.
   - Redirect tracking via `GET /b/:slug/c/:buttonId` issuing 302 redirects with analytics.
3. **UTM Link Builder & Multi-Channel Distribution**:
   - `UtmService` normalizes URLs, validates parameters, and outputs standard Google Analytics UTM tags (`utm_source`, `utm_medium`, `utm_campaign`, `utm_term`, `utm_content`).
   - Automatically generates multi-channel distribution presets (Instagram Bio, Instagram Post, TikTok Bio, TikTok Ads, Meta Ads, Google Ads, LinkedIn, Newsletter, X).
   - Connected to campaigns via `POST /api/marketing/campaigns/utm/build` and campaign default tag inheritance.
4. **Cross-Network Paid Ad Performance Sync**:
   - `AdSyncService` connects Meta Ads, Google Ads, and TikTok Ads.
   - Computes CPC (`spend / clicks`) and ROAS, with deterministic sync simulator on `POST /api/marketing/ad-syncs/:id/sync`.
5. **Frontend Management Surface**:
   - Built `CampaignsManager.tsx` with KPI overview bar, campaign list & creation, UTM generator tool with 1-click copy, SmartLink manager with live mobile preview, and ad account sync cards.
   - Integrated into `MarketingPage.tsx` under new "🎯 Campaigns & Attribution" tab.
   - Passed `check:modules`, `check:tenancy`, `check:conformance`, `typecheck`, 12/12 backend unit tests in `campaigns-attribution.spec.ts`, and 10/10 frontend tests in `MarketingPage.test.tsx`.

## Question

How should marketing campaigns, UTM tracking links, SmartLinks (Link-in-Bio), and cross-network ad metrics be structured?

### Requirements
1. Define Prisma models:
   - `MarketingCampaign` (companyId, brandId, name, budget, startDate, endDate, status).
   - `SmartLink` (brandId, slug, title, bio, theme, buttonLinks, shoppableGrid).
   - `AdAccountSync` (brandId, platform: 'meta'|'google'|'tiktok', spend, impressions, clicks, cpc, roas).
2. Create public route `GET /b/:slug` for serving the rendered SmartLink Bio page with click analytics.
3. Build UTM link builder utility and endpoints to generate trackable campaign links.
