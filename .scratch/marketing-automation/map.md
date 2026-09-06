# Map — Marketing Automation

Label: wayfinder:map

## Destination

A complete, enterprise-grade **Marketing Automation** module (`marketing`, Core/Growth tier, `dependsOn: ['crm', 'parties']`) delivering:
1. **Multi-Network Social Media Suite (Metricool-style)**: Visual drag-and-drop calendar, single multi-network composer (Instagram, Facebook, TikTok, LinkedIn, YouTube, X, Pinterest, Threads, Bluesky, Google Business Profile), platform-specific formatting, autolists/evergreen recycling queues, centralized social inbox for comments & DMs, and keyword-triggered DM automation flows.
2. **Campaign Management & Attribution**: Campaign budgeting, target audience segmentation, UTM link generation, SmartLinks (Link-in-Bio pages with shoppable grid mirrors), and cross-network paid ad performance sync (Meta, Google, TikTok Ads).
3. **Inbound Lead Generation & Nurturing**: Custom web forms, ad lead sync webhooks, drip email sequences, and automated lead scoring that emits `marketing.lead.captured` / `marketing.lead.qualified` to seamlessly create and promote `Lead` records in the `crm` module.
4. **Web Tracking & Analytics**: Proprietary JavaScript tracking pixel for real-time page views, visitor attribution, and campaign conversion reporting.
5. **Brand Multi-Tenancy & Governance**: Brand workspace isolation, AES-256 encrypted OAuth token vault, client review/approval links, and white-label automated PDF/PPT reporting.

Settled architecture decisions locked during chartering:
- **Dedicated Module Boundary**: Lives in `backend/src/modules/marketing`, preserving `crm`'s focus on sales pipelines and emitting decoupled domain events for lead conversion.
- **Postgres-Backed Queue with Swappable Adapter**: Uses an `IJobQueue` port implemented with Prisma + PostgreSQL `FOR UPDATE SKIP LOCKED` and partial indexes for zero new infrastructure dependencies, swappable for BullMQ/Redis if high scale requires it.
- **Direct Cloud Media Uploads**: Client uploads media directly to object storage via pre-signed URLs, preventing video/asset transcoding from exhausting application server memory.
- **Brand-Scoped Encrypted OAuth Vault**: Tokens for connected networks are encrypted at rest with AES-256 and scoped to Brands, allowing multiple team members to manage accounts safely.

## Notes

**This map carries execution, not just decisions** — overriding wayfinder's plan-only default, matching the precedent set by `crm-sales` and `reporting-analytics`.

- Module generation: `npm run new:module -- --name marketing --tier core --depends-on crm parties`
- Multi-tenancy & conformance: Must pass `npm run check:tenancy` and `npm run check:modules`.
- Skills to use during resolution:
  - `/research` for research tickets (API limits, OAuth nuances).
  - `/prototype` for visual surfaces (Calendar, Composer, Bio-link builder, Social Inbox).
  - `/domain-modeling` and `/grilling` for data model refinements.

## Decisions so far
- [Spec — Marketing Automation](spec.md) — (`Status: ready-for-agent`) consolidates all 10 core feature workflows, architecture decisions, research fact sheets, data models, and HTTP integration test seams into one comprehensive, implementable PRD.
- [10 — Social API rate limits & permissions](issues/10-social-api-rate-limits-and-permissions.md) — verified post-Jan 2025 Meta scopes (`instagram_business_*`), 50-post/day quota, container polling flow; LinkedIn PDF document URN upload sequence; X API v2 OAuth PKCE and polling fallback for non-enterprise DMs.



## Not yet specified

- **AI Social Media Assistant Fine-Tuning**: Hooking up the existing `@anthropic-ai/sdk` dependency to generate tailored hooks, alt-text, and platform-specific variations directly in the composer.
- **Competitor Benchmarking Scraper/APIs**: Public profile scraping vs. official graph APIs for tracking competitor follower growth and engagement cadence.
- **RSS Feed Ingest Worker**: Feed parser integration to auto-enqueue podcast and blog RSS items into scheduling queues.
- **Granular Canva & Adobe Express Embed SDKs**: Direct button integrations inside the media library modal to launch external graphic editor iframes.

## Out of scope

- **Native Audio/Video Transcoding Engine**: Transcoding 4K video directly on the NestJS backend host is ruled out; external platform media APIs and cloud upload pipelines handle encoding.
- **Direct Ad Campaign Creation/Bid Bidding API**: Modifying live ad bids and creating ad sets directly via Meta/Google Marketing API is ruled out for MVP; focus is unified cross-channel performance reporting, UTM tracking, and ad lead webhook ingestion.
