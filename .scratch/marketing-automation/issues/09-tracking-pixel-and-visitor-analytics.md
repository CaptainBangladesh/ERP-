# 09 — Tracking Pixel and Visitor Analytics

Type: task
Status: open
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
