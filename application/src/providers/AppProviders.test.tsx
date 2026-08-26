import { describe, expect, it } from 'vitest';
import { QueryClientProvider } from '@tanstack/react-query';
import { useQuery } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { LEAD_PATHS } from '@erp/shared';
import { server } from '../test/server';
import { api } from '../api/client';
import { createQueryClient } from './AppProviders';

/**
 * How the application behaves while the API is briefly absent.
 *
 * The backend restarts on every save under `nest --watch` and on every deploy, and is gone for
 * a few seconds each time. A screen that gives up on the first failure spends the rest of the
 * tab's life showing an error about a server that came back — which is indistinguishable, to
 * the person looking at it, from their data having disappeared.
 */
describe('the query client', () => {
  function Board() {
    const { data, isPending, isError } = useQuery({
      queryKey: ['leads'],
      queryFn: () => api.get<{ items: { name: string }[] }>(LEAD_PATHS.leads),
    });

    if (isPending) return <p>Loading...</p>;
    if (isError) return <p>Could not load.</p>;
    return <p>{data.items.length} leads</p>;
  }

  it('rides out a restart instead of failing permanently', async () => {
    // Two refusals, as a backend coming back up gives, and then the real answer.
    let attempts = 0;
    server.use(
      http.get(LEAD_PATHS.leads, () => {
        attempts += 1;
        if (attempts <= 2) return HttpResponse.error();
        return HttpResponse.json({
          items: [{ name: 'Priya Kapoor' }, { name: 'Rin Adeyemi' }],
          page: { number: 1, size: 25, total: 2, pages: 1 },
        });
      }),
    );

    render(
      <QueryClientProvider client={createQueryClient()}>
        <Board />
      </QueryClientProvider>,
    );

    expect(await screen.findByText('2 leads', {}, { timeout: 5_000 })).toBeInTheDocument();
    expect(attempts).toBe(3);
  });

  it('does not retry something the server refused in so many words', async () => {
    let attempts = 0;
    server.use(
      http.get(LEAD_PATHS.leads, () => {
        attempts += 1;
        return HttpResponse.json(
          { code: 'forbidden', message: 'You do not have permission to do that.' },
          { status: 403 },
        );
      }),
    );

    render(
      <QueryClientProvider client={createQueryClient()}>
        <Board />
      </QueryClientProvider>,
    );

    await screen.findByText('Could not load.');
    // Asked once. Asking a refusal again four times says nothing new and delays the answer.
    await waitFor(() => expect(attempts).toBe(1));
  });
});
