import { LeadsService } from '../../src/modules/crm/leads.service';
import type { CrmLeadIntake } from '../../src/modules/crm';

/**
 * The real `CrmLeadIntake`, over whatever Prisma double a mock-level spec already has.
 *
 * Marketing no longer writes `Lead`, `LeadSubmission` or `Activity` itself, so a spec that
 * exercises the lead handoff needs something on the other side of the seam. Binding the real
 * `LeadsService` rather than a hand-written stub keeps the ADR 0012 non-destructive fill under
 * test where it now lives — a stub here would let the invariant rot on the CRM side while the
 * marketing tests went on passing.
 *
 * The remaining constructor dependencies are `undefined` on purpose: the four intake methods
 * touch `this.prisma` and nothing else, and a spec that reaches past them into lead
 * qualification would fail loudly rather than quietly using a fake.
 */
export function crmIntakeOver(prisma: unknown): CrmLeadIntake {
  const absent = undefined as never;
  return new LeadsService(
    prisma as never,
    absent,
    absent,
    absent,
    absent,
    absent,
    absent,
  ) as unknown as CrmLeadIntake;
}
