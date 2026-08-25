# 07 — Email campaigns

**What to build:** A sales manager sends a personalized campaign to a segment of the board,
watches it send in bounded batches with visible progress (no scheduler exists on this platform,
so sending is request-driven, never time-triggered), sees delivery counts and an open rate once
it's out, and every recipient can unsubscribe permanently with one click.

**Blocked by:** 06 (Mailbox connection, templates & 1-on-1 send — campaigns reuse the mailbox,
the template, and the tag renderer).

**Status:** complete

- [x] A campaign is built from a segment (a saved filter, one or more groups, or an explicit lead
      selection) and a template, and can be saved as a draft and returned to later.
- [x] Materializing a campaign builds one `CampaignRecipient` per deduplicated (by email
      address), non-unsubscribed, email-bearing lead; leads excluded for having no email or
      being unsubscribed are shown with their reason, not silently dropped from the count.
- [x] A batch-send endpoint sends one bounded batch of pending recipients per call and returns
      progress; calling it again resumes from whatever is still pending, never re-sending to a
      recipient already marked sent.
- [x] A campaign leaves `draft` exactly once; a sent or sending campaign refuses further edits.
- [x] Each successful send writes an `Activity` of type `email` against its lead.
- [x] `Unsubscribe` (`emailAddress`, `unsubscribedAt`, `campaignId`) has a `@Public()` endpoint;
      every campaign email embeds its link; an unsubscribed address is excluded from every
      future campaign's materialization.
- [x] A `@Public() GET /api/crm/e/:openToken.gif` returns a 1x1 transparent GIF and stamps
      `openedAt` (first open only) and increments `openCount` (every open) via
      `withoutCompanyScope`; the first open also writes one `Activity` against the lead.
- [x] A campaign's open rate (`opened / sent`) is computed on read, never stored.
- [x] Per-recipient open status is visible on the campaign screen.
- [x] Tenant isolation holds for `Campaign`, `CampaignRecipient`, and `Unsubscribe`, including
      the two public paths (open pixel, unsubscribe).
