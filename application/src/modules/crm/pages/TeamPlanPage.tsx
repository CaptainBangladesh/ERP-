import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { TEAM_PLAN_PATHS, type TeamPlanResponse } from '@erp/shared';
import { ApiFailure, api } from '../../../api/client';
import { useSession } from '../../../session/SessionProvider';
import { hasPermission } from '../../../session/permissions';

/**
 * The team's shared plan — one strategy/targets note the whole team sees. Deliberately lean: a
 * shared notes doc, not a project tool. Everyone with the team gate reads it; only a manager with
 * `crm:team:manage` edits it, so a rep sees the plan without the editor.
 */
export function TeamPlanPage() {
  const { session } = useSession();
  const canManage = hasPermission(session, 'crm:team:manage');

  const queryClient = useQueryClient();
  const plan = useQuery({
    queryKey: ['crm', 'team-plan'],
    queryFn: () => api.get<TeamPlanResponse>(TEAM_PLAN_PATHS.teamPlan),
  });

  const [body, setBody] = useState('');
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (plan.data && !dirty) setBody(plan.data.body);
  }, [plan.data, dirty]);

  const save = useMutation({
    mutationFn: () => api.put<TeamPlanResponse>(TEAM_PLAN_PATHS.teamPlan, { body }),
    onSuccess: (saved) => {
      setDirty(false);
      queryClient.setQueryData(['crm', 'team-plan'], saved);
    },
  });

  const failure = save.error instanceof ApiFailure ? save.error : undefined;
  const lastSaved = plan.data?.updatedAt ? new Date(plan.data.updatedAt) : null;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-slate-900">Team plan</h1>
        <p className="text-sm text-slate-600">
          The team's shared strategy, targets and campaigns — one plan everyone on the team sees.
          {canManage ? ' Edit it here.' : ' A manager keeps this up to date.'}
        </p>
      </header>

      {plan.isLoading && <p className="text-sm text-slate-500">Loading the team plan…</p>}

      {plan.data && !canManage && (
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          {plan.data.body ? (
            <p className="whitespace-pre-wrap text-sm text-slate-800">{plan.data.body}</p>
          ) : (
            <p className="text-sm text-slate-500">No team plan yet.</p>
          )}
        </div>
      )}

      {plan.data && canManage && (
        <div className="flex flex-col gap-3">
          <textarea
            aria-label="Team plan"
            rows={16}
            value={body}
            onChange={(e) => {
              setBody(e.target.value);
              setDirty(true);
            }}
            placeholder="Shared targets, focus segments, campaigns the whole team is running…"
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
          />
          <div className="flex items-center gap-3">
            <button
              type="button"
              disabled={!dirty || save.isPending}
              onClick={() => save.mutate()}
              className="rounded-md bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {save.isPending ? 'Saving…' : 'Save team plan'}
            </button>
            {dirty && <span className="text-xs text-amber-600">Unsaved changes</span>}
            {!dirty && lastSaved && (
              <span className="text-xs text-slate-400">Last saved {lastSaved.toLocaleString()}</span>
            )}
          </div>
          {failure && (
            <p role="alert" className="text-xs font-semibold text-rose-600">
              {failure.message}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
