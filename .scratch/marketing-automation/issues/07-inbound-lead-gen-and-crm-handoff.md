# 07 — Inbound Lead Gen and CRM Handoff

Type: task
Status: resolved
Blocked by: 01, 06

## Resolution
1. Defined `LeadCaptureForm`, `LeadCaptureSubmission`, and `NurtureSequence` models in `backend/prisma/schema.prisma` with migration `20260906170000_inbound_lead_gen_and_crm_handoff`. Registered models under company-owned tenancy and in `marketing.manifest.ts`.
2. Created public submission endpoint `POST /api/marketing/forms/:formId/submit` in `PublicFormsController` / `FormsService` with atomic counter increment, contact mapping, and UTM extraction.
3. Created public webhook ingest endpoint `POST /api/marketing/webhooks/ads/:platform` in `AdWebhooksController` supporting Meta (Facebook/Instagram) and Google Ads lead formats.
4. Implemented `CrmBridgeService` that idempotently creates or updates CRM `Lead` records via non-destructive `fillEmptyFields` pattern, logs Activity timeline entries with UTM attribution, creates CRM `LeadSubmission` records, and emits `marketing.lead.captured` on `DomainEvents`.
5. Built `NurtureSequencesService` for automated email drip sequences.
6. Created frontend `LeadGenManager.tsx` and integrated "🧲 Inbound & CRM" tab in `MarketingPage.tsx`.
7. Verified with 8/8 backend unit/integration tests (`inbound-lead-gen.spec.ts`), 11/11 frontend tests (`MarketingPage.test.tsx`), `check:modules`, `check:tenancy`, and clean typechecking across workspaces.

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
