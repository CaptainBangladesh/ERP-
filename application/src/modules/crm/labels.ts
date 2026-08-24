import type { LeadSource, LeadStatus } from '@erp/shared';

/**
 * Display text for a Lead's `source` and `status`, shared by the list and its detail panel so
 * the two screens never drift into showing a different word for the same wire value.
 */
export const LEAD_SOURCE_LABELS = {
  referral: 'Referral',
  inbound: 'Inbound',
  outbound: 'Outbound',
  event: 'Event',
  other: 'Other',
} as const satisfies Record<LeadSource, string>;

export const LEAD_STATUS_LABELS = {
  new: 'New',
  contacted: 'Contacted',
  qualified: 'Qualified',
  disqualified: 'Disqualified',
} as const satisfies Record<LeadStatus, string>;
