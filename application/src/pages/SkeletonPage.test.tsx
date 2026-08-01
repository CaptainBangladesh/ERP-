import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { SKELETON_PROBES_PATH, SKELETON_PROBE_COUNT_PATH } from '@erp/shared';
import { server } from '../test/server';
import { renderPage } from '../test/render';
import { SkeletonPage } from './SkeletonPage';

/**
 * Seam 2 — the worked example every later screen copies. Assertions are on what a user sees
 * and does, never on hooks or component internals.
 */
describe('SkeletonPage', () => {
  it('shows the empty state when nothing has been created', async () => {
    server.use(
      http.get(SKELETON_PROBE_COUNT_PATH, () => HttpResponse.json({ count: 0 })),
    );

    renderPage(<SkeletonPage />);

    expect(await screen.findByText(/no probes yet/i)).toBeInTheDocument();
  });

  it('shows the count once probes exist', async () => {
    server.use(
      http.get(SKELETON_PROBE_COUNT_PATH, () => HttpResponse.json({ count: 3 })),
    );

    renderPage(<SkeletonPage />);

    expect(await screen.findByText('3')).toBeInTheDocument();
    expect(screen.getByText('probes')).toBeInTheDocument();
  });

  it('shows a loading state before the count arrives', () => {
    server.use(
      http.get(SKELETON_PROBE_COUNT_PATH, () => HttpResponse.json({ count: 0 })),
    );

    renderPage(<SkeletonPage />);

    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it('shows the error message from the API when the count fails', async () => {
    server.use(
      http.get(SKELETON_PROBE_COUNT_PATH, () =>
        HttpResponse.json(
          { code: 'internal_error', message: 'Something went wrong. Please try again.' },
          { status: 500 },
        ),
      ),
    );

    renderPage(<SkeletonPage />);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/could not load the count/i);
    expect(alert).toHaveTextContent(/something went wrong/i);
  });

  it('creates a probe and refreshes the count', async () => {
    let count = 0;
    server.use(
      http.get(SKELETON_PROBE_COUNT_PATH, () => HttpResponse.json({ count })),
      http.post(SKELETON_PROBES_PATH, () => {
        count += 1;
        return HttpResponse.json(
          { id: 'probe-1', createdAt: new Date().toISOString() },
          { status: 201 },
        );
      }),
    );

    const { user } = renderPage(<SkeletonPage />);

    expect(await screen.findByText(/no probes yet/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /create a probe/i }));

    // The list refreshing after a mutation is the behaviour under test — a user must never
    // act on data that a change of their own has already invalidated.
    expect(await screen.findByText('1')).toBeInTheDocument();
    expect(screen.getByText('probe')).toBeInTheDocument();
  });

  it('surfaces a failure to create without losing the current count', async () => {
    server.use(
      http.get(SKELETON_PROBE_COUNT_PATH, () => HttpResponse.json({ count: 2 })),
      http.post(SKELETON_PROBES_PATH, () =>
        HttpResponse.json({ code: 'conflict', message: 'Could not create a probe.' }, { status: 409 }),
      ),
    );

    const { user } = renderPage(<SkeletonPage />);

    expect(await screen.findByText('2')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /create a probe/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/could not create a probe/i);
    });
    expect(screen.getByText('2')).toBeInTheDocument();
  });
});
