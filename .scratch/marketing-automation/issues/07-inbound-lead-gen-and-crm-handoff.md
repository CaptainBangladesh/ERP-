# 07 — Inbound Lead Gen and CRM Handoff

Type: task
Status: open
Blocked by: 01, 06

## Question

How should inbound leads captured via web forms, ad platform webhooks, and email nurture sequences be qualified and handed off to Sales CRM Leads?

### Requirements
1. Define models:
   - `LeadCaptureForm` (companyId, brandId, name, schemaFields, embedCode, submitCount).
   - `LeadSubmission` (formId, rawPayload, utmSource, utmMedium, utmCampaign).
   - `NurtureSequence` (name, triggerEvent, steps: delay + email template).
2. Create public submission endpoint `POST /api/marketing/forms/:formId/submit`.
3. Create webhook ingest endpoint `POST /api/marketing/webhooks/ads/:platform` for Facebook/Google lead ads.
4. Emit domain event `marketing.lead.captured` containing mapped contact fields and UTM parameters.
5. Create an event listener or direct CRM bridge service that creates a new `Lead` in `crm` with source and timeline entry.
