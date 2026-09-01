# A public capture submission appends, and fills empty fields only

`POST /api/public/capture/:token` used to drop a submission whose details matched an existing
Lead, to avoid creating duplicates. The cost was that the second thing a lead told us was lost
and only the first survived. It now **appends**: a `LeadSubmission` is attached to the matched
Lead, a `📝` Audit event is logged, and the Lead's fields are topped up from the response.

The rule that is surprising unless you know why: the top-up writes **only fields that are empty**
— null, absent, an empty string, or an empty list — and **never overwrites a value the Lead
already has**. That looks over-cautious until you remember what this endpoint is. It is public
and unauthenticated, protected only by per-token rate limiting, and it matches a Lead by email,
phone or name. Anyone who knows a customer's email address can post as them. If a submission
could overwrite, a forged one could blank out or falsify a known Lead's phone number from the
outside, and nothing in the Timeline would look wrong. Filling a gap cannot destroy anything, so
filling gaps is all it does.

Consequences:

- **A correction cannot arrive by form.** A lead who submits a new phone number does not change
  the one on file; a person has to. That is the intended trade, and the raw answer is still on
  the submission for them to see.
- **The raw payload is always stored in full**, mapped or not, so an answer no field maps is kept
  rather than dropped. Promoting one into a custom field is an explicit action in the Survey tab,
  never automatic — auto-provisioning fields from a public endpoint would hand a stranger the
  ability to grow the schema.
- **`LeadSubmission.mappedFields` is keyed by the answer's key, not the field's** — `entry_104 →
  budget`, not `budget → '50k'`. The spec called it `mappedValues` and described it as the mapped
  subset, which reads naturally as field-keyed values; that shape cannot answer the question the
  Survey tab exists to ask. A webhook source maps `entry_104` onto `budget`, so a set of *field*
  names cannot say which answer was mapped, and every Google Form answer renders as unmapped. The
  values are not lost by the change — they are in `rawPayload` under the same key.
- **A shared-secret header on webhook capture sources is the recommended hardening** and is not
  built. If it lands, this rule could be relaxed for authenticated sources — but only for those.
