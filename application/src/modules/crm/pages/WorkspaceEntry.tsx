import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { LEAD_PATHS, listPath, type LeadListResponse } from '@erp/shared';
import { api } from '../../../api/client';
import { navigate } from '../../../app/location';
import { leadWorkspacePath } from './LeadWorkspace';

/**
 * What the "Workspace" menu item opens: the lead-working surface, not a screen of its own.
 *
 * There is one workspace, and it is the single-lead page — worklist down the left, activity in
 * the middle, next-step rail on the right. A person reaches it by clicking a lead, and now also
 * straight from the nav; both land in the same place. This entry holds no UI itself. It picks the
 * lead to open — the first in the worklist — and hands off to that lead's own route, so the URL,
 * the back button and the worklist highlight all behave exactly as they do when a lead is clicked.
 *
 * The worklist query shares its key and request with the Lead Workspace, so the hand-off is a
 * cache hit rather than a second round trip, and the destination renders with its list already
 * warm. When the company has no leads yet there is nothing to open, so it says so and points at
 * the board where the first one is added.
 */
export function WorkspaceEntry() {
  const worklist = useQuery({
    queryKey: ['crm', 'leads', 'list', 'worklist'],
    queryFn: () => api.get<LeadListResponse>(listPath(LEAD_PATHS.leads, { pageSize: 100 })),
  });

  const firstLeadId = worklist.data?.items[0]?.id;

  useEffect(() => {
    // Replace, not push: "Workspace" is a doorway, not a stop on the back button — pressing back
    // from a lead should return to wherever they came from, not to an empty redirector.
    if (firstLeadId) navigate(leadWorkspacePath(firstLeadId), { replace: true });
  }, [firstLeadId]);

  if (worklist.isPending || firstLeadId) {
    return (
      <p role="status" className="p-8 text-sm font-semibold text-slate-600">
        Opening your workspace…
      </p>
    );
  }

  return (
    <section className="mx-auto mt-12 flex max-w-md flex-col items-center gap-4 rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-2xs">
      <h1 className="text-base font-bold text-slate-900">No leads to work yet.</h1>
      <p className="text-sm text-slate-500">
        Your workspace opens on a lead. Add your first one on the Leads board and it will open here.
      </p>
      <button
        type="button"
        onClick={() => navigate('/crm/leads')}
        className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-bold text-white transition hover:bg-slate-700"
      >
        Go to Leads
      </button>
    </section>
  );
}
