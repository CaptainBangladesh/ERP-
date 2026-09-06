# 08 — Unified Social Inbox and DM Flows

Type: task
Status: open
Blocked by: 02, 07

## Question

How should real-time comments, direct messages (DMs), and automated keyword flows be ingested, managed, and converted to CRM leads?

### Requirements
1. Define models:
   - `SocialMessage` (brandId, socialAccountId, conversationId, senderId, senderName, content, direction: 'inbound'|'outbound', status: 'unread'|'pending'|'resolved').
   - `DmAutomationFlow` (triggerKeyword, responseTemplate, leadMagnetUrl).
2. Set up incoming webhook handler for Meta/Instagram Messenger and X DMs.
3. Automatically evaluate incoming message against `DmAutomationFlow` keywords to reply with links/lead magnets.
4. Provide a "Convert to CRM Lead" action that creates a `Lead` in `crm` with the conversation history attached to its Activity Timeline.
