import { useQuery } from '@tanstack/react-query';
import {
  LEAD_FIELD_PATHS,
  LEAD_GROUP_PATHS,
  LEAD_SOURCE_PATHS,
  LEAD_STATUSES,
  LEAD_STATUS_LABEL_DEFAULTS,
  LEAD_STATUS_LABEL_PATHS,
  type LeadFieldListResponse,
  type LeadFieldSummary,
  type LeadGroupListResponse,
  type LeadGroupSummary,
  type LeadSourceListResponse,
  type LeadSourceSummary,
  type LeadStatus,
  type LeadStatusLabelListResponse,
} from '@erp/shared';
import { api } from '../../api/client';

/**
 * The four lists that describe a company's own Leads board — its swimlanes, its channel
 * vocabulary, its captions for the fixed statuses, and the custom fields it has defined.
 *
 * All four used to be constants compiled into this bundle. They are rows now, so every screen
 * that draws a lead needs the same four reads, and each one arrives as a hook rather than as a
 * `useQuery` copied into four components: the query keys have to match for the cache to be
 * shared, and four hand-written copies of a key string is four chances for one screen to keep
 * showing a group somebody else just renamed.
 *
 * `LEAD_VOCABULARY_KEY` is what a screen invalidates after changing any of them.
 */
export const LEAD_VOCABULARY_KEY = ['crm', 'lead-vocabulary'] as const;

export function useLeadGroups(): { groups: LeadGroupSummary[]; isLoading: boolean } {
  const query = useQuery({
    queryKey: [...LEAD_VOCABULARY_KEY, 'groups'],
    queryFn: () => api.get<LeadGroupListResponse>(LEAD_GROUP_PATHS.leadGroups),
  });

  return { groups: query.data?.items ?? [], isLoading: query.isLoading };
}

export function useLeadSources(): { sources: LeadSourceSummary[]; isLoading: boolean } {
  const query = useQuery({
    queryKey: [...LEAD_VOCABULARY_KEY, 'sources'],
    queryFn: () => api.get<LeadSourceListResponse>(LEAD_SOURCE_PATHS.leadSources),
  });

  return { sources: query.data?.items ?? [], isLoading: query.isLoading };
}

export interface StatusLabel {
  label: string;
  color: string;
}

/**
 * What this company calls each status, and the colour it shows it in.
 *
 * Always all four, even before the response lands — the contract's defaults stand in — so no
 * screen has to render a status pill with no caption on it while a request is in flight.
 */
export function useLeadStatusLabels(): Record<LeadStatus, StatusLabel> & Record<string, StatusLabel> {
  const query = useQuery({
    queryKey: [...LEAD_VOCABULARY_KEY, 'status-labels'],
    queryFn: () => api.get<LeadStatusLabelListResponse>(LEAD_STATUS_LABEL_PATHS.labels),
  });

  const stored = new Map((query.data?.items ?? []).map((item) => [item.status, item]));

  return Object.fromEntries(
    LEAD_STATUSES.map((status) => [
      status,
      {
        label: stored.get(status)?.label ?? LEAD_STATUS_LABEL_DEFAULTS[status].label,
        color: stored.get(status)?.color ?? LEAD_STATUS_LABEL_DEFAULTS[status].color,
      },
    ]),
  ) as Record<LeadStatus, StatusLabel> & Record<string, StatusLabel>;
}

/**
 * Custom field definitions. `all` includes archived ones, because a lead may still hold values
 * captured under them and those values need a label to render beside; `active` is what a form
 * offers.
 */
export function useLeadFields(enabled = true): {
  all: LeadFieldSummary[];
  active: LeadFieldSummary[];
  isLoading: boolean;
} {
  const query = useQuery({
    queryKey: [...LEAD_VOCABULARY_KEY, 'fields'],
    queryFn: () => api.get<LeadFieldListResponse>(LEAD_FIELD_PATHS.leadFields),
    enabled,
  });

  const all = query.data?.items ?? [];
  return { all, active: all.filter((field) => field.archivedAt === null), isLoading: query.isLoading };
}
