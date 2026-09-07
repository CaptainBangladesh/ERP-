# 09 — Tracking Pixel and Visitor Analytics

Type: task
Status: closed
Blocked by: 01

## Question

How should the first-party website tracking pixel and analytics ingestion endpoint be implemented?

### Requirements
1. Define models:
   - `TrackingSite` (brandId, domain, pixelKey).
   - `PageViewEvent` (trackingSiteId, visitorId, path, referrer, utmSource, utmMedium, utmCampaign, country, device, timestamp).
2. Serve an ultra-lightweight client script `GET /api/marketing/pixel.js`.
3. Ingest beacon events via `POST /api/marketing/collect` (CORS-enabled, returning HTTP 204 No Content).
4. Aggregate daily visitor, session, and pageview counts per Brand and Campaign.

## Resolution
1. Added `TrackingSite` and `PageViewEvent` models to `backend/prisma/schema.prisma` with migration `20260906190000_tracking_pixel_and_visitor_analytics`, registered in `company-owned.ts` and `marketing.manifest.ts`.
2. Created `TrackingService` (`backend/src/modules/marketing/tracking.service.ts`) serving an ultra-lightweight client snippet `<script src="/api/marketing/pixel.js" data-site="..." defer>` (< 2.2 KB), ingesting beacons with bot filtering, and aggregating daily traffic, top pages, referrers, UTM campaigns, and devices.
3. Implemented `TrackingController` and `PublicTrackingController` exposing `POST /api/marketing/collect` (CORS-enabled HTTP 204) and authenticated management & analytics overview endpoints.
4. Created `TrackingManager` frontend component integrated into `MarketingPage.tsx` under "📊 Tracking & Analytics" tab with interactive pixel snippet generator, live test beacon dispatcher, and real-time visitor metrics.
5. Added unit tests in `backend/test/tracking-analytics.spec.ts` (10/10 passed) and frontend tests in `application/src/modules/marketing/pages/MarketingPage.test.tsx` (13/13 passed). Passed `check:modules`, `check:tenancy`, and `typecheck`.

