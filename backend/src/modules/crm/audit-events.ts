/**
 * The system **Audit events** the CRM records on a Lead's Timeline.
 *
 * The strings themselves live in `@erp/shared` beside the request and response shapes, because
 * that is what they are: the backend writes them and the frontend reads them back to render an
 * email open as a card rather than as a line of text. Two copies of that format would be one
 * copy that goes wrong silently — a renamed prefix simply stops matching, and the feed quietly
 * shows a status change as somebody's note.
 *
 * This file re-exports them so `crm` imports its own vocabulary from one place, and so there is
 * somewhere to look when asking what the module records.
 */
export { SYSTEM_ACTOR_ID, SYSTEM_ACTOR_NAME, auditNotes } from '@erp/shared';
