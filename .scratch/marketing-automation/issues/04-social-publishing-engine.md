# 04 — Social Publishing Engine

Type: task
Status: open
Blocked by: 02, 03

## Question

How should scheduled posts be dispatched across multiple external social networks with platform-specific formatting and autolist recycling?

### Requirements
1. Define `ScheduledPost` model (brandId, socialAccountId, content, mediaUrls, scheduledAt, status, failureReason, campaignId).
2. Define `Autolist` and `AutolistItem` models for evergreen recycling queues (re-queue frequency, active slots).
3. Create `SocialPublisherService` and network provider adapter interfaces:
   - `ISocialNetworkAdapter` (`publishPost()`, `getMetrics()`).
   - Adapters for Meta Graph API (Instagram/Facebook), LinkedIn REST API, and X API v2.
4. Integrate with `IJobQueue` to schedule publishing tasks and handle status updates.
