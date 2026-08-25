# 05 — Web-form & webhook capture

**What to build:** A company publishes a customizable web form, or hands a third-party tool a
webhook URL, and either one lands submissions as Lead rows on the board through one public,
token-addressed endpoint — with public-door safety (rate limiting, size caps, field
allowlisting) built in from the start, not added later.

**Blocked by:** 01 (Board organization — a captured lead needs a source/group to default into),
02 (Custom lead fields — a form's field list must be able to offer them).

**Status:** ready-for-agent

- [ ] `CaptureSource` (`kind: 'form' | 'webhook'`, `token`, `enabled`, `config`,
      `defaultSourceId`/`defaultGroupId`/`defaultAssignedToUserId`, `submissionCount`,
      `lastSubmissionAt`) can be created, its token rotated, and paused/resumed without losing
      configuration or history.
- [ ] A single `@Public() POST /api/crm/capture/:token` accepts both kinds, resolves the source
      via `withoutCompanyScope`, and writes the Lead via `runInCompany` — mirroring identity
      sign-up's existing pattern.
- [ ] A form-kind source's `config` lists which fields it asks for (built-in and custom), their
      order, and which are required; a webhook-kind source's `config` maps inbound keys to Lead
      fields.
- [ ] A submission naming a field the source's `config` does not list is refused, not silently
      stored.
- [ ] A disabled source, an unknown token, and a rotated-away token all answer identically, so
      the endpoint cannot be used to enumerate anything.
- [ ] The endpoint enforces a body size cap and a per-token rate limit, refusing with `429` when
      exceeded (in-process state, documented as a single-node limitation).
- [ ] A public `GET /api/crm/capture/:token/form` returns the field list and nothing else about
      the company; a published form page renders it, submits to the capture endpoint, and shows
      the configured thank-you message or redirect.
- [ ] The form builder offers an `<iframe>` embed snippet.
- [ ] A captured lead's source, group, and assignee default to the `CaptureSource`'s configured
      defaults; `submissionCount` and `lastSubmissionAt` advance on every accepted submission.
- [ ] Tenant isolation holds: a token from one company never produces a row in another.
