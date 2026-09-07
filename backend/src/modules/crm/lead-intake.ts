/**
 * What an inbound-marketing module may ask of the CRM.
 *
 * The map's headline decision for this effort was decoupled lead conversion, and the events
 * were duly emitted — but `marketing` went on writing `Lead`, `LeadSubmission` and `Activity`
 * with its own Prisma client, so the stated architecture and the code disagreed and only the
 * conformance pack noticed. ADR 0005 says a boundary is enforced mechanically rather than by
 * discipline; this file is that enforcement for the one seam that had a real caller behind it.
 *
 * Two properties are load-bearing:
 *
 * - **Nothing here names a Prisma type, a scoped client, or `companyApplied`.** The DTOs below
 *   are ordinary data. A consumer binds to this contract instead of to the CRM's schema, which
 *   is the whole difference between an export and a table read.
 * - **The ADR 0012 non-destructive fill lives on this side of the seam.** A public submission
 *   fills empty fields and never overwrites populated ones. That used to be a rule marketing
 *   was trusted to honour in its own code; it is the CRM's invariant now, so the next inbound
 *   channel inherits it rather than reimplementing it.
 *
 * The caller's identity arrives as a parameter rather than being hardcoded here, because the
 * CRM has no business knowing that a "Marketing Automation Engine" exists; it only needs to
 * record who said so.
 */

/**
 * An open transaction, carried across the seam without being described.
 *
 * Ticket 11 put the submission row, the counter and the lead write in one `$transaction`, and
 * routing the lead write through this surface must not quietly split them back apart — that
 * would reintroduce the orphaned-lead-in-the-pipeline bug, invisibly. So every method takes
 * the handle as its last parameter and uses it when given.
 *
 * Typed as an opaque object on purpose: naming Prisma's transaction client here would put the
 * CRM's schema back in the consumer's type graph, which is the coupling this file removes.
 */
export type CrmTransaction = object;

/** Who is recording this, for the timeline. */
export interface CrmIntakeActor {
  readonly userId: string;
  readonly name: string;
}

/** Contact data as an inbound channel found it — every field optional, because they are. */
export interface CrmInboundContact {
  readonly name?: string;
  readonly email?: string;
  readonly phone?: string;
  readonly organisationName?: string;
  readonly customFields?: Record<string, unknown>;
}

/** The lead, as much of it as a caller outside the CRM has any reason to see. */
export interface CrmIntakeLead {
  readonly id: string;
  readonly name: string;
  readonly email: string | null;
  readonly phone: string | null;
  readonly organisationName: string | null;
}

export interface CrmLeadIntakeResult {
  readonly leadId: string;
  /** True when this call created the lead, rather than matching an existing one. */
  readonly isNew: boolean;
  readonly lead: CrmIntakeLead;
}

export interface CrmInboundSubmission {
  readonly leadId: string;
  /** What the submission came from, in the words the CRM will show a salesperson. */
  readonly formName: string;
  readonly rawPayload?: Record<string, unknown>;
  readonly mappedFields?: Record<string, unknown>;
}

export interface CrmInboundActivity {
  readonly leadId: string;
  readonly notes: string;
}

export abstract class CrmLeadIntake {
  /**
   * Matches inbound contact data to an existing lead or creates one.
   *
   * Matching is on email (case-insensitively) or phone. An existing lead has its *empty*
   * fields filled from what arrived and its populated ones left alone — a stranger filling in
   * a web form cannot rewrite what a salesperson typed.
   */
  abstract resolveInboundLead(
    contact: CrmInboundContact,
    actor: CrmIntakeActor,
    tx?: CrmTransaction,
  ): Promise<CrmLeadIntakeResult>;

  /** Records the raw submission against the lead, for the submissions list. */
  abstract recordInboundSubmission(
    submission: CrmInboundSubmission,
    tx?: CrmTransaction,
  ): Promise<void>;

  /** Appends one note to the lead's timeline, attributed to the calling system. */
  abstract appendInboundActivity(
    activity: CrmInboundActivity,
    actor: CrmIntakeActor,
    tx?: CrmTransaction,
  ): Promise<void>;
}
