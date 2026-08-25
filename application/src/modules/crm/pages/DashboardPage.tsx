import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  DASHBOARD_PATHS,
  Money,
  type ActivityCountsResponse,
  type LeadSourcePerformanceResponse,
  type MoneyValue,
  type PipelineValueResponse,
  type WinLossRateResponse,
} from '@erp/shared';
import { api } from '../../../api/client';

function formatMoney(mv?: MoneyValue | null): string {
  if (!mv) return '—';
  return Money.fromValue(mv).toString();
}

export function DashboardPage() {
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  const dateParams = new URLSearchParams();
  if (fromDate) dateParams.set('fromDate', fromDate);
  if (toDate) dateParams.set('toDate', toDate);
  const dateQueryString = dateParams.toString();

  const pipelineValueQuery = useQuery({
    queryKey: ['crm', 'dashboard', 'pipeline-value'],
    queryFn: () => api.get<PipelineValueResponse>(DASHBOARD_PATHS.pipelineValue),
  });

  const winLossQuery = useQuery({
    queryKey: ['crm', 'dashboard', 'win-loss-rate', dateQueryString],
    queryFn: () =>
      api.get<WinLossRateResponse>(
        `${DASHBOARD_PATHS.winLossRate}${dateQueryString ? `?${dateQueryString}` : ''}`,
      ),
  });

  const activityCountsQuery = useQuery({
    queryKey: ['crm', 'dashboard', 'activity-counts', dateQueryString],
    queryFn: () =>
      api.get<ActivityCountsResponse>(
        `${DASHBOARD_PATHS.activityCounts}${dateQueryString ? `?${dateQueryString}` : ''}`,
      ),
  });

  const leadSourcePerformanceQuery = useQuery({
    queryKey: ['crm', 'dashboard', 'lead-source-performance', dateQueryString],
    queryFn: () =>
      api.get<LeadSourcePerformanceResponse>(
        `${DASHBOARD_PATHS.leadSourcePerformance}${dateQueryString ? `?${dateQueryString}` : ''}`,
      ),
  });

  const pipelineData = pipelineValueQuery.data;
  const winLossData = winLossQuery.data;
  const activityData = activityCountsQuery.data;
  const leadSourceData = leadSourcePerformanceQuery.data;

  const hasDeals = (pipelineData?.stages.reduce((acc, s) => acc + s.dealCount, 0) ?? 0) > 0;

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Pipeline & Activity Dashboard</h1>
          <p className="text-sm text-slate-600">
            Pipeline value by stage, win/loss conversion rates, and team activity metrics.
          </p>
        </div>

        <div className="flex items-center gap-3 bg-white p-3 rounded-lg border border-slate-200 shadow-sm">
          <div className="flex flex-col text-xs text-slate-500">
            <span>Date Range</span>
            <div className="flex items-center gap-2 mt-1">
              <input
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className="px-2 py-1 border border-slate-300 rounded text-xs text-slate-800"
                aria-label="From date"
              />
              <span className="text-slate-400">to</span>
              <input
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                className="px-2 py-1 border border-slate-300 rounded text-xs text-slate-800"
                aria-label="To date"
              />
              {(fromDate || toDate) && (
                <button
                  type="button"
                  onClick={() => {
                    setFromDate('');
                    setToDate('');
                  }}
                  className="text-xs text-slate-500 underline hover:text-slate-800 ml-1"
                >
                  Clear
                </button>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Metric Cards Summary */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white p-5 rounded-lg border border-slate-200 shadow-sm">
          <span className="text-xs font-medium text-slate-500 uppercase tracking-wider">
            In-Flight Pipeline
          </span>
          <div className="text-2xl font-bold text-slate-900 mt-2">
            {formatMoney(pipelineData?.totalInFlightValue)}
          </div>
          <p className="text-xs text-slate-500 mt-1">
            {pipelineData?.totalInFlightDeals ?? 0} active deals
          </p>
        </div>

        <div className="bg-white p-5 rounded-lg border border-slate-200 shadow-sm">
          <span className="text-xs font-medium text-slate-500 uppercase tracking-wider">
            Won Deals Total
          </span>
          <div className="text-2xl font-bold text-emerald-600 mt-2">
            {formatMoney(pipelineData?.totalWonValue)}
          </div>
          <p className="text-xs text-slate-500 mt-1">
            {pipelineData?.totalWonDeals ?? 0} won deals
          </p>
        </div>

        <div className="bg-white p-5 rounded-lg border border-slate-200 shadow-sm">
          <span className="text-xs font-medium text-slate-500 uppercase tracking-wider">
            Win Rate
          </span>
          <div className="text-2xl font-bold text-indigo-600 mt-2">
            {winLossData ? `${(winLossData.winRate * 100).toFixed(1)}%` : '—'}
          </div>
          <p className="text-xs text-slate-500 mt-1">
            {winLossData?.wonCount ?? 0} won / {winLossData?.totalClosed ?? 0} closed
          </p>
        </div>

        <div className="bg-white p-5 rounded-lg border border-slate-200 shadow-sm">
          <span className="text-xs font-medium text-slate-500 uppercase tracking-wider">
            Total Activities
          </span>
          <div className="text-2xl font-bold text-slate-900 mt-2">
            {activityData?.totalCount ?? 0}
          </div>
          <p className="text-xs text-slate-500 mt-1">Logged interactions</p>
        </div>
      </div>

      {/* Main Grid Sections */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Pipeline Value by Stage & Lead Source Performance (Span 2 cols) */}
        <div className="lg:col-span-2 flex flex-col gap-6">
          <div className="bg-white rounded-lg border border-slate-200 shadow-sm p-6 flex flex-col gap-4">
            <h2 className="text-lg font-semibold text-slate-900">Pipeline Value by Stage</h2>

            {!hasDeals ? (
              <div className="p-8 text-center bg-slate-50 rounded-lg border border-dashed border-slate-300">
                <p className="text-slate-600 font-medium">No deals in pipeline</p>
                <p className="text-xs text-slate-500 mt-1">
                  Create stages and deals on the Deals board to see metrics here.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm text-slate-700">
                  <thead className="bg-slate-50 text-xs text-slate-500 uppercase">
                    <tr>
                      <th className="px-4 py-3 font-medium">Stage</th>
                      <th className="px-4 py-3 font-medium">Status</th>
                      <th className="px-4 py-3 font-medium text-right">Deals</th>
                      <th className="px-4 py-3 font-medium text-right">Total Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {pipelineData?.stages.map((stage) => (
                      <tr key={stage.stageId} className="hover:bg-slate-50">
                        <td className="px-4 py-3 font-medium text-slate-900">{stage.stageName}</td>
                        <td className="px-4 py-3 text-xs">
                          {stage.outcome === 'won' && (
                            <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-medium">
                              Won
                            </span>
                          )}
                          {stage.outcome === 'lost' && (
                            <span className="px-2 py-0.5 rounded-full bg-rose-100 text-rose-800 font-medium">
                              Lost
                            </span>
                          )}
                          {stage.outcome === null && (
                            <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 font-medium">
                              In-Flight
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right font-medium">{stage.dealCount}</td>
                        <td className="px-4 py-3 text-right font-medium text-slate-900">
                          {formatMoney(stage.totalValue)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Lead Source Performance Card */}
          <div className="bg-white rounded-lg border border-slate-200 shadow-sm p-6 flex flex-col gap-4">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Lead Source Performance</h2>
              <p className="text-xs text-slate-500 mt-1">
                Leads produced vs. converted per channel over the selected date range.
              </p>
            </div>

            {(() => {
              const sources = leadSourceData?.sources || [];
              const totalProduced = typeof leadSourceData?.totalProduced === 'number' ? leadSourceData.totalProduced : 0;
              const totalConverted = typeof leadSourceData?.totalConverted === 'number' ? leadSourceData.totalConverted : 0;

              if (!leadSourceData || sources.length === 0) {
                return (
                  <div className="p-8 text-center bg-slate-50 rounded-lg border border-dashed border-slate-300">
                    <p className="text-slate-600 font-medium">No lead source data</p>
                    <p className="text-xs text-slate-500 mt-1">
                      Configure lead sources and capture leads to see conversion statistics here.
                    </p>
                  </div>
                );
              }

              return (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm text-slate-700">
                    <thead className="bg-slate-50 text-xs text-slate-500 uppercase">
                      <tr>
                        <th className="px-4 py-3 font-medium">Source</th>
                        <th className="px-4 py-3 font-medium text-right">Produced</th>
                        <th className="px-4 py-3 font-medium text-right">Converted</th>
                        <th className="px-4 py-3 font-medium text-right">Conversion Rate</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {sources.map((row, idx) => {
                        const producedCount = row.producedCount ?? 0;
                        const convertedCount = row.convertedCount ?? 0;
                        const rate =
                          producedCount > 0
                            ? ((convertedCount / producedCount) * 100).toFixed(1)
                            : '0.0';
                        return (
                          <tr
                            key={row.sourceId ?? `unattributed-${idx}`}
                            className="hover:bg-slate-50"
                          >
                            <td className="px-4 py-3 font-medium text-slate-900">
                              {row.sourceName || (
                                <span className="italic text-slate-400">Unattributed</span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-right font-medium">{producedCount}</td>
                            <td className="px-4 py-3 text-right font-medium text-emerald-600">
                              {convertedCount}
                            </td>
                            <td className="px-4 py-3 text-right font-medium text-slate-900">
                              {rate}%
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot className="bg-slate-50 font-semibold text-slate-900 border-t border-slate-200">
                      <tr>
                        <td className="px-4 py-3">Total</td>
                        <td className="px-4 py-3 text-right">{totalProduced}</td>
                        <td className="px-4 py-3 text-right text-emerald-600">
                          {totalConverted}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {totalProduced > 0
                            ? ((totalConverted / totalProduced) * 100).toFixed(1)
                            : '0.0'}
                          %
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              );
            })()}
          </div>
        </div>

        {/* Win/Loss & Activity Breakdown (Span 1 col) */}
        <div className="flex flex-col gap-6">
          {/* Win / Loss Breakdown Card */}
          <div className="bg-white rounded-lg border border-slate-200 shadow-sm p-6 flex flex-col gap-4">
            <h2 className="text-lg font-semibold text-slate-900">Win / Loss Breakdown</h2>
            {winLossData && winLossData.totalClosed > 0 ? (
              <div className="flex flex-col gap-3">
                <div className="flex justify-between items-center text-sm">
                  <span className="text-slate-600 font-medium">Won Deals</span>
                  <span className="font-semibold text-emerald-600">{winLossData.wonCount}</span>
                </div>
                <div className="flex justify-between items-center text-sm">
                  <span className="text-slate-600 font-medium">Lost Deals</span>
                  <span className="font-semibold text-rose-600">{winLossData.lostCount}</span>
                </div>
                <div className="flex justify-between items-center text-sm pt-2 border-t border-slate-100">
                  <span className="text-slate-600 font-medium">Total Closed</span>
                  <span className="font-semibold text-slate-900">{winLossData.totalClosed}</span>
                </div>
              </div>
            ) : (
              <div className="p-4 text-center bg-slate-50 rounded border border-dashed border-slate-200 text-xs text-slate-500">
                No closed deals in the selected date range.
              </div>
            )}
          </div>

          {/* Activity Counts Breakdown Card */}
          <div className="bg-white rounded-lg border border-slate-200 shadow-sm p-6 flex flex-col gap-4">
            <h2 className="text-lg font-semibold text-slate-900">Activity Breakdown</h2>

            {activityData && activityData.totalCount > 0 ? (
              <div className="flex flex-col gap-4">
                <div>
                  <h3 className="text-xs font-semibold text-slate-500 uppercase mb-2">By Type</h3>
                  <div className="flex flex-wrap gap-2">
                    {activityData.byType.map((item) => (
                      <span
                        key={item.type}
                        className="px-2.5 py-1 bg-slate-100 text-slate-800 rounded-md text-xs font-medium"
                      >
                        {item.type}: <strong className="text-slate-900">{item.count}</strong>
                      </span>
                    ))}
                  </div>
                </div>

                {activityData.byUser.length > 0 && (
                  <div>
                    <h3 className="text-xs font-semibold text-slate-500 uppercase mb-2">
                      By Representative
                    </h3>
                    <div className="flex flex-col gap-1.5 text-xs text-slate-700">
                      {activityData.byUser.map((user) => (
                        <div key={user.userId} className="flex justify-between items-center py-1 border-b border-slate-100">
                          <span className="font-medium text-slate-800">{user.userName}</span>
                          <span className="font-semibold text-slate-900">{user.count}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="p-4 text-center bg-slate-50 rounded border border-dashed border-slate-200 text-xs text-slate-500">
                No activities logged in the selected date range.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
