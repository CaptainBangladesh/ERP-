import type { ListResponse } from '../../http/list.js';

/**
 * Marketing' wire contract — its paths, bodies, responses and refusals.
 *
 * Wire shapes only, as with every contract here. What a marketing *is* lives in
 * 'backend/src/modules/marketing', and what other modules may ask of it is that module's
 * public surface. Nothing outside the module reads its tables.
 *
 * Both workspaces bind to this file, so an API change breaks the build rather than the user's
 * screen.
 */

export const MARKETING_MODULE = 'marketing';

/** No leading slash — Nest composes controller prefixes. */
export const MARKETING_ROUTE = 'api/marketing';

export const MARKETING_PATHS = {
  marketings: `/${MARKETING_ROUTE}`,
  marketing: (id: string) => `/${MARKETING_ROUTE}/${id}`,
} as const;

/**
 * Active, or kept for the sake of history.
 *
 * 'inactive' is what deactivation produces — something nobody uses any more, whose past still
 * has to make sense. Nothing here is ever deleted.
 */
export const MARKETING_STATUSES = ['active', 'inactive'] as const;

export type MarketingStatus = (typeof MARKETING_STATUSES)[number];

/**
 * The fields a caller may sort, filter or search the list by.
 *
 * Named here rather than as string literals on either side: the backend's list declaration
 * and the frontend's table columns have to agree, so a rename should be a type error in both
 * workspaces rather than a list that quietly stops sorting.
 */
export const MARKETING_FIELDS = {
  name: 'name',
  status: 'status',
  createdAt: 'createdAt',
} as const;

export interface CreateMarketingRequest {
  name: string;
}

export interface UpdateMarketingRequest {
  name?: string;
  status?: MarketingStatus;
}

export interface MarketingSummary {
  id: string;
  name: string;
  status: MarketingStatus;
}

export type MarketingResponse = MarketingSummary;

export type MarketingListResponse = ListResponse<MarketingSummary>;

export const MARKETING_ERROR_CODES = {
  marketingNotFound: 'marketing_not_found',
} as const;
