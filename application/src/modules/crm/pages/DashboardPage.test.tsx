import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import {
  DASHBOARD_PATHS,
  Money,
  type ActivityCountsResponse,
  type LeadSourcePerformanceResponse,
  type PipelineValueResponse,
  type WinLossRateResponse,
} from '@erp/shared';
import { renderPage } from '../../../test/render';
import { server } from '../../../test/server';
import { DashboardPage } from './DashboardPage';

describe('DashboardPage', () => {
  function mockDashboardData(
    pipeline: Partial<PipelineValueResponse> = {},
    winLoss: Partial<WinLossRateResponse> = {},
    activities: Partial<ActivityCountsResponse> = {},
    leadSources: Partial<LeadSourcePerformanceResponse> = {},
  ) {
    server.use(
      http.get(DASHBOARD_PATHS.pipelineValue, () =>
        HttpResponse.json<PipelineValueResponse>({
          stages: [
            {
              stageId: 's1',
              stageName: 'Qualified',
              order: 1,
              outcome: null,
              dealCount: 2,
              totalValue: Money.wire('5000', 'USD')!,
            },
            {
              stageId: 's2',
              stageName: 'Won',
              order: 2,
              outcome: 'won',
              dealCount: 1,
              totalValue: Money.wire('10000', 'USD')!,
            },
          ],
          totalInFlightValue: Money.wire('5000', 'USD')!,
          totalInFlightDeals: 2,
          totalWonValue: Money.wire('10000', 'USD')!,
          totalWonDeals: 1,
          totalLostValue: Money.wire('0', 'USD')!,
          totalLostDeals: 0,
          ...pipeline,
        }),
      ),
      http.get(DASHBOARD_PATHS.winLossRate, () =>
        HttpResponse.json<WinLossRateResponse>({
          wonCount: 1,
          lostCount: 0,
          totalClosed: 1,
          winRate: 1.0,
          ...winLoss,
        }),
      ),
      http.get(DASHBOARD_PATHS.activityCounts, () =>
        HttpResponse.json<ActivityCountsResponse>({
          byType: [
            { type: 'call', count: 3 },
            { type: 'email', count: 2 },
          ],
          byUser: [{ userId: 'u1', userName: 'Jane Doe', count: 5 }],
          totalCount: 5,
          ...activities,
        }),
      ),
      http.get(DASHBOARD_PATHS.leadSourcePerformance, () =>
        HttpResponse.json<LeadSourcePerformanceResponse>({
          sources: [
            { sourceId: 'src-1', sourceName: 'Webinar', producedCount: 5, convertedCount: 2 },
            { sourceId: null, sourceName: 'Unattributed', producedCount: 1, convertedCount: 0 },
          ],
          totalProduced: 6,
          totalConverted: 2,
          ...leadSources,
        }),
      ),
    );
  }

  it('renders pipeline metrics, activity breakdown, and lead source performance when data exists', async () => {
    mockDashboardData();
    renderPage(<DashboardPage />, { path: '/crm/dashboard' });

    expect(await screen.findByText('Pipeline & Activity Dashboard')).toBeInTheDocument();
    expect(await screen.findByText('Qualified')).toBeInTheDocument();
    expect(screen.getAllByText('Won')[0]).toBeInTheDocument();
    expect(screen.getByText('100.0%')).toBeInTheDocument();
    expect(screen.getByText('Jane Doe')).toBeInTheDocument();
    expect(await screen.findByText('Lead Source Performance')).toBeInTheDocument();
    expect(screen.getByText('Webinar')).toBeInTheDocument();
    expect(screen.getByText('Unattributed')).toBeInTheDocument();
    expect(screen.getByText('40.0%')).toBeInTheDocument();
  });

  it('renders zero state banners when company has zero deals, activities, or sources', async () => {
    mockDashboardData(
      {
        stages: [
          {
            stageId: 's1',
            stageName: 'Proposal',
            order: 1,
            outcome: null,
            dealCount: 0,
            totalValue: Money.wire('0', 'USD')!,
          },
        ],
        totalInFlightValue: Money.wire('0', 'USD')!,
        totalInFlightDeals: 0,
        totalWonValue: Money.wire('0', 'USD')!,
        totalWonDeals: 0,
        totalLostValue: Money.wire('0', 'USD')!,
        totalLostDeals: 0,
      },
      { wonCount: 0, lostCount: 0, totalClosed: 0, winRate: 0 },
      { byType: [], byUser: [], totalCount: 0 },
      { sources: [], totalProduced: 0, totalConverted: 0 },
    );

    renderPage(<DashboardPage />, { path: '/crm/dashboard' });

    expect(await screen.findByText('Pipeline & Activity Dashboard')).toBeInTheDocument();
    expect(await screen.findByText(/no deals in pipeline/i)).toBeInTheDocument();
    expect(screen.getByText(/no closed deals in the selected date range/i)).toBeInTheDocument();
    expect(screen.getByText(/no activities logged in the selected date range/i)).toBeInTheDocument();
    expect(screen.getByText(/no lead source data/i)).toBeInTheDocument();
  });
});

