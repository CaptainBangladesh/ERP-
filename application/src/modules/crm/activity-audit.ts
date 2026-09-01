/**
 * How the feed tells a system **Audit event** from a person-authored **Activity**.
 *
 * The backend stamps every audit event's notes with a leading emoji — status changed, file
 * attached, survey received, email opened. That set is a wire fact, so it lives in one place
 * rather than being re-typed at each screen that reads the activity endpoint: a second copy is
 * a second thing to remember to update the day a new audit kind gets an emoji, and copies drift.
 */

/** The emoji a system Audit event's notes begin with. Tolerant of a trailing variation selector. */
export const SYSTEM_AUDIT_PREFIX = /^(⚙️|⚙|📎|👤|🚀|📥|📝|📬)/u;

export function isSystemAudit(notes: string): boolean {
  return SYSTEM_AUDIT_PREFIX.test(notes);
}
