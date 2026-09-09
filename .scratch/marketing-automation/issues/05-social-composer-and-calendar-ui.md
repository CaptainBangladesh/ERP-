# 05 — Social Composer and Calendar UI

Type: prototype
Status: closed
Blocked by: 04

## Answer

Resolved via implementation of the visual social media publishing suite:
1. **`SocialCalendarPage`**:
   - Month view: complete multi-week calendar matrix with day drag-and-drop targets, date navigation (Prev, Next, Today), channel & status filter dropdowns, and quick-add actions.
   - Week view: 7-day hourly breakdown (08:00 to 20:00) with peak engagement ribbons ("🔥 Peak") and slot-level drag-and-drop rescheduling.
   - Day view: focused single-day schedule timeline with quick action triggers ("Publish Now", "Cancel", "IG Preview") and hourly engagement heatmap scores.
   - Drag-and-drop rescheduling: HTML5 draggable cards calling `PATCH /api/marketing/posts/:id` to dynamically update `scheduledAt` with instant feedback toast.
2. **`PostComposerModal`**:
   - Multi-account selector checkboxes across 10 connected platforms with Select All / Clear.
   - Platform customization tabs (Base Content, Instagram, LinkedIn, X, TikTok, YouTube, etc.) with character limit meters, hashtag counters, and platform format / aspect ratio guides.
   - First-comment input for Instagram and LinkedIn (hashtags & resource links).
   - Curated high-res brand asset library drawer + custom image/video URL input with thumbnail previews.
   - Best-times-to-post engagement heatmap preview with 1-click "⚡ Apply Optimal Time".
   - Multi-channel fan-out scheduling and drafting.
3. **`InstagramGridPreviewModal`**:
   - 3x3 Instagram profile feed simulator (9-grid & 12-grid) merging published posts and scheduled posts.
   - Profile header mockup (avatar, verified badge, stats, bio, story highlights tray).
   - Drag-and-drop tile re-ordering simulator to test aesthetic feed composition before publishing.
   - View mode switcher between "3x3 Grid" and realistic mobile feed frame.
4. **Integration & Routing**:
   - Registered `/marketing/calendar` in `manifest.ts`.
   - Added "🗓️ Calendar & Planner" tab to `MarketingPage`.
   - Wired `PostComposerModal` and `InstagramGridPreviewModal` into `PublishingManager`.
   - Passed `check:modules`, `check:tenancy`, `check:conformance`, `typecheck`, 9/9 tests in `MarketingPage.test.tsx`, and 4/4 tests in `SocialCalendar.test.tsx` (377/377 full app tests passing).

## Question

How should the visual drag-and-drop publishing calendar, unified multi-network composer, and preview simulator be structured in the frontend?

### Requirements
1. Prototype `SocialCalendarPage` featuring month, week, and day views with drag-and-drop rescheduling.
2. Build `PostComposerModal` with:
   - Multi-account selector checkboxes.
   - Network-specific customization tabs (character count, platform aspect ratio hints, first-comment input).
   - Media upload / asset selector.
   - Best-times-to-post engagement heatmap preview.
3. Instagram grid preview simulator.
