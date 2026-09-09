# 08 — Unified Social Inbox and DM Flows

Type: task
Status: resolved
Blocked by: 02, 07

## Answer

Shipped in commit `88aef1d` — `SocialMessage` and `DmAutomationFlow` models with migration
`20260906180000_unified_social_inbox_and_dm_flows`, `inbox.service.ts`, `dm-flows.service.ts`,
`social-inbox-webhooks.controller.ts`, and the `SocialInboxManager` frontend component. See the
corresponding entry in `map.md` for the full summary.

*(This file was left at `Status: open` when the work closed — corrected 2026-09-07 during the
audit. Note that `inbox.service.ts:462` writes the `crm`-owned `Activity` table directly, which
is one of the 16 conformance violations ticket 16 resolves.)*

## Question

How should real-time comments, direct messages (DMs), and automated keyword flows be ingested, managed, and converted to CRM leads?

### Requirements
1. Define models:
   - `SocialMessage` (brandId, socialAccountId, conversationId, senderId, senderName, content, direction: 'inbound'|'outbound', status: 'unread'|'pending'|'resolved').
   - `DmAutomationFlow` (triggerKeyword, responseTemplate, leadMagnetUrl).
2. Set up incoming webhook handler for Meta/Instagram Messenger and X DMs.
3. Automatically evaluate incoming message against `DmAutomationFlow` keywords to reply with links/lead magnets.
4. Provide a "Convert to CRM Lead" action that creates a `Lead` in `crm` with the conversation history attached to its Activity Timeline.
