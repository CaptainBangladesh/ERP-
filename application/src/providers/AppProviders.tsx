import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';

/**
 * Server state is owned by TanStack Query — caching, invalidation after mutations, and the
 * loading and error states every screen renders. React Context is reserved for genuine
 * client state (session, current company, navigation), which is small enough that Redux
 * never becomes necessary.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        refetchOnWindowFocus: false,
      },
    },
  });
}

export function AppProviders({
  children,
  client,
}: {
  children: ReactNode;
  client?: QueryClient;
}) {
  // Created lazily per provider instance so tests get a fresh cache each render and cannot
  // leak state between cases.
  const [fallback] = useState(createQueryClient);

  return <QueryClientProvider client={client ?? fallback}>{children}</QueryClientProvider>;
}
