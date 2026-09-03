import { describe, expect, it, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import {
  ACTIVITY_PATHS,
  DASHBOARD_PATHS,
  type ActivityCountsResponse,
  type ActivityFeedItem,
  type ActivityFeedResponse,
} from '@erp/shared';
import { server } from '../../../test/server';
import { renderPage, signedInWith } from '../../../test/render';
import { ActivitiesPage } from './ActivitiesPage';

describe('ActivitiesPage', () => {
  function item(overrides: Partial<ActivityFeedItem> = {}): ActivityFeedItem {
    return {
      id: `act-${Math.random().toString(36).slice(2)}`,
      type: 'note',
      notes: 'A note',
      occurredAt: new Date('2026-09-01T10:00:00Z').toISOString(),
      dueAt: null,
      completedAt: null,
      createdByUserId: 'u1',
      createdByName: 'Ada Okafor',
      leadId: 'lead-1',
      dealId: null,
      partyId: null,
      createdAt: new Date('2026-09-01T10:00:00Z').toISOString(),
      parentKind: 'lead',
      parentName: 'Priya Kapoor',
      ...overrides,
    };
  }

  function feed(items: ActivityFeedItem[]): ActivityFeedResponse {
    return { items, page: { number: 1, size: 100, total: items.length, pages: 1 } };
  }

  const counts: ActivityCountsResponse = {
    byType: [
      { type: 'call', count: 4 },
      { type: 'note', count: 1 },
    ],
    byUser: [
      { userId: 'u1', userName: 'Ada Okafor', count: 3 },
      { userId: 'u2', userName: 'Sam Rivera', count: 2 },
    ],
    totalCount: 5,
  };

  beforeEach(() => {
    window.localStorage.clear();
    signedInWith('all');
    server.use(
      http.get(DASHBOARD_PATHS.activityCounts, () => HttpResponse.json(counts)),
      http.get(ACTIVITY_PATHS.activities, () =>
        HttpResponse.json(
          feed([
            item({ notes: 'My own call', type: 'call', createdByUserId: 'u1', parentName: 'Priya Kapoor' }),
            item({
              notes: 'A teammate note',
              createdByUserId: 'u2',
              createdByName: 'Sam Rivera',
              parentName: 'Marcus Bell',
            }),
          ]),
        ),
      ),
    );
  });

  it('shows the summary split of everyone, mine and teammates', async () => {
    renderPage(<ActivitiesPage />, { token: 'a-token', path: '/crm/activities' });

    expect(await screen.findByRole('heading', { name: 'Activities' })).toBeInTheDocument();

    // The total comes from the count endpoint, not from the page of rows below it.
    const all = screen.getByRole('button', { name: /All activity/ });
    expect(await within(all).findByText('5')).toBeInTheDocument();
    const mine = screen.getByRole('button', { name: /My activity/ });
    expect(within(mine).getByText('3')).toBeInTheDocument();
    const team = screen.getByRole('button', { name: /Teammates/ });
    expect(within(team).getByText('2')).toBeInTheDocument();
  });

  it('lists activity from across the whole team, each naming its lead', async () => {
    renderPage(<ActivitiesPage />, { token: 'a-token', path: '/crm/activities' });

    expect(await screen.findByText('My own call')).toBeInTheDocument();
    expect(screen.getByText('A teammate note')).toBeInTheDocument();
    expect(screen.getByText('Priya Kapoor')).toBeInTheDocument();
    expect(screen.getByText('Marcus Bell')).toBeInTheDocument();
  });

  it('filters the feed to mine when the My activity lens is chosen', async () => {
    const { user } = renderPage(<ActivitiesPage />, { token: 'a-token', path: '/crm/activities' });

    expect(await screen.findByText('A teammate note')).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'My activity' }));

    expect(screen.getByText('My own call')).toBeInTheDocument();
    expect(screen.queryByText('A teammate note')).not.toBeInTheDocument();
  });
});
