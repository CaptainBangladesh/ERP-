# 02 — Lead artifacts: real file storage + stored survey submissions

**What to build:** The two "an artifact attaches to the lead" capabilities, each completed from
the database through to a find-it tab in the workspace, so that files and survey answers are real
and land in the Timeline.

**Real file storage.** A stored attachment becomes a usable file, not just a name. Introduce a
small `platform/storage` seam — a `StorageProvider` (`put`/`get`/`remove`) with a
local-filesystem implementation for development, so the concrete store is swappable without
touching `crm` (mirroring how `platform/upload` isolates multipart validation). Uploading a file
to a lead becomes a validated multipart upload (as lead-imports already does) with an
attachments-appropriate size cap and type allowlist, persisted through the provider so
`LeadAttachment.storageKey` holds a real key. Downloading an attachment streams the exact bytes
with the stored content-type; deleting an attachment also removes the stored object. Every upload
logs a file-attach Audit event so the Timeline stays complete. In the workspace, a **Files** tab
lists every attachment with type, size and date, accepts drag-and-drop or file-picker upload,
lets a salesperson download/open a stored file, and shows a thumbnail for image attachments.
Contract: add `LEAD_PATHS.fileDownload`; the upload body moves from JSON to multipart;
`LeadAttachmentResponse` is unchanged on the way out.

**Stored survey submissions — append, not drop.** A **Survey submission** is one capture-form
response tied to a lead — its raw answers and the subset mapped onto lead fields — and a lead may
accumulate several. A new company-owned `LeadSubmission` stores each: `leadId`, optional
`captureSourceId`, a `formName` snapshot, `rawPayload` (every answer, always stored in full),
`mappedValues` (the mapped subset), `submittedAt`. The existing public, unauthenticated
`submitCapture` is extended: after resolving the mapped values it finds an existing lead by
email/phone/name as today, but instead of dropping a match it **attaches a `LeadSubmission` to
the matched lead**, logs a `📝 Survey response received` Audit event, and — because the endpoint
is public — conservatively fills only **empty** built-in and custom fields, **never overwriting a
value the lead already has**, so a forged submission cannot poison known data. No duplicate lead
is created on a match; when no lead matches, a lead is created as today and the submission
attached to it. A new authenticated read path (`LEAD_SUBMISSION_PATHS.byLead(id)`) lists a lead's
submissions. In the workspace, a **Survey** tab lists each submission with form name and time,
expandable to the full question-and-answer, distinguishing mapped answers from unmapped ones, and
lets a salesperson **promote** an unmapped answer into a custom field (reusing the existing
`LeadFieldDefinition` create + `PATCH /crm/leads/:id` customValues flow — no new endpoint).

Map Google-form questions by stable item ID, not question title.

**Blocked by:** 01 — the Files and Survey tabs live in the workspace shell it builds.

**Status:** done

- [x] `POST /crm/leads/:id/files` (multipart) validates size/type, stores real bytes via `StorageProvider`, and logs the file-attach Audit event; `GET /crm/leads/:id/files/:fileId/download` returns those exact bytes with the stored content-type; delete removes the stored object.
- [x] Both file endpoints refuse a lead in another company with the standard not-found.
- [x] The Files tab lists attachments with type/size/date, uploads by drag-and-drop or picker, downloads/opens a real file, and thumbnails image attachments.
- [x] `POST /api/public/capture/:token` with a payload matching an existing lead persists a `LeadSubmission` on that lead, logs the survey Audit event, fills an empty field but leaves a non-empty field untouched, creates **no** duplicate lead, and retains an unmapped answer in the raw payload.
- [x] A capture payload with no match creates the lead as today and attaches the submission to it.
- [x] `LEAD_SUBMISSION_PATHS.byLead(id)` lists a lead's submissions; the Survey tab shows each submission's full Q&A, distinguishes mapped from unmapped, and can promote an unmapped answer to a custom field via the existing field-create + customValues flow.
- [x] `LeadSubmission` (and any new storage-backed table) is classified in `platform/tenancy/company-owned.ts`; contract adds `LEAD_PATHS.fileDownload`, `LEAD_SUBMISSION_PATHS`, and submission summary/list types, and moves file upload to multipart.
- [x] Backend behaviour is verified through the crm HTTP surface (prior art: the capture webhook issue and the crm controller/service specs); the Files and Survey tabs are covered by the workspace's frontend tests against a mocked API.
