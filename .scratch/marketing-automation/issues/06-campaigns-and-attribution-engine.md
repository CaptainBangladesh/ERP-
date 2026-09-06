# 06 — Campaigns and Attribution Engine

Type: task
Status: open
Blocked by: 01

## Question

How should marketing campaigns, UTM tracking links, SmartLinks (Link-in-Bio), and cross-network ad metrics be structured?

### Requirements
1. Define Prisma models:
   - `MarketingCampaign` (companyId, brandId, name, budget, startDate, endDate, status).
   - `SmartLink` (brandId, slug, title, bio, theme, buttonLinks, shoppableGrid).
   - `AdAccountSync` (brandId, platform: 'meta'|'google'|'tiktok', spend, impressions, clicks, cpc, roas).
2. Create public route `GET /b/:slug` for serving the rendered SmartLink Bio page with click analytics.
3. Build UTM link builder utility and endpoints to generate trackable campaign links.
