/**
 * The system **Audit events** the CRM records on a Lead's Timeline, in one place.
 *
 * The glossary keeps two things apart that share a feed: an **Activity** is person-authored, an
 * **Audit event** is system-recorded. They share the `Activity` table, so what actually tells
 * them apart on the wire is the leading emoji on the notes — which is a fact the frontend
 * already keeps in exactly one place (`activity-audit.ts`, `SYSTEM_AUDIT_PREFIX`).
 *
 * This is that file's counterpart. Without it the emoji set is spread across three services,
 * and the day a new audit kind is added the frontend's one-line change is matched by a hunt
 * through the backend for the other four spellings. The wording lives here so the two ends of
 * the wire can be read together.
 */

/**
 * Who an Audit event is by, when nobody is behind it.
 *
 * A status change has an actor; a tracking pixel fetched by a stranger's mail client does not,
 * and neither does a public form submission. Those are stamped with this rather than with
 * whichever salesperson happens to own the lead, so the feed never credits a person with
 * something the system did.
 */
export const SYSTEM_ACTOR_ID = '00000000-0000-0000-0000-000000000000';

/** The display name that goes with `SYSTEM_ACTOR_ID`. */
export const SYSTEM_ACTOR_NAME = 'System';

export const auditNotes = {
  statusChanged: (from: string, to: string) => `⚙️ Status updated from "${from}" to "${to}"`,

  leadAssigned: () => '👤 Lead assigned to representative',

  fileAttached: (filename: string) => `📎 Attached file: ${filename}`,

  surveyReceived: (formName: string) => `📝 Survey response received: ${formName}`,

  /**
   * An email open, always as likelihood.
   *
   * "Probably seen" is not politeness. A tracking pixel is a fetched image: image-blocking hides
   * a real read and Apple Mail Privacy Protection's pre-fetch invents one that never happened,
   * so the only honest thing the feed can say is that it looks to have been opened. The count is
   * shown for the same reason — three fetches are weak evidence of three readings, but they are
   * something a salesperson can weigh, which a bare "opened" is not.
   */
  emailOpened: (subject: string, openCount: number) =>
    `📬 Email opened${openCount > 1 ? ` ${openCount} times` : ''} (probably seen): ${subject}`,
} as const;
