/**
 * How the feed tells a system **Audit event** from a person-authored **Activity**.
 *
 * The prefix set, the note format and the parser all live in `@erp/shared` now, beside every
 * other shape that crosses the wire — the backend writes these strings and this screen reads
 * them back, which makes them a contract rather than a convention. This file stays as the CRM
 * frontend's door onto them so screens keep importing from one place.
 */
export {
  SYSTEM_AUDIT_PREFIX,
  isSystemAudit,
  describeAudit,
  describeSentEmail,
  type AuditEvent,
} from '@erp/shared';
