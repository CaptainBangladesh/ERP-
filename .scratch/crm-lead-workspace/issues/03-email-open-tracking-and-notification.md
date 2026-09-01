# 03 — 1:1 email-open tracking + notification

**What to build:** When a salesperson emails a lead, they learn whether it was probably read, so
"follow up with the ones who opened it" becomes something they can do — while always presenting
an **Email open** as likelihood, never certainty.

A new company-owned model records each 1:1 send and its opens — `leadId`, the `Activity` it
produced, `sentByUserId`, `subject`, a unique `openToken`, `openedAt`, `openCount` — the same
shape `CampaignRecipient` already uses for campaign opens. `sendOneOnOneEmail` embeds a tracking
pixel referencing the token before sending and writes the record. A public, unauthenticated pixel
endpoint (contract mirroring `CAMPAIGN_PATHS.publicOpenPixel`, under `LEAD_EMAIL_PATHS`) returns a
1×1 GIF and increments `openCount`. **On the first open only**, it sets `openedAt`, creates a
`Notification` for `sentByUserId`, and logs a `📬 Email opened` Audit event on the lead;
subsequent opens only increment the count — so repeated Apple-Mail-Privacy-Protection pre-fetches
never become notification noise. The email open then appears in the lead's Timeline with its open
count, phrased as *probably seen* rather than confirmed.

Contract: add the lead email-open public pixel path and a `LeadEmailSendSummary` (open-state)
type.

**Blocked by:** 01 — the `📬` email-open entry and its "probably seen" open count render in the
workspace Activity feed it builds.

**Status:** done

- [x] `POST /crm/leads/:id/send-email` records a send carrying a unique `openToken` and embeds the tracking pixel referencing it.
- [x] Hitting the public pixel endpoint once returns a 1×1 GIF, sets `openedAt`, increments `openCount` to 1, creates exactly one `Notification` for the sender, and logs one `📬 Email opened` Audit event on the lead.
- [x] Hitting the pixel again increments `openCount` but creates no second Notification and no second Audit event.
- [x] The email-open appears in the Activity feed with its open count, always phrased as likelihood ("probably seen"), never as confirmed read.
- [x] The send-record model is classified in `platform/tenancy/company-owned.ts`; the contract adds the public pixel path and the open-state summary type.
- [x] Backend behaviour is verified through the crm HTTP surface (prior art: the campaign open-tracking tests); the feed rendering is covered by the workspace's frontend tests against a mocked API.
