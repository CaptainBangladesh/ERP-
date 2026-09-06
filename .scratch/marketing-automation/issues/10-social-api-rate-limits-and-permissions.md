# 10 — Social API Rate Limits, Permissions, and Webhooks

Type: research
Status: resolved

## Answer
Resolved via Research subagent. Fact sheet findings:
- **Meta (Instagram & Facebook)**:
  - Post-Jan 2025 modern scopes required: `instagram_business_content_publish`, `instagram_business_manage_messages`, `pages_manage_posts`, `pages_messaging`.
  - Publishing requires two-step container architecture (`POST /{ig-user-id}/media` -> poll status -> `POST /{ig-user-id}/media_publish`).
  - Strict publishing rate limit: 50 posts per 24 hours per professional account.
  - Webhooks use `X-Hub-Signature-256` HMAC-SHA256. Outbound DMs require user interaction within 24 hours (or `HUMAN_AGENT` message tag up to 7 days).
- **LinkedIn**:
  - Requires `w_organization_social` for Company Pages (author: `urn:li:organization:{id}`) vs `w_member_social` for personal profiles.
  - Document/PDF carousels require 3-step sequence: initialize upload (`/rest/documents?action=initializeUpload`), binary PUT to pre-signed S3, then publish post with document URN.
- **X (Twitter) v2**:
  - Uses OAuth 2.0 with PKCE (`tweet.write`, `dm.read`, `dm.write`, `offline.access`).
  - Webhooks (Account Activity API) require Enterprise tier; non-enterprise self-serve/pay-per-use requires polling `GET /2/dm_events`. Write limit: ~100 posts / 15-min window.

## Question

What are the exact OAuth 2.0 scopes, app review requirements, webhook expiration rules, and rate limits for Meta (Instagram/Facebook Graph API), LinkedIn REST API, and X API v2 needed for third-party multi-tenant publishing and DM automation?

### Focus Areas
1. **Meta (Instagram & Facebook)**:
   - Required scopes for publishing image/carousel/Reels/Stories (`instagram_content_publish`, `pages_manage_posts`, etc.).
   - Webhook subscription model for page comments and Instagram Messenger DMs.
   - Rate limit thresholds per user/page.
2. **LinkedIn**:
   - Community Management API vs Share on LinkedIn API (`w_member_social`, `w_organization_social`).
   - Multi-page document (PDF carousel) upload sequence.
3. **X (Twitter)**:
   - Free vs Basic vs Pro API tier limitations for automated tweets and DM webhooks.
