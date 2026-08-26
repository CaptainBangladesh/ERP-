import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  DEAL_PATHS,
  DEFAULT_CURRENCY,
  Decimal,
  ERROR_CODES,
  IDENTITY_PATHS,
  Money,
  PARTY_PATHS,
  STAGE_OUTCOMES,
  STAGE_PATHS,
  listPath,
  type CreateDealRequest,
  type CreateStageRequest,
  type DealListResponse,
  type DealResponse,
  type DealSummary,
  type PartyListResponse,
  type PartySummary,
  type SettableStageOutcome,
  type StageListResponse,
  type StageResponse,
  type StageSummary,
  type UpdateDealRequest,
  type UpdateStageRequest,
  type UserListResponse,
  type UserSummary,
} from '@erp/shared';
import { Field, FormError, MoneyInput, MoneyText, Select } from '@erp/shared/ui';
import { ApiFailure, api } from '../../../api/client';
import { useSession } from '../../../session/SessionProvider';
import { hasPermission } from '../../../session/permissions';
import { ContactPriorityPicker } from './ContactsPage';

const STAGE_OUTCOME_LABELS: Record<SettableStageOutcome, string> = { won: 'Won', lost: 'Lost' };

// Estimated win probability based on stage order/outcome for data-driven forecasting
function getStageProbability(stage: StageSummary, totalStages: number): number {
  if (stage.outcome === 'won') return 100;
  if (stage.outcome === 'lost') return 0;
  if (totalStages <= 1) return 50;
  const pct = Math.round(20 + ((stage.order - 1) / Math.max(1, totalStages - 1)) * 60);
  return Math.min(90, Math.max(10, pct));
}

type ViewMode = 'pipeline' | 'forecast' | 'table';

/**
 * The Deals board in CRM — a centralized hub to track and manage sales opportunities.
 *
 * Key features:
 * 1. Comprehensive Pipeline Visualization (Kanban, Forecast & Table views)
 * 2. Deal Customization (Add deals, assign owners, associate contacts/parties, set expected values)
 * 3. Workflow Tracking (Custom sales stages, reordering, outcomes)
 * 4. Data-Driven Forecasting (Weighted forecast, goal progress, owner performance)
 * 5. Seamless Integration (In sync with contacts & identity users)
 */
export function DealsPage() {
  const { session } = useSession();
  const canWriteDeals = hasPermission(session, 'crm:deals:write');
  const canWriteStages = hasPermission(session, 'crm:stages:write');
  const canReadUsers = hasPermission(session, 'identity:users:read');
  const canReadParties = hasPermission(session, 'parties:parties:read');

  const [editingLabels, setEditingLabels] = useState(false);
  const [addingDeal, setAddingDeal] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('pipeline');
  const [targetGoal, setTargetGoal] = useState('100000.00');
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStageId, setFilterStageId] = useState('');
  const [filterOwnerId, setFilterOwnerId] = useState('');
  const [isSeeding, setIsSeeding] = useState(false);
  const [priorities, setPriorities] = useState<Record<string, string>>({});

  async function handleSeedDefaultStages() {
    setIsSeeding(true);
    try {
      const defaultStages: Array<{ name: string; outcome?: SettableStageOutcome }> = [
        { name: 'Lead Qualified' },
        { name: 'Contacted' },
        { name: 'Proposal Sent' },
        { name: 'Negotiation' },
        { name: 'Closed Won', outcome: 'won' },
        { name: 'Closed Lost', outcome: 'lost' },
      ];
      for (const st of defaultStages) {
        await api.post<StageResponse>(STAGE_PATHS.stages, st);
      }
      refresh();
    } finally {
      setIsSeeding(false);
    }
  }

  const queryClient = useQueryClient();

  const stagesQuery = useQuery({
    queryKey: ['crm', 'stages', 'list'],
    queryFn: () => api.get<StageListResponse>(listPath(STAGE_PATHS.stages, { pageSize: 200 })),
  });

  const dealsQuery = useQuery({
    queryKey: ['crm', 'deals', 'list'],
    queryFn: () => api.get<DealListResponse>(listPath(DEAL_PATHS.deals, { pageSize: 200 })),
  });

  const partiesQuery = useQuery({
    queryKey: ['parties', 'directory'],
    queryFn: () => api.get<PartyListResponse>(listPath(PARTY_PATHS.parties, { pageSize: 200 })),
    enabled: canReadParties,
  });

  const usersQuery = useQuery({
    queryKey: ['identity', 'users', 'all'],
    queryFn: () => api.get<UserListResponse>(listPath(IDENTITY_PATHS.users, { pageSize: 200 })),
    enabled: canReadUsers,
  });

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: ['crm', 'stages'] });
    void queryClient.invalidateQueries({ queryKey: ['crm', 'deals'] });
  }

  const stages = stagesQuery.data?.items ?? [];
  const deals = dealsQuery.data?.items ?? [];
  const parties = partiesQuery.data?.items ?? [];
  const users = usersQuery.data?.items ?? [];

  const partyName = useMemo(() => new Map(parties.map((party) => [party.id, party.name])), [parties]);
  const userName = useMemo(() => new Map(users.map((user) => [user.id, user.name])), [users]);
  const stageMap = useMemo(() => new Map(stages.map((stage) => [stage.id, stage])), [stages]);

  const dealsByStage = useMemo(() => {
    const grouped = new Map<string, DealSummary[]>(stages.map((stage) => [stage.id, []]));
    for (const deal of deals) grouped.get(deal.stageId)?.push(deal);
    return grouped;
  }, [stages, deals]);

  // Exact metrics calculations
  const totalPipelineValue = useMemo(() => {
    return deals.reduce((sum, d) => sum.plus(Money.fromValue(d.amount)), Money.zero());
  }, [deals]);

  const wonDealsValue = useMemo(() => {
    return deals
      .filter((d) => stageMap.get(d.stageId)?.outcome === 'won')
      .reduce((sum, d) => sum.plus(Money.fromValue(d.amount)), Money.zero());
  }, [deals, stageMap]);

  const weightedForecastValue = useMemo(() => {
    let sum = Money.zero();
    for (const d of deals) {
      const stage = stageMap.get(d.stageId);
      if (!stage) continue;
      const prob = getStageProbability(stage, stages.length);
      const probDecimal = Decimal.parse((prob / 100).toFixed(2));
      const dealMoney = Money.fromValue(d.amount);
      const weightedDeal = dealMoney.times(probDecimal).round('half-even');
      sum = sum.plus(weightedDeal);
    }
    return sum;
  }, [deals, stageMap, stages]);

  const wonCount = useMemo(() => deals.filter((d) => stageMap.get(d.stageId)?.outcome === 'won').length, [deals, stageMap]);
  const lostCount = useMemo(() => deals.filter((d) => stageMap.get(d.stageId)?.outcome === 'lost').length, [deals, stageMap]);
  const closedTotalCount = wonCount + lostCount;
  const winRate = closedTotalCount > 0 ? Math.round((wonCount / closedTotalCount) * 100) : 0;

  // Filtered deals for Table view
  const filteredDeals = useMemo(() => {
    return deals.filter((deal) => {
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const pName = partyName.get(deal.partyId)?.toLowerCase() ?? '';
        const dName = deal.name.toLowerCase();
        if (!dName.includes(q) && !pName.includes(q)) return false;
      }
      if (filterStageId && deal.stageId !== filterStageId) return false;
      if (filterOwnerId && deal.assignedToUserId !== filterOwnerId) return false;
      return true;
    });
  }, [deals, searchQuery, filterStageId, filterOwnerId, partyName]);

  const loading = stagesQuery.isPending || dealsQuery.isPending;

  return (
    <div className="flex flex-col gap-6">
      {/* Header Bar */}
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold text-slate-900">Deals</h1>
          <p className="text-sm text-slate-600">
            Track and manage sales opportunities, customize stages, and visualize revenue forecasts across your entire pipeline.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* View Mode Switcher */}
          <div className="flex items-center rounded-lg border border-slate-200 bg-slate-100 p-0.5 shadow-2xs">
            <button
              type="button"
              onClick={() => setViewMode('pipeline')}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-semibold transition-all ${
                viewMode === 'pipeline'
                  ? 'bg-white text-slate-900 shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" />
              </svg>
              Pipeline View
            </button>
            <button
              type="button"
              onClick={() => setViewMode('forecast')}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-semibold transition-all ${
                viewMode === 'forecast'
                  ? 'bg-white text-teal-800 shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
              </svg>
              Forecast View
            </button>
            <button
              type="button"
              onClick={() => setViewMode('table')}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-semibold transition-all ${
                viewMode === 'table'
                  ? 'bg-white text-slate-900 shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
              </svg>
              Table View
            </button>
          </div>

          {canWriteStages && (
            <button
              type="button"
              onClick={() => setEditingLabels((open) => !open)}
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-900 hover:bg-slate-50 shadow-2xs"
            >
              {editingLabels ? 'Close labels' : 'Edit labels'}
            </button>
          )}
          {canWriteDeals && stages.length > 0 && (
            <button
              type="button"
              onClick={() => setAddingDeal((open) => !open)}
              className="rounded-md bg-slate-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-slate-700 shadow-2xs"
            >
              {addingDeal ? 'Cancel' : 'Add deal'}
            </button>
          )}
        </div>
      </header>

      {/* Metric Cards Summary Bar */}
      {stages.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-2xs">
            <div className="text-xs font-medium text-slate-500">Total Pipeline Value</div>
            <div className="mt-1 text-xl font-bold text-slate-900">
              <MoneyText value={totalPipelineValue.toValue()} />
            </div>
            <div className="mt-1 text-xs text-slate-500">{deals.length} total deal(s)</div>
          </div>

          <div className="rounded-xl border border-teal-200 bg-teal-50/50 p-4 shadow-2xs">
            <div className="text-xs font-medium text-teal-800">Weighted Forecast</div>
            <div className="mt-1 text-xl font-bold text-teal-950">
              <MoneyText value={weightedForecastValue.toValue()} />
            </div>
            <div className="mt-1 text-xs text-teal-700">Probability-adjusted projection</div>
          </div>

          <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-4 shadow-2xs">
            <div className="text-xs font-medium text-emerald-800">Closed Won</div>
            <div className="mt-1 text-xl font-bold text-emerald-950">
              <MoneyText value={wonDealsValue.toValue()} />
            </div>
            <div className="mt-1 text-xs text-emerald-700">{wonCount} won deal(s)</div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-2xs">
            <div className="text-xs font-medium text-slate-500">Win Rate</div>
            <div className="mt-1 text-xl font-bold text-slate-900">{winRate}%</div>
            <div className="mt-1 text-xs text-slate-500">{wonCount} won / {closedTotalCount} closed</div>
          </div>
        </div>
      )}

      {editingLabels && (
        <EditLabelsPanel stages={stages} onChanged={refresh} onClose={() => setEditingLabels(false)} />
      )}

      {addingDeal && stages.length > 0 && (
        <AddDealPanel
          stages={stages}
          parties={parties}
          users={users}
          onAdded={() => {
            setAddingDeal(false);
            refresh();
          }}
          onCancel={() => setAddingDeal(false)}
        />
      )}

      {loading ? (
        <p role="status" className="rounded-md border border-slate-200 bg-white p-6 text-center text-sm text-slate-500">
          Loading the deals board…
        </p>
      ) : stages.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-md border border-dashed border-slate-300 bg-white p-12 text-center shadow-2xs">
          <h2 className="text-lg font-semibold text-slate-900">Create your first stage</h2>
          <p className="max-w-md text-sm text-slate-600">
            Nothing here is seeded. Add the stages your own sales process actually uses, or click below to seed standard sales pipeline stages automatically.
          </p>
          {canWriteStages && (
            <div className="mt-2 flex items-center gap-3">
              <button
                type="button"
                disabled={isSeeding}
                onClick={() => void handleSeedDefaultStages()}
                className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow-xs hover:bg-emerald-700 disabled:opacity-50"
              >
                {isSeeding ? 'Seeding Pipeline…' : '⚡ Seed Standard Sales Pipeline'}
              </button>
              <button
                type="button"
                onClick={() => setEditingLabels(true)}
                className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
              >
                Edit labels
              </button>
            </div>
          )}
        </div>
      ) : viewMode === 'forecast' ? (
        <ForecastView
          stages={stages}
          deals={deals}
          users={users}
          targetGoal={targetGoal}
          onTargetGoalChange={setTargetGoal}
          wonDealsValue={wonDealsValue}
          weightedForecastValue={weightedForecastValue}
          totalPipelineValue={totalPipelineValue}
          winRate={winRate}
        />
      ) : viewMode === 'table' ? (
        <TableView
          deals={filteredDeals}
          stages={stages}
          parties={parties}
          users={users}
          partyName={partyName}
          userName={userName}
          canWrite={canWriteDeals}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          filterStageId={filterStageId}
          onFilterStageChange={setFilterStageId}
          filterOwnerId={filterOwnerId}
          onFilterOwnerChange={setFilterOwnerId}
          priorities={priorities}
          onPriorityChange={(id, p) => setPriorities((prev) => ({ ...prev, [id]: p }))}
          onChanged={refresh}
        />
      ) : (
        /* Pipeline (Kanban) View */
        <div className="flex gap-4 overflow-x-auto pb-4 custom-scrollbar">
          {stages.map((stage) => (
            <StageColumn
              key={stage.id}
              stage={stage}
              stages={stages}
              deals={dealsByStage.get(stage.id) ?? []}
              partyName={partyName}
              userName={userName}
              users={users}
              canWrite={canWriteDeals}
              onChanged={refresh}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function StageColumn({
  stage,
  stages,
  deals,
  partyName,
  userName,
  users,
  canWrite,
  onChanged,
}: {
  stage: StageSummary;
  stages: StageSummary[];
  deals: DealSummary[];
  partyName: Map<string, string>;
  userName: Map<string, string>;
  users: UserSummary[];
  canWrite: boolean;
  onChanged: () => void;
}) {
  const total = deals.reduce((sum, deal) => sum.plus(Money.fromValue(deal.amount)), Money.zero());

  const move = useMutation({
    mutationFn: ({ dealId, stageId }: { dealId: string; stageId: string }) =>
      api.patch<DealResponse>(DEAL_PATHS.deal(dealId), { stageId } satisfies UpdateDealRequest),
    onSuccess: onChanged,
  });

  const reassign = useMutation({
    mutationFn: ({ dealId, userId }: { dealId: string; userId: string }) =>
      api.patch<DealResponse>(
        DEAL_PATHS.deal(dealId),
        (userId ? { assignedToUserId: userId } : {}) as UpdateDealRequest,
      ),
    onSuccess: onChanged,
  });

  return (
    <section
      aria-label={stage.name}
      className="flex w-80 flex-shrink-0 flex-col gap-3 rounded-xl border border-slate-200 bg-slate-50/80 p-4 shadow-2xs"
    >
      <header className="flex items-center justify-between gap-2 border-b border-slate-200 pb-2.5">
        <div className="flex items-center gap-2 min-w-0">
          <h2 className="font-semibold text-slate-900 truncate">{stage.name}</h2>
          {stage.outcome && (
            <span
              className={
                'rounded-md px-2 py-0.5 text-xs font-semibold uppercase tracking-wider shrink-0 ' +
                (stage.outcome === 'won' ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800')
              }
            >
              {STAGE_OUTCOME_LABELS[stage.outcome]}
            </span>
          )}
        </div>
        <span className="rounded-full bg-slate-200 px-2.5 py-0.5 text-xs font-semibold text-slate-700 shrink-0">
          {deals.length}
        </span>
      </header>

      <p className="text-xs font-medium text-slate-500">
        Total: <MoneyText value={total.toValue()} />
      </p>

      <div className="flex flex-col gap-3 mt-1">
        {deals.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-xs text-slate-400">
            No deals here.
          </p>
        ) : (
          deals.map((deal) => (
            <article
              key={deal.id}
              className="group relative flex flex-col gap-2.5 rounded-xl border border-slate-200 bg-white p-3.5 shadow-2xs hover:shadow-md hover:border-teal-300 transition-all"
            >
              <div className="flex items-start justify-between gap-2">
                <p className="font-semibold text-slate-900 leading-snug">{deal.name}</p>
                <span className="font-bold text-teal-700 bg-teal-50 px-2 py-0.5 rounded text-xs shrink-0">
                  <MoneyText value={deal.amount} />
                </span>
              </div>

              <dl className="flex flex-col gap-1 text-xs text-slate-600">
                <div className="flex items-center gap-1.5 truncate">
                  <span>Party: {partyName.get(deal.partyId) ?? deal.partyId}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span>
                    Assigned:{' '}
                    {deal.assignedToUserId ? userName.get(deal.assignedToUserId) ?? 'Somebody no longer here' : 'Nobody yet'}
                  </span>
                </div>
                {deal.expectedCloseDate && (
                  <div className="flex items-center gap-1.5 text-slate-500">
                    <span>Expected close: {deal.expectedCloseDate}</span>
                  </div>
                )}
              </dl>

              {canWrite && (
                <div className="mt-1 flex flex-col gap-2 border-t border-slate-100 pt-2.5">
                  <Select
                    id={`move-${deal.id}`}
                    label="Stage"
                    value={deal.stageId}
                    disabled={move.isPending}
                    options={stages.map((option) => ({ value: option.id, label: option.name }))}
                    onChange={(stageId) => {
                      if (stageId && stageId !== deal.stageId) move.mutate({ dealId: deal.id, stageId });
                    }}
                  />
                  {users.length > 0 && (
                    <Select
                      id={`assign-${deal.id}`}
                      label="Assigned to"
                      value={deal.assignedToUserId ?? ''}
                      placeholder="Unassigned"
                      disabled={reassign.isPending}
                      options={users.map((user) => ({ value: user.id, label: user.name }))}
                      onChange={(userId) => {
                        if (userId) reassign.mutate({ dealId: deal.id, userId });
                      }}
                    />
                  )}
                </div>
              )}
            </article>
          ))
        )}
      </div>
    </section>
  );
}

/**
 * Data-Driven Forecast View — goal tracking, weighted forecast, stage breakdown & owner leaderboard.
 */
function ForecastView({
  stages,
  deals,
  users,
  targetGoal,
  onTargetGoalChange,
  wonDealsValue,
  weightedForecastValue,
  totalPipelineValue,
  winRate,
}: {
  stages: StageSummary[];
  deals: DealSummary[];
  users: UserSummary[];
  targetGoal: string;
  onTargetGoalChange: (val: string) => void;
  wonDealsValue: Money;
  weightedForecastValue: Money;
  totalPipelineValue: Money;
  winRate: number;
}) {
  const goalMoney = useMemo(() => {
    try {
      return Money.parse(targetGoal.trim() || '0.00');
    } catch {
      return Money.zero();
    }
  }, [targetGoal]);

  const goalVal = Number(goalMoney.toValue().amount) || 1;
  const wonVal = Number(wonDealsValue.toValue().amount) || 0;
  const weightedVal = Number(weightedForecastValue.toValue().amount) || 0;

  const wonPct = Math.min(100, Math.round((wonVal / goalVal) * 100));
  const weightedPct = Math.min(100 - wonPct, Math.round((weightedVal / goalVal) * 100));

  const dealsByStage = useMemo(() => {
    const map = new Map<string, { count: number; total: Money }>();
    for (const s of stages) map.set(s.id, { count: 0, total: Money.zero() });
    for (const d of deals) {
      const entry = map.get(d.stageId) ?? { count: 0, total: Money.zero() };
      entry.count += 1;
      entry.total = entry.total.plus(Money.fromValue(d.amount));
      map.set(d.stageId, entry);
    }
    return map;
  }, [stages, deals]);

  const ownerPerformance = useMemo(() => {
    const map = new Map<string, { name: string; count: number; total: Money; won: Money }>();
    for (const u of users) {
      map.set(u.id, { name: u.name, count: 0, total: Money.zero(), won: Money.zero() });
    }
    map.set('unassigned', { name: 'Unassigned', count: 0, total: Money.zero(), won: Money.zero() });

    const stageMap = new Map(stages.map((s) => [s.id, s]));

    for (const d of deals) {
      const ownerId = d.assignedToUserId ?? 'unassigned';
      const entry = map.get(ownerId) ?? { name: 'Unassigned', count: 0, total: Money.zero(), won: Money.zero() };
      entry.count += 1;
      entry.total = entry.total.plus(Money.fromValue(d.amount));
      if (stageMap.get(d.stageId)?.outcome === 'won') {
        entry.won = entry.won.plus(Money.fromValue(d.amount));
      }
      map.set(ownerId, entry);
    }

    return Array.from(map.values()).filter((e) => e.count > 0);
  }, [stages, deals, users]);

  return (
    <div className="flex flex-col gap-6">
      {/* Revenue Goal & Progress */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-2xs">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 pb-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Revenue Goal & Performance</h2>
            <p className="text-xs text-slate-500">Track current closed revenue vs probability-weighted forecast against your goal.</p>
          </div>
          <div className="w-52">
            <MoneyInput
              id="forecast-target-goal"
              label="Target Goal"
              value={targetGoal}
              onChange={onTargetGoalChange}
              currency={DEFAULT_CURRENCY}
            />
          </div>
        </div>

        <div className="mt-4 flex flex-col gap-2">
          <div className="flex justify-between text-xs font-semibold">
            <span className="text-emerald-700">Closed Won: <MoneyText value={wonDealsValue.toValue()} /> ({wonPct}%)</span>
            <span className="text-teal-700">Weighted Forecast: <MoneyText value={weightedForecastValue.toValue()} /> ({weightedPct}%)</span>
            <span className="text-slate-600">Goal: <MoneyText value={goalMoney.toValue()} /></span>
          </div>

          <div className="h-4 w-full overflow-hidden rounded-full bg-slate-100 flex p-0.5">
            <div
              style={{ width: `${wonPct}%` }}
              className="h-full bg-emerald-500 transition-all rounded-l-full"
              title={`Won: ${wonPct}%`}
            />
            <div
              style={{ width: `${weightedPct}%` }}
              className="h-full bg-teal-400 transition-all"
              title={`Weighted Forecast: ${weightedPct}%`}
            />
          </div>
        </div>
      </div>

      {/* Stage-by-Stage Forecast Matrix */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-2xs">
        <h2 className="text-base font-semibold text-slate-900 mb-3">Stage Probability & Forecast Matrix</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-slate-200 bg-slate-50 text-slate-600 uppercase font-semibold">
              <tr>
                <th className="py-2.5 px-3">Stage</th>
                <th className="py-2.5 px-3 text-center">Deals</th>
                <th className="py-2.5 px-3 text-right">Stage Total</th>
                <th className="py-2.5 px-3 text-center">Win Probability</th>
                <th className="py-2.5 px-3 text-right">Weighted Forecast</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-medium">
              {stages.map((stage) => {
                const stat = dealsByStage.get(stage.id) ?? { count: 0, total: Money.zero() };
                const prob = getStageProbability(stage, stages.length);
                const probDecimal = Decimal.parse((prob / 100).toFixed(2));
                const weighted = stat.total.times(probDecimal).round('half-even');

                return (
                  <tr key={stage.id} className="hover:bg-slate-50/80">
                    <td className="py-2.5 px-3 font-semibold text-slate-900 flex items-center gap-2">
                      <span>{stage.name}</span>
                      {stage.outcome && (
                        <span className={`px-1.5 py-0.5 rounded text-[10px] uppercase ${stage.outcome === 'won' ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'}`}>
                          {stage.outcome}
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 px-3 text-center">{stat.count}</td>
                    <td className="py-2.5 px-3 text-right font-semibold text-slate-900">
                      <MoneyText value={stat.total.toValue()} />
                    </td>
                    <td className="py-2.5 px-3 text-center">
                      <span className="inline-block px-2 py-0.5 rounded-full bg-slate-100 text-slate-800 font-bold">
                        {prob}%
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-right font-bold text-teal-700">
                      <MoneyText value={weighted.toValue()} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Owner Leaderboard */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-2xs">
        <h2 className="text-base font-semibold text-slate-900 mb-3">Owner Performance Leaderboard</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-slate-200 bg-slate-50 text-slate-600 uppercase font-semibold">
              <tr>
                <th className="py-2.5 px-3">Owner</th>
                <th className="py-2.5 px-3 text-center">Deals</th>
                <th className="py-2.5 px-3 text-right">Pipeline Total</th>
                <th className="py-2.5 px-3 text-right">Closed Won</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-medium">
              {ownerPerformance.map((owner, idx) => (
                <tr key={idx} className="hover:bg-slate-50/80">
                  <td className="py-2.5 px-3 font-semibold text-slate-900">{owner.name}</td>
                  <td className="py-2.5 px-3 text-center">{owner.count}</td>
                  <td className="py-2.5 px-3 text-right">
                    <MoneyText value={owner.total.toValue()} />
                  </td>
                  <td className="py-2.5 px-3 text-right font-bold text-emerald-700">
                    <MoneyText value={owner.won.toValue()} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/**
 * Table / List View — full searchable & filterable table of deals.
 */
function TableView({
  deals,
  stages,
  parties,
  users,
  partyName,
  userName,
  canWrite,
  searchQuery,
  onSearchChange,
  filterStageId,
  onFilterStageChange,
  filterOwnerId,
  onFilterOwnerChange,
  priorities,
  onPriorityChange,
  onChanged,
}: {
  deals: DealSummary[];
  stages: StageSummary[];
  parties: PartySummary[];
  users: UserSummary[];
  partyName: Map<string, string>;
  userName: Map<string, string>;
  canWrite: boolean;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  filterStageId: string;
  onFilterStageChange: (id: string) => void;
  filterOwnerId: string;
  onFilterOwnerChange: (id: string) => void;
  priorities: Record<string, string>;
  onPriorityChange: (id: string, priority: string) => void;
  onChanged: () => void;
}) {
  const move = useMutation({
    mutationFn: ({ dealId, stageId }: { dealId: string; stageId: string }) =>
      api.patch<DealResponse>(DEAL_PATHS.deal(dealId), { stageId } satisfies UpdateDealRequest),
    onSuccess: onChanged,
  });

  const reassign = useMutation({
    mutationFn: ({ dealId, userId }: { dealId: string; userId: string }) =>
      api.patch<DealResponse>(
        DEAL_PATHS.deal(dealId),
        (userId ? { assignedToUserId: userId } : {}) as UpdateDealRequest,
      ),
    onSuccess: onChanged,
  });

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-2xs">
      {/* Filter controls */}
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 pb-3">
        <div className="flex-1 min-w-48">
          <input
            type="text"
            placeholder="Search deals or parties…"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs text-slate-800 focus:border-teal-500 focus:outline-none"
          />
        </div>
        <div className="w-48">
          <Select
            id="filter-stage"
            label="Filter Stage"
            value={filterStageId}
            placeholder="All Stages"
            options={stages.map((s) => ({ value: s.id, label: s.name }))}
            onChange={onFilterStageChange}
          />
        </div>
        {users.length > 0 && (
          <div className="w-48">
            <Select
              id="filter-owner"
              label="Filter Owner"
              value={filterOwnerId}
              placeholder="All Owners"
              options={users.map((u) => ({ value: u.id, label: u.name }))}
              onChange={onFilterOwnerChange}
            />
          </div>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="border-b border-slate-200 bg-slate-50 text-slate-600 uppercase font-semibold">
            <tr>
              <th className="py-2.5 px-3">Deal</th>
              <th className="py-2.5 px-3">Party / Contact</th>
              <th className="py-2.5 px-3">Stage</th>
              <th className="py-2.5 px-3 text-center">Priority</th>
              <th className="py-2.5 px-3 text-right">Amount</th>
              <th className="py-2.5 px-3">Expected Close</th>
              <th className="py-2.5 px-3">Owner</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 font-medium">
            {deals.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-8 text-center text-slate-400">
                  No matching deals found.
                </td>
              </tr>
            ) : (
              deals.map((deal) => (
                <tr key={deal.id} className="hover:bg-slate-50/80">
                  <td className="py-3 px-3 font-semibold text-slate-900">{deal.name}</td>
                  <td className="py-3 px-3 text-slate-700">{partyName.get(deal.partyId) ?? deal.partyId}</td>
                  <td className="py-3 px-3">
                    {canWrite ? (
                      <Select
                        id={`table-move-${deal.id}`}
                        label="Stage"
                        value={deal.stageId}
                        disabled={move.isPending}
                        options={stages.map((s) => ({ value: s.id, label: s.name }))}
                        onChange={(stageId) => {
                          if (stageId && stageId !== deal.stageId) move.mutate({ dealId: deal.id, stageId });
                        }}
                      />
                    ) : (
                      <span>{stages.find((s) => s.id === deal.stageId)?.name}</span>
                    )}
                  </td>
                  <td className="py-3 px-3 text-center">
                    <ContactPriorityPicker
                      value={priorities[deal.id]}
                      canWrite={canWrite}
                      onChange={(p) => onPriorityChange(deal.id, p)}
                    />
                  </td>
                  <td className="py-3 px-3 text-right font-bold text-slate-900">
                    <MoneyText value={deal.amount} />
                  </td>
                  <td className="py-3 px-3 text-slate-600">{deal.expectedCloseDate ?? '—'}</td>
                  <td className="py-3 px-3">
                    {canWrite && users.length > 0 ? (
                      <Select
                        id={`table-assign-${deal.id}`}
                        label="Owner"
                        value={deal.assignedToUserId ?? ''}
                        placeholder="Unassigned"
                        disabled={reassign.isPending}
                        options={users.map((u) => ({ value: u.id, label: u.name }))}
                        onChange={(userId) => {
                          if (userId) reassign.mutate({ dealId: deal.id, userId });
                        }}
                      />
                    ) : (
                      <span>{deal.assignedToUserId ? userName.get(deal.assignedToUserId) ?? 'Somebody no longer here' : 'Unassigned'}</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * Edit labels panel for sales stages customization.
 */
function EditLabelsPanel({
  stages,
  onChanged,
  onClose,
}: {
  stages: StageSummary[];
  onChanged: () => void;
  onClose: () => void;
}) {
  const [name, setName] = useState('');
  const [outcome, setOutcome] = useState('');
  const [error, setError] = useState<string>();

  function onFailure(err: unknown) {
    setError(err instanceof ApiFailure ? err.message : 'That did not work.');
  }

  const add = useMutation({
    mutationFn: () =>
      api.post<StageResponse>(STAGE_PATHS.stages, {
        name,
        ...(outcome ? { outcome: outcome as SettableStageOutcome } : {}),
      } satisfies CreateStageRequest),
    onSuccess: () => {
      setName('');
      setOutcome('');
      setError(undefined);
      onChanged();
    },
    onError: onFailure,
  });

  const change = useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateStageRequest }) =>
      api.patch<StageResponse>(STAGE_PATHS.stage(id), body),
    onSuccess: () => {
      setError(undefined);
      onChanged();
    },
    onError: onFailure,
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(STAGE_PATHS.stage(id)),
    onSuccess: () => {
      setError(undefined);
      onChanged();
    },
    onError: onFailure,
  });

  const ordered = [...stages].sort((a, b) => a.order - b.order);

  return (
    <section aria-labelledby="edit-labels" className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-2xs">
      <header className="flex items-center justify-between border-b border-slate-200 pb-2">
        <h2 id="edit-labels" className="text-base font-medium text-slate-900">
          Edit labels
        </h2>
        <button type="button" onClick={onClose} className="text-xs font-medium text-slate-600 hover:text-slate-900">
          Close
        </button>
      </header>

      {error && <FormError>{error}</FormError>}

      <ul className="flex flex-col gap-2">
        {ordered.length === 0 && <li className="text-sm text-slate-500">No stages yet.</li>}
        {ordered.map((stage, index) => (
          <StageRow
            key={stage.id}
            stage={stage}
            isFirst={index === 0}
            isLast={index === ordered.length - 1}
            pending={change.isPending || remove.isPending}
            onMove={(position) => change.mutate({ id: stage.id, body: { order: position } })}
            onRename={(newName) => change.mutate({ id: stage.id, body: { name: newName } })}
            onSetOutcome={(value) => change.mutate({ id: stage.id, body: { outcome: value } })}
            onDelete={() => remove.mutate(stage.id)}
          />
        ))}
      </ul>

      <form
        noValidate
        aria-labelledby="add-stage"
        className="flex flex-col gap-3 border-t border-slate-200 pt-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (name.trim()) add.mutate();
        }}
      >
        <h3 id="add-stage" className="text-sm font-medium text-slate-900">
          Add a stage
        </h3>
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-48 flex-1">
            <Field id="new-stage-name" label="Name" value={name} onChange={setName} />
          </div>
          <div className="w-44">
            <Select
              id="new-stage-outcome"
              label="Outcome"
              value={outcome}
              placeholder="In flight"
              options={STAGE_OUTCOMES.map((value) => ({ value, label: STAGE_OUTCOME_LABELS[value] }))}
              onChange={setOutcome}
            />
          </div>
          <button
            type="submit"
            disabled={add.isPending || !name.trim()}
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
          >
            {add.isPending ? 'Adding…' : 'Add stage'}
          </button>
        </div>
      </form>
    </section>
  );
}

function StageRow({
  stage,
  isFirst,
  isLast,
  pending,
  onMove,
  onRename,
  onSetOutcome,
  onDelete,
}: {
  stage: StageSummary;
  isFirst: boolean;
  isLast: boolean;
  pending: boolean;
  onMove: (position: number) => void;
  onRename: (name: string) => void;
  onSetOutcome: (outcome: SettableStageOutcome) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(stage.name);

  return (
    <li className="flex flex-wrap items-center gap-3 rounded-md border border-slate-100 bg-slate-50 p-2.5">
      <div className="flex items-center gap-1">
        <button
          type="button"
          disabled={pending || isFirst}
          aria-label={`Move ${stage.name} up`}
          onClick={() => onMove(stage.order - 1)}
          className="rounded border border-slate-300 px-1.5 py-0.5 text-xs text-slate-700 disabled:opacity-30"
        >
          ↑
        </button>
        <button
          type="button"
          disabled={pending || isLast}
          aria-label={`Move ${stage.name} down`}
          onClick={() => onMove(stage.order + 1)}
          className="rounded border border-slate-300 px-1.5 py-0.5 text-xs text-slate-700 disabled:opacity-30"
        >
          ↓
        </button>
      </div>

      {editing ? (
        <form
          className="flex items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (name.trim() && name !== stage.name) onRename(name);
            setEditing(false);
          }}
        >
          <div className="w-40">
            <Field id={`rename-${stage.id}`} label="Name" value={name} onChange={setName} />
          </div>
          <button type="submit" className="text-xs font-medium text-slate-900 underline">
            Save
          </button>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => {
            setName(stage.name);
            setEditing(true);
          }}
          className="font-medium text-slate-900 underline decoration-slate-300 underline-offset-2"
        >
          {stage.name}
        </button>
      )}

      <span className="text-xs text-slate-500">Position {stage.order}</span>

      {stage.outcome ? (
        <span className="rounded bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-800">
          Means: {STAGE_OUTCOME_LABELS[stage.outcome]}
        </span>
      ) : (
        <span className="flex items-center gap-1 text-xs text-slate-500">
          <button type="button" disabled={pending} onClick={() => onSetOutcome('won')} className="underline">
            Mark won
          </button>
          ·
          <button type="button" disabled={pending} onClick={() => onSetOutcome('lost')} className="underline">
            Mark lost
          </button>
        </span>
      )}

      <button
        type="button"
        disabled={pending}
        onClick={onDelete}
        className="ml-auto rounded px-2 py-1 text-xs font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-50"
      >
        Delete
      </button>
    </li>
  );
}

function AddDealPanel({
  stages,
  parties,
  users,
  onAdded,
  onCancel,
}: {
  stages: StageSummary[];
  parties: PartySummary[];
  users: UserSummary[];
  onAdded: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const [partyId, setPartyId] = useState('');
  const [stageId, setStageId] = useState(stages[0]?.id ?? '');
  const [amount, setAmount] = useState('');
  const [expectedCloseDate, setExpectedCloseDate] = useState('');
  const [assignedToUserId, setAssignedToUserId] = useState('');

  const add = useMutation({
    mutationFn: () =>
      api.post<DealResponse>(DEAL_PATHS.deals, {
        name,
        partyId,
        stageId,
        amount,
        ...(expectedCloseDate ? { expectedCloseDate } : {}),
        ...(assignedToUserId ? { assignedToUserId } : {}),
      } satisfies CreateDealRequest),
    onSuccess: onAdded,
  });

  const failure = add.error instanceof ApiFailure ? add.error : undefined;
  const fields = failure?.fields ?? {};

  return (
    <form
      noValidate
      aria-labelledby="add-deal"
      className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-2xs"
      onSubmit={(event) => {
        event.preventDefault();
        add.mutate();
      }}
    >
      <h2 id="add-deal" className="text-sm font-medium text-slate-900">
        Add a deal
      </h2>

      {failure && failure.code !== ERROR_CODES.validationFailed && <FormError>{failure.message}</FormError>}

      <div className="flex flex-wrap gap-4">
        <div className="min-w-56 flex-1">
          <Field id="deal-name" label="Name" value={name} error={fields.name} onChange={setName} />
        </div>
        <div className="min-w-56 flex-1">
          <Select
            id="deal-party"
            label="Party"
            value={partyId}
            placeholder="Choose a party…"
            error={fields.partyId}
            options={parties.map((party) => ({ value: party.id, label: party.name }))}
            onChange={setPartyId}
          />
        </div>
        <div className="min-w-44 flex-1">
          <Select
            id="deal-stage"
            label="Stage"
            value={stageId}
            error={fields.stageId}
            options={stages.map((stage) => ({ value: stage.id, label: stage.name }))}
            onChange={setStageId}
          />
        </div>
        <div className="min-w-44 flex-1">
          <MoneyInput
            id="deal-amount"
            label="Amount"
            value={amount}
            error={fields.amount}
            onChange={setAmount}
            currency={DEFAULT_CURRENCY}
          />
        </div>
        <div className="min-w-44 flex-1">
          <Field
            id="deal-close-date"
            label="Expected close date"
            type="date"
            value={expectedCloseDate}
            error={fields.expectedCloseDate}
            onChange={setExpectedCloseDate}
          />
        </div>
        {users.length > 0 && (
          <div className="min-w-44 flex-1">
            <Select
              id="deal-assignee"
              label="Assigned to"
              value={assignedToUserId}
              placeholder="Unassigned"
              options={users.map((user) => ({ value: user.id, label: user.name }))}
              onChange={setAssignedToUserId}
            />
          </div>
        )}
      </div>

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={add.isPending || !name.trim() || !partyId || !stageId}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50 shadow-2xs"
        >
          {add.isPending ? 'Adding…' : 'Create deal'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-900 hover:bg-slate-50"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
